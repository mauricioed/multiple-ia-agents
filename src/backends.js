'use strict';
const { t, language } = require('./i18n');
const { RpcProcess } = require('./rpc-process');
const cli = require('./agent-cli');
const { tools, runFileTool } = require('./ollama-file-tools');
const { codexPermissions } = require('./permissions');

class CodexBackend {
  constructor(session, config, emit, approve, saved) {
    this.session = session; this.config = config; this.emit = emit; this.approve = approve; this.saved = saved;
    this.approvalSignals = new Map();
  }
  async connect() {
    if (this.disposed) throw new Error(t('Conexión Codex cerrada.'));
    if (this.connecting) return this.connecting;
    if (this.rpc && !this.rpc.closed) return;
    this.connecting = this.openConnection();
    try { await this.connecting; } finally { this.connecting = undefined; }
  }
  async openConnection() {
    const invocation = await cli.resolveCli('codex', this.config);
    if (this.disposed) throw new Error(t('Conexión Codex cerrada.'));
    const rpc = this.rpc = new RpcProcess(invocation, this.session.root);
    rpc.on('message', message => this.message(message));
    rpc.on('disconnect', error => { this.loaded = false; this.finish?.(error); });
    try {
      await rpc.request('initialize', { clientInfo: { name: 'multiple_ia_agents', title: 'Multiple IA Agents', version: '0.1.0' } });
      rpc.write({ method: 'initialized', params: {} });
    } catch (error) { rpc.dispose(); throw error; }
  }
  async models() {
    await this.connect();
    const result = await this.rpc.request('model/list', {});
    return (result.data || []).map(model => ({ label: model.displayName || model.model, value: model.model, isDefault: model.isDefault === true }));
  }
  async run(text) {
    this.cancelled = false;
    await this.connect();
    if (this.cancelled) return;
    if (!this.session.model && !this.session.backendId) {
      const models = await this.models();
      const selected = models.find(model => model.isDefault) || models[0];
      if (!selected) throw new Error(t('Codex no ofrece modelos. Inicia sesión desde su terminal.'));
      this.session.model = selected.value;
    }
    const permissions = codexPermissions(this.session.permission, this.session.root);
    if (!this.loaded) {
      const params = { cwd: this.session.root, ...permissions.thread, ...(this.session.model ? { model: this.session.model } : {}) };
      const result = await this.rpc.request(this.session.backendId ? 'thread/resume' : 'thread/start', { ...params, ...(this.session.backendId ? { threadId: this.session.backendId } : {}) });
      this.session.backendId = result.thread.id; this.loaded = true; await this.saved();
    }
    if (this.cancelled) return;
    // Register completion before turn/start: very short turns can finish before its response.
    return new Promise((resolve, reject) => {
      this.finish = error => { if (!this.finish) return; this.finish = undefined; this.turnId = undefined; error ? reject(error) : resolve(); };
      this.rpc.request('turn/start', { threadId: this.session.backendId, input: [{ type: 'text', text }], cwd: this.session.root,
        ...permissions.turn,
        ...(this.session.model ? { model: this.session.model } : {}) }).then(async result => {
        if (!this.finish) return;
        this.turnId = result.turn.id;
        if (this.cancelled) await this.stop();
      }).catch(error => this.finish?.(error));
    });
  }
  message(message) {
    const p = message.params || {};
    if (p.threadId !== this.session.backendId) {
      if (message.id !== undefined) this.rpc.write({ id: message.id, error: { code: -32601, message: t('Solicitud fuera de esta sesión.') } });
      return;
    }
    if (message.id !== undefined) {
      if (p.turnId && p.turnId !== this.turnId) { this.rpc.write({ id: message.id, error: { code: -32600, message: t('La solicitud pertenece a un turno que ya no está activo.') } }); return; }
      this.requestApproval(message).catch(error => this.finish?.(error)); return;
    }
    if (message.method === 'serverRequest/resolved') { this.approvalSignals.get(p.requestId)?.abort(); this.approvalSignals.delete(p.requestId); }
    if (message.method === 'turn/started') this.turnId = p.turn.id;
    if (message.method === 'item/agentMessage/delta') this.emit({ type: 'delta', id: p.itemId, text: p.delta });
    if (message.method === 'item/completed' || message.method === 'item/started') {
      const item = p.item;
      if (item.type === 'agentMessage' && message.method === 'item/completed') this.emit({ type: 'answer', id: item.id, text: item.text });
      if (['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'].includes(item.type)) this.emit({ type: 'activity', id: item.id, text: item.command || (item.changes ? item.changes.map(change => `${change.path}\n${change.diff || ''}`).join('\n') : `${item.type}: ${item.tool || item.query || ''}`), status: item.status || (message.method === 'item/started' ? 'inProgress' : 'completed') });
    }
    if (message.method === 'error') this.emit({ type: 'status', text: p.error?.message || t('Error de Codex') });
    if (message.method === 'turn/completed') this.finish?.(p.turn.status === 'failed' ? new Error(p.turn.error?.message || t('Codex no pudo completar la respuesta.')) : undefined);
  }
  async requestApproval(message) {
    const p = message.params;
    const controller = new AbortController();
    this.approvalSignals.set(message.id, controller);
    const ask = prompt => this.approve(prompt, controller.signal);
    let result;
    try {
    if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) {
      const decision = await ask({ title: message.method.includes('commandExecution') ? t('Ejecutar comando') : t('Modificar archivos'), detail: [p.reason, p.command, p.cwd, p.grantRoot].filter(Boolean).join('\n') });
      result = { decision: decision ? 'accept' : 'decline' };
    } else if (message.method === 'item/permissions/requestApproval') {
      const decision = await ask({ title: t('Permisos adicionales'), detail: JSON.stringify(p.permissions, null, 2) });
      result = { permissions: decision ? p.permissions : {}, scope: 'turn' };
    } else if (message.method === 'item/tool/requestUserInput') {
      const answers = Object.create(null);
      for (const question of p.questions || []) {
        const answer = await ask({ title: question.header || t('Pregunta del agente'), detail: question.question, question: true, options: question.options });
        answers[question.id] = { answers: typeof answer === 'string' ? [answer] : [] };
      }
      result = { answers };
    } else {
      this.rpc.write({ id: message.id, error: { code: -32601, message: t('Esta interacción no está implementada en este cliente.') } }); return;
    }
    if (!controller.signal.aborted && !this.rpc.closed) this.rpc.write({ id: message.id, result });
    } finally { this.approvalSignals.delete(message.id); }
  }
  async stop() {
    this.cancelled = true;
    if (this.turnId && !this.rpc?.closed) await this.rpc.request('turn/interrupt', { threadId: this.session.backendId, turnId: this.turnId });
  }
  dispose() { this.disposed = true; this.cancelled = true; for (const signal of this.approvalSignals.values()) signal.abort(); this.approvalSignals.clear(); this.rpc?.dispose(); }
}

class OllamaBackend {
  constructor(session, config, emit, approve) { Object.assign(this, { session, config, emit, approve }); }
  async models() { return (await cli.listOllamaModels(this.config)).map(name => ({ label: name, value: name })); }
  async run(text, history) {
    if (!this.session.model) throw new Error(t('Selecciona un modelo instalado de Ollama.'));
    this.controller = new AbortController();
    const messages = history.filter(m => ['user', 'assistant'].includes(m.role) && !m.failed).map(m => ({ role: m.role, content: m.contextText || m.text }));
    const { signal } = this.controller;
    const base = await cli.ollamaEndpoint(this.config);
    let remainingCalls = 8;
    let withTools = true;
    let round = 0;
    while (true) {
      const result = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.session.model, messages, stream: true, ...(withTools ? { tools } : {}) }), signal });
      if (!result.ok) {
        const detail = await result.json().catch(() => null);
        if (withTools && /does not support tools|tool calling is not supported/iu.test(detail?.error || '')) {
          this.emit({ type: 'activity', id: 'ollama-tools-unavailable', text: t('Este modelo de Ollama no admite herramientas. Selecciona un modelo compatible para leer archivos.') });
          withTools = false;
          continue;
        }
        throw new Error(t('Ollama: {0}. Comprueba el servidor local y el modelo instalado.', result.status));
      }
      const reply = await this.readResponse(result, round++);
      if (!reply.tool_calls.length || !withTools) return;
      if (reply.tool_calls.length > remainingCalls) throw new Error(t('Ollama superó el límite de lecturas en este turno. Pide menos archivos o fragmentos.'));
      messages.push(reply);
      for (const [index, call] of reply.tool_calls.entries()) {
        const name = call.function.name;
        const label = name === 'read_chat_file' ? t('Leer archivo') : t('Listar carpeta');
        const authorize = this.approve && ((target, requestSignal) => this.approve({
          title: t('{0} fuera de la carpeta del chat', label), detail: target
        }, requestSignal));
        const output = await runFileTool(this.session.root, call, signal, authorize);
        signal.throwIfAborted();
        if (tools.some(definition => definition.function.name === name)) {
          const target = call.function.arguments?.path;
          this.emit({ type: 'activity', id: 'ollama-tool-' + round + '-' + index, text: label + ' · ' + (typeof target === 'string' ? target.slice(0, 4096) : ''), status: output.error ? 'failed' : 'completed' });
        }
        messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(output) });
      }
      remainingCalls -= reply.tool_calls.length;
      withTools = remainingCalls > 0;
    }
  }
  async readResponse(result, round) {
    const reply = { role: 'assistant', content: '', tool_calls: [] };
    const decoder = new TextDecoder(); let buffer = ''; let done = false;
    const consume = line => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.error) throw new Error(event.error);
      const message = event.message;
      if (message?.content) {
        reply.content += message.content;
        this.emit({ type: 'delta', id: 'ollama-' + round, text: message.content });
      }
      if (message?.thinking) reply.thinking = (reply.thinking || '') + message.thinking;
      for (const call of message?.tool_calls || []) {
        if (typeof call?.function?.name === 'string') reply.tool_calls.push(call);
        if (reply.tool_calls.length > 8) throw new Error(t('Ollama superó el límite de lecturas en este turno. Pide menos archivos o fragmentos.'));
      }
      if (event.done) done = true;
    };
    for await (const chunk of result.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline; while ((newline = buffer.indexOf('\n')) !== -1) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (buffer.length + reply.content.length + (reply.thinking?.length || 0) > 4 * 1024 * 1024) throw new Error(t('Respuesta de Ollama demasiado grande.'));
    }
    buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
    if (!done) throw new Error(t('Ollama ha cerrado la conexión antes de terminar.'));
    return reply;
  }
  async stop() { this.controller?.abort(); }
  dispose() { this.stop(); }
}
function backend(session, config, emit, approve, saved) {
  const Type = { codex: CodexBackend, ollama: OllamaBackend }[session.provider];
  if (!Type) throw new Error(t('Agente no válido.'));
  return new Type(session, config, emit, approve, saved);
}
module.exports = { CodexBackend, OllamaBackend, backend };
