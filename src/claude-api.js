'use strict';
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { randomUUID } = require('node:crypto');
const { t } = require('./i18n');
const cli = require('./agent-cli');
const claudeCli = require('./claude-cli');
const { permissionMode } = require('./permissions');

const SECRET_KEY = 'multipleIAAgents.claudeApiKey';
const API_KEY = /^[\x21-\x7e]{20,512}$/u;
// Inherited credentials or endpoints must never replace the user's key.
const AUTH_ENV = /^(?:ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH|CLAUDE_CODE_API_KEY|AWS_BEARER_TOKEN_BEDROCK$)/iu;
const PERMISSION_MODES = { auto: 'acceptEdits', full: 'bypassPermissions', read: 'plan' };
const MODELS = [
  { label: 'Predeterminado', value: '', isDefault: true },
  { label: 'Fable', value: 'fable' },
  { label: 'Opus', value: 'opus' },
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Haiku', value: 'haiku' }
];
const SUBSCRIPTION_NOTICE = 'Anthropic no permite iniciar sesión con la suscripción de Claude en extensiones de terceros. Este chat usa tu clave de API.';

class ClaudeApiKey {
  constructor(secrets, window) { this.secrets = secrets; this.window = window; }
  async get() {
    const value = await this.secrets.get(SECRET_KEY);
    return typeof value === 'string' && API_KEY.test(value) ? value : undefined;
  }
  async configure() {
    const value = await this.window.showInputBox({
      title: t('Clave de API de Anthropic'),
      prompt: t(SUBSCRIPTION_NOTICE) + ' ' + t('Se guarda cifrada en VS Code y el consumo se factura a tu cuenta de API.'),
      placeHolder: 'sk-ant-…', password: true, ignoreFocusOut: true,
      validateInput: input => API_KEY.test(input.trim()) ? undefined : t('Introduce una clave de API válida.')
    });
    if (!value) return false;
    await this.secrets.store(SECRET_KEY, value.trim());
    return true;
  }
  async ensure() { return (await this.get()) || (await this.configure() ? this.get() : undefined); }
  async remove() { await this.secrets.delete(SECRET_KEY); }
}

function apiEnvironment(key, inherited = process.env) {
  if (typeof key !== 'string' || !API_KEY.test(key)) throw new Error(t('Configura tu clave de API de Anthropic para usar este chat.'));
  const env = {};
  for (const [name, value] of Object.entries(inherited)) if (!AUTH_ENV.test(name)) env[name] = value;
  return { ...env, ANTHROPIC_API_KEY: key };
}

function claudeArguments(session, conversation) {
  const mode = PERMISSION_MODES[permissionMode(session.permission)];
  // --bare only accepts ANTHROPIC_API_KEY: OAuth and the keychain are never read.
  return ['-p', '--bare', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--add-dir', session.root,
    ...(mode ? ['--permission-mode', mode] : []), ...(session.model ? ['--model', session.model] : []), ...conversation];
}

function describeTool(name, input = {}) {
  const target = input.command || input.file_path || input.path || input.pattern || input.url || input.query;
  return typeof target === 'string' ? `${name}: ${target}` : `${name}: ${JSON.stringify(input).slice(0, 4000)}`;
}

class ClaudeApiBackend {
  constructor(session, options, emit, approve, saved, spawnProcess = spawn) {
    Object.assign(this, { session, options, emit, approve, saved, spawnProcess });
    this.approvals = new Map(); this.controls = new Map(); this.tools = new Map();
    this.streamed = new Set(); this.texts = new Map();
  }
  async models() { return MODELS.map(model => ({ ...model, label: t(model.label) })); }
  async connect(key) {
    const model = this.session.model || '';
    if (this.child && !this.closed && this.model === model && this.permission === this.session.permission) return;
    this.disconnect();
    const invocation = await cli.resolveCli('claude', this.options.configured, cli.directories(), true, this.options.fallback);
    const conversation = await claudeCli.conversationArguments(this.session);
    await this.saved();
    this.closed = false; this.model = model; this.permission = this.session.permission; this.verified = false;
    const child = this.child = this.spawnProcess(invocation.shellPath, [...invocation.shellArgs, ...claudeArguments(this.session, conversation)],
      { cwd: this.session.root, env: apiEnvironment(key), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', error => this.fail(child, error));
    createInterface({ input: child.stdout }).on('line', line => {
      if (child !== this.child) return;
      let message; try { message = JSON.parse(line); } catch { return; }
      this.message(message);
    });
    // Do not copy stderr: it can contain account or environment details.
    child.stderr.on('data', () => {});
    child.on('error', error => this.fail(child, error));
    child.on('exit', code => this.fail(child, new Error(t('Claude se ha desconectado ({0}). Vuelve a enviar para reconectar.', code ?? t('cerrado')))));
  }
  write(message) {
    if (!this.child || this.closed) throw new Error(t('Conexión con Claude cerrada.'));
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  async run(text, _history, images = []) {
    this.cancelled = false; this.lastError = undefined;
    const key = await this.options.apiKey();
    if (!key) throw new Error(t('Configura tu clave de API de Anthropic para usar este chat.'));
    await this.connect(key);
    if (this.cancelled) return;
    return new Promise((resolve, reject) => {
      this.finish = error => {
        if (!this.finish) return;
        this.finish = undefined;
        error && !this.cancelled ? reject(error) : resolve();
      };
      const content = [{ type: 'text', text },
        ...images.map(({ mime, data }) => ({ type: 'image', source: { type: 'base64', media_type: mime, data } }))];
      try { this.write({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: this.session.backendId }); }
      catch (error) { this.finish(error); }
    });
  }
  message(message) {
    if (message.type === 'system' && message.subtype === 'init') {
      if (message.apiKeySource !== 'ANTHROPIC_API_KEY') {
        this.lastError = t('Claude no está usando tu clave de API. Se ha detenido el chat.');
        this.finish?.(new Error(this.lastError)); this.disconnect(); return;
      }
      this.verified = true; return;
    }
    if (message.type === 'control_request') { this.controlRequest(message).catch(error => this.finish?.(error)); return; }
    if (message.type === 'control_cancel_request') { this.approvals.get(message.request_id)?.abort(); return; }
    if (message.type === 'control_response') {
      const control = this.controls.get(message.response?.request_id);
      if (control) { this.controls.delete(message.response.request_id); control(); }
      return;
    }
    if (message.parent_tool_use_id) return; // Subagent output stays inside its tool activity.
    if (message.type === 'stream_event') return this.streamEvent(message.event || {});
    if (message.type === 'assistant') return this.assistant(message);
    if (message.type === 'user') return this.toolResults(message.message?.content);
    if (message.type === 'result') {
      if (message.is_error || message.subtype !== 'success') {
        const detail = Array.isArray(message.errors) ? message.errors.join('\n') : message.result;
        this.finish?.(new Error(this.lastError || detail || t('Claude no pudo completar la respuesta.')));
      } else this.finish?.();
    }
  }
  streamEvent(event) {
    if (event.type === 'message_start') { this.streamId = event.message?.id; this.blocks = 0; return; }
    if (!this.streamId) return;
    if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
      if (this.blocks++ > 0) this.emit({ type: 'delta', id: this.streamId, text: '\n\n' });
      return;
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      this.streamed.add(this.streamId);
      this.emit({ type: 'delta', id: this.streamId, text: event.delta.text });
    }
  }
  assistant(message) {
    const id = message.message?.id || randomUUID();
    const content = Array.isArray(message.message?.content) ? message.message.content : [];
    if (message.error) {
      const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      this.lastError = message.error === 'authentication_failed'
        ? t('La clave de API de Anthropic no es válida o se ha revocado. Configúrala de nuevo.') : text || undefined;
      return;
    }
    for (const block of content) {
      if (block.type === 'text' && !this.streamed.has(id)) {
        const text = [this.texts.get(id), block.text].filter(Boolean).join('\n\n');
        this.texts.set(id, text); this.emit({ type: 'answer', id, text });
      }
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        const text = describeTool(block.name, block.input);
        this.tools.set(block.id, text);
        this.emit({ type: 'activity', id: block.id, text, status: 'inProgress' });
      }
    }
  }
  toolResults(content) {
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block.type !== 'tool_result' || !this.tools.has(block.tool_use_id)) continue;
      this.emit({ type: 'activity', id: block.tool_use_id, text: this.tools.get(block.tool_use_id), status: block.is_error ? 'failed' : 'completed' });
      this.tools.delete(block.tool_use_id);
    }
  }
  async controlRequest(message) {
    const { request_id: id, request = {} } = message;
    const respond = response => { if (!this.closed) this.write({ type: 'control_response', response: { subtype: 'success', request_id: id, response } }); };
    if (request.subtype !== 'can_use_tool') {
      if (!this.closed) this.write({ type: 'control_response', response: { subtype: 'error', request_id: id, error: t('Esta interacción no está implementada en este cliente.') } });
      return;
    }
    const controller = new AbortController();
    this.approvals.set(id, controller);
    try {
      const input = request.input && typeof request.input === 'object' ? request.input : {};
      if (request.tool_name === 'AskUserQuestion' && Array.isArray(input.questions)) {
        const answers = {};
        for (const question of input.questions) {
          const answer = await this.approve({ title: question.header || t('Pregunta del agente'), detail: question.question, question: true,
            options: (question.options || []).map(option => ({ label: option.label, description: option.description })) }, controller.signal);
          if (controller.signal.aborted || typeof answer !== 'string') break;
          answers[question.question] = answer;
        }
        if (controller.signal.aborted) return;
        respond(Object.keys(answers).length === input.questions.length ? { behavior: 'allow', updatedInput: { ...input, answers } }
          : { behavior: 'deny', message: t('El usuario no ha respondido a la pregunta.') });
        return;
      }
      const accepted = await this.approve({ title: t('Claude quiere usar {0}', request.display_name || request.tool_name || t('una herramienta')),
        detail: [request.description || request.title, request.decision_reason, describeTool(request.tool_name, input)].filter(Boolean).join('\n') }, controller.signal);
      if (controller.signal.aborted) return;
      respond(accepted === true ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: t('El usuario ha rechazado esta acción.') });
    } finally { this.approvals.delete(id); }
  }
  async stop() {
    this.cancelled = true;
    for (const signal of this.approvals.values()) signal.abort();
    if (!this.finish || !this.child || this.closed) return;
    const id = randomUUID();
    const answered = new Promise(resolve => this.controls.set(id, resolve));
    this.write({ type: 'control_request', request_id: id, request: { subtype: 'interrupt' } });
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 5000); });
    if (await Promise.race([answered, timeout]) === 'timeout') this.disconnect();
    clearTimeout(timer); this.controls.delete(id);
  }
  fail(child, error) {
    if (child !== this.child || this.closed) return;
    this.closed = true;
    for (const signal of this.approvals.values()) signal.abort();
    for (const control of this.controls.values()) control();
    this.controls.clear();
    this.finish?.(error);
  }
  disconnect() {
    const child = this.child;
    if (!child) return;
    this.fail(child, new Error(t('Conexión con Claude cerrada.')));
    this.child = undefined;
    child.stdin?.end(); child.kill();
  }
  dispose() { this.cancelled = true; this.disconnect(); }
}

module.exports = { SECRET_KEY, MODELS, SUBSCRIPTION_NOTICE, ClaudeApiKey, ClaudeApiBackend, apiEnvironment, claudeArguments, describeTool };
