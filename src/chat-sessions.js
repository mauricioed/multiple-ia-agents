'use strict';
const { t, language } = require('./i18n');
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const MarkdownIt = require('markdown-it');
const { TerminalSessions } = require('./terminal-sessions');
const core = require('./core');
const { backend } = require('./backends');
const { openOfficialClaude, OfficialClaudeTabs } = require('./official-claude');
const { MODES, permissionMode } = require('./permissions');
const MAX_CONTEXT = 128 * 1024;
const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
md.disable('image');

class ChatSessions extends TerminalSessions {
  constructor(context, output) {
    super(context, output);
    const saved = context.globalState.get('sessions') || [];
    for (const session of this.sessions) {
      const original = saved.find(s => s.id === session.id);
      if (typeof original?.backendId === 'string') session.backendId = original.backendId;
      session.permission = permissionMode(original?.permission);
    }
    this.panels = new Map(); this.backends = new Map(); this.histories = new Map(); this.running = new Map(); this.approvals = new Map(); this.writes = Promise.resolve();
    this.officialTabs = new OfficialClaudeTabs(vscode, id => this.closeSession(id), error => this.log(error.message));
    const restoredClaudeTabs = this.officialTabs.all().filter(tab => this.officialTabs.isClaude(tab));
    if (restoredClaudeTabs.length === 1) for (const session of this.sessions) {
      if (session.provider === 'claude' && session.mode !== 'terminal' && !session.closed) this.officialTabs.tabs.set(session.id, restoredClaudeTabs[0]);
    }
    this.normalizeSessionNames();
  }
  normalizeSessionNames() {
    const groups = new Map();
    for (const session of this.sessions.filter(item => !item.closed)) {
      const label = { codex: 'Codex', claude: 'Claude', ollama: 'Ollama' }[session.provider];
      if (!label || session.mode === 'terminal') continue;
      const base = `${label} · ${path.basename(session.root) || session.root}`;
      const suffix = session.name.startsWith(base) ? session.name.slice(base.length) : undefined;
      // Only update generated names; preserve any custom conversation titles.
      if (suffix !== '' && !/^ \((?:[2-9]|[1-9]\d+)\)$/u.test(suffix || '')) continue;
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base).push(session);
    }
    for (const [base, sessions] of groups) sessions.forEach((session, index) => {
      session.name = index ? `${base} (${index + 1})` : base;
    });
  }
  async persist() {
    this.normalizeSessionNames();
    return super.persist();
  }
  async pickAgent() {
    return vscode.window.showQuickPick([
      { label: 'Codex', provider: 'codex', description: t('Chat con herramientas de Codex y tu acceso del CLI') },
      { label: 'Claude', provider: 'claude', description: t('Claude Code: requiere acceso configurado') },
      { label: 'Ollama', provider: 'ollama', description: t('Conversación local; sin ejecución de herramientas') }
    ], { title: t('Agente del nuevo chat') });
  }
  async createSession(provider, root) {
    if (provider !== undefined && !['codex', 'claude', 'ollama'].includes(provider)) throw new Error(t('Agente no disponible.'));
    root ||= await this.pickFolder(); if (!root) return;
    root = await core.resolveEntry(root);
    const active = this.sessions.find(session => session.id === this.activeId && !session.closed);
    provider ||= ['codex', 'claude', 'ollama'].includes(active?.provider) ? active.provider : 'codex';
    const selected = { provider, label: { codex: 'Codex', claude: 'Claude', ollama: 'Ollama' }[provider] };
    if (!selected.label) throw new Error(t('Agente no disponible.'));
    let model;
    if (provider === 'ollama') {
      const models = await require('./agent-cli').listOllamaModels(this.configuredExecutable('ollama')).catch(error => {
        this.log(error.message);
        return []; // Opening the panel must not require an installed or running runtime.
      });
      model = models.includes(active?.model) ? active.model : models[0];

    }
    const base = `${selected.label} · ${path.basename(root) || root}`;
    let name = base; for (let index = 2; this.sessions.some(s => !s.closed && s.name === name); index++) name = `${base} (${index})`;
    const session = { id: randomUUID(), name, provider: selected.provider, root, permission: 'ask', ...(model ? { model } : {}) };
    if (provider === 'claude') {
      const previousActive = this.activeId; this.sessions.push(session); this.activeId = session.id;
      try { await this.showTerminal(session); } catch (error) { this.sessions = this.sessions.filter(item => item !== session); this.activeId = previousActive; throw error; }
      await this.persist(); return;
    }
    this.sessions.push(session); this.activeId = session.id;
    await this.persist(); await this.showTerminal(session);
  }
  historyFile(session) {
    // Session ids are generated here, but also validate persisted ids before using them as filenames.
    if (!/^[a-zA-Z0-9_-]+$/u.test(session.id)) throw new Error(t('Identificador de chat no válido.'));
    return path.join(this.context.globalStorageUri.fsPath, `${session.id}.json`);
  }
  async history(session) {
    if (!this.histories.has(session.id)) {
      let messages = [];
      try { const result = JSON.parse(await fs.readFile(this.historyFile(session), 'utf8')); if (Array.isArray(result)) messages = result.filter(m => m && typeof m.text === 'string' && ['user', 'assistant', 'activity', 'error', 'context'].includes(m.role)); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error(t('No se pudo cargar el historial. Se conserva el archivo original.')); }
      this.histories.set(session.id, messages);
    }
    return this.histories.get(session.id);
  }
  saveHistory(session) {
    const target = this.historyFile(session); const snapshot = JSON.stringify(this.histories.get(session.id) || []);
    const operation = this.writes.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(`${target}.tmp`, snapshot, 'utf8'); await fs.rename(`${target}.tmp`, target);
    });
    this.writes = operation; return operation;
  }
  getBackend(session) {
    if (session.provider === 'claude') throw new Error(t('Utiliza el chat oficial de Claude.'));
    let agent = this.backends.get(session.id);
    if (!agent) {
      agent = backend(session, this.configuredExecutable(session.provider), event => this.onAgentEvent(session, event),
        (prompt, signal) => this.approve(session, prompt, signal), () => this.persist());
      this.backends.set(session.id, agent);
    }
    return agent;
  }
  async showTerminal(session) {
    if (session.mode === 'terminal' || session.provider === 'terminal') return super.showTerminal(session);
    if (session.provider === 'claude') return this.officialTabs.open(session.id, () => openOfficialClaude(vscode));
    if (!vscode.workspace.isTrusted) throw new Error(t('Confía en el workspace para iniciar el chat.'));
    const root = await core.resolveEntry(session.root);
    if (!(await fs.stat(root)).isDirectory()) throw new Error(t('La carpeta del chat ya no existe.'));
    const existing = this.panels.get(session.id);
    if (existing) { existing.reveal(existing.viewColumn); return existing; }
    await this.history(session);
    const panel = vscode.window.createWebviewPanel('multipleIAAgents.chat', session.name,
      this.panels.size ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] });
    this.attachChatPanel(session, panel);
    return panel;
  }
  attachChatPanel(session, panel) {
    this.panels.set(session.id, panel);
    panel.title = session.name;
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    // Subscribe before setting HTML: a cached webview may send ready immediately.
    panel.webview.onDidReceiveMessage(message => this.handleChat(session, panel, message));
    panel.onDidChangeViewState(() => { if (panel.active && this.activeId !== session.id) { this.activeId = session.id; this.persist().catch(error => this.log(error.message)); } });
    panel.onDidDispose(() => {
      if (this.panels.get(session.id) !== panel) return;
      this.panels.delete(session.id); this.closeSession(session.id).catch(error => this.log(error.message));
    });
    panel.webview.html = this.chatHtml(panel.webview);
    this.publish();
  }
  async restoreChatPanel(panel, state) {
    const matches = this.sessions.filter(session => session.name === panel.title);
    const session = typeof state?.sessionId === 'string'
      ? this.sessions.find(item => item.id === state.sessionId)
      : matches.length === 1 ? matches[0] : undefined;
    if (!session) {
      panel.dispose();
      vscode.window.showWarningMessage(t('No se pudo asociar la pestana restaurada con un chat. Abre la conversacion desde la lista de Chats; su historial se conserva.'));
      return;
    }
    if (session.provider === 'claude') { panel.dispose(); delete session.closed; await this.selectSession(session.id); return; }
    const existing = this.panels.get(session.id);
    if (existing && existing !== panel) { panel.dispose(); existing.reveal(existing.viewColumn); return; }
    await this.history(session);
    delete session.closed;
    if (panel.active || !this.activeId) this.activeId = session.id;
    this.attachChatPanel(session, panel);
    await this.persist();
  }
  chatHtml(webview) {
    const nonce = randomBytes(18).toString('base64');
    const asset = name => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));
    return `<!DOCTYPE html><html lang="${language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset('chat.css')}"><link rel="stylesheet" href="${asset('controls.css')}"><title>${t('Chat del agente')}</title></head><body><div id="app"><p role="status">${t('Cargando conversacion...')}</p></div><script nonce="${nonce}" src="${asset('i18n.js')}"></script><script nonce="${nonce}" src="${asset('icons.js')}"></script><script nonce="${nonce}" src="${asset('chat.js')}"></script></body></html>`;
  }
  async handleChat(session, panel, message) {
    if (this.panels.get(session.id) !== panel || !message || typeof message.action !== 'string') return;
    const reply = (result, error) => panel.webview.postMessage({ type: 'reply', requestId: message.requestId, result, error });
    try {
      if (message.action === 'ready') { this.pushChat(session); return; }
      if (message.action === 'send') { await this.send(session, message.text, message.attachments); reply(true); return; }
      if (message.action === 'stop') { await this.stopSession(session); reply(true); return; }
      if (message.action === 'approval') {
        const prompt = this.approvals.get(message.id);
        if (!prompt || prompt.sessionId !== session.id) throw new Error(t('La solicitud de permiso ha caducado.'));
        prompt.resolve(prompt.question ? String(message.answer || '').slice(0, 10000) : message.accept === true); reply(true); return;
      }
      if (message.action === 'attach') {
        const chosen = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, canSelectFolders: false, defaultUri: vscode.Uri.file(session.root), openLabel: t('Adjuntar archivos de texto') });
        const names = [];
        for (const uri of chosen || []) {
          if (uri.scheme !== 'file') throw new Error(t('Selecciona archivos locales.'));
          const relative = path.relative(session.root, uri.fsPath).split(path.sep);
          await core.resolveEntry(session.root, relative); names.push(relative);
        }
        reply(names); return;
      }
      if (message.action === 'pullModel') { reply(await this.downloadOllamaModel(session)); return; }
      if (message.action === 'models') { reply(await this.getBackend(session).models()); return; }
      if (message.action === 'model') {
        if (this.running.has(session.id)) throw new Error(t('Espera a que termine la respuesta para cambiar de modelo.'));
        const models = await this.getBackend(session).models();
        if (!models.some(model => model.value === message.value)) throw new Error(t('Modelo no disponible.'));
        session.model = message.value; await this.persist(); reply(true); return;
      }
      if (message.action === 'permission') {
        if (this.running.has(session.id)) throw new Error(t('Detén la respuesta antes de cambiar de permisos.'));
        if (!MODES.has(message.value)) throw new Error(t('Modo de permisos no valido.'));
        if (session.provider === 'ollama') throw new Error(t('Ollama no utiliza herramientas de ejecucion en esta extension.'));
        if (session.permission !== message.value) {
          this.backends.get(session.id)?.dispose(); this.backends.delete(session.id);
          const terminal = this.terminals.get(session.id); this.terminals.delete(session.id); terminal?.dispose();
          session.permission = message.value;
        }
        await this.persist(); reply(true); return;
      }
      if (message.action === 'agent') {
        if (!['codex', 'claude', 'ollama'].includes(message.value)) throw new Error(t('Agente no válido.'));
        // A different provider gets an independent conversation and keeps the original intact.
        await this.createSession(message.value, session.root); reply(true); return;
      }
      if (message.action === 'new') { await this.createSession(message.provider === undefined ? session.provider : message.provider); reply(true); return; }
      if (message.action === 'select') { await this.selectSession(message.id); reply(true); return; }
      if (message.action === 'close') { await this.closeSession(session.id); return; }
      if (message.action === 'terminal') { await super.showTerminal(session); reply(true); return; }
      if (message.action === 'copy' && typeof message.text === 'string') { await vscode.env.clipboard.writeText(message.text); reply(true); return; }
      if (message.action === 'link' && typeof message.url === 'string' && /^https?:\/\//iu.test(message.url)) { await vscode.env.openExternal(vscode.Uri.parse(message.url)); reply(true); return; }
      throw new Error(t('Acción de chat desconocida.'));
    } catch (error) { reply(undefined, error.message); this.pushChat(session, error.message); }
  }
  async downloadOllamaModel(session) {
    if (session.provider !== 'ollama') throw new Error(t('La descarga de modelos corresponde a Ollama.'));
    const cli = require('./agent-cli');
    const items = require('./ollama-catalog').map(entry => ({ label: '$(package) ' + entry.model, model: entry.model,
      description: t(entry.category), detail: t('Descarga aproximada: {0}', entry.size) }));
    items.push({ label: '$(edit) ' + t('Otro modelo…'), description: t('Introducir nombre y etiqueta manualmente'), manual: true });
    const selected = await vscode.window.showQuickPick(items, { title: t('Descargar modelo de Ollama'),
      placeHolder: t('Selecciona un modelo de la lista o introduce otro nombre.'), matchOnDescription: true, matchOnDetail: true });
    if (!selected) return false;
    const name = selected.manual ? await vscode.window.showInputBox({ title: t('Descargar modelo de Ollama'), prompt: t('Nombre del modelo que quieres descargar. Se guardara en el almacen de modelos de Ollama.'), placeHolder: t('Nombre y etiqueta del modelo'), validateInput: value => cli.MODEL_NAME.test(value) ? undefined : t('Escribe un nombre de modelo valido.') }) : selected.model;
    if (!name) return false;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Descargando modelo Ollama: ') + name, cancellable: true }, async (progress, token) => {
      const controller = new AbortController();
      const subscription = token.onCancellationRequested(() => controller.abort());
      if (token.isCancellationRequested) controller.abort();
      try { await cli.pullOllamaModel(name, this.configuredExecutable('ollama'), controller.signal, event => {
        const amount = event.total ? ' (' + Math.min(100, Math.round(100 * (event.completed || 0) / event.total)) + '%)' : '';
        progress.report({ message: (event.status || t('Descargando')) + amount });
      }); } finally { subscription.dispose(); }
    });
    if (!this.running.has(session.id)) session.model = name;
    await this.persist();
    return true;
  }
  async collectContext(session, attachments) {
    if (!Array.isArray(attachments) || attachments.length > 10) throw new Error(t('Adjunta como máximo 10 archivos.'));
    let total = 0; const chunks = [];
    for (const segments of attachments) {
      const target = await core.resolveEntry(session.root, segments); const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size > MAX_CONTEXT) throw new Error(t('Los adjuntos deben ser archivos de texto de hasta 128 KB.'));
      const bytes = await fs.readFile(target); total += bytes.length;
      if (bytes.includes(0)) throw new Error(t('No se pueden adjuntar archivos binarios.'));
      chunks.push(`Archivo adjunto: ${segments.join('/')}\n${new TextDecoder('utf-8', { fatal: true }).decode(bytes)}`);
    }
    if (total > MAX_CONTEXT) throw new Error(t('El contexto supera los 128 KB. Adjunta menos archivos o selecciona un fragmento.'));
    return chunks.join('\n\n');
  }
  async send(session, text, attachments = []) {
    if (session.provider === 'claude') throw new Error(t('Utiliza el chat oficial de Claude.'));
    if (session.closed) throw new Error(t('Reabre el chat antes de enviar.'));
    if (this.running.has(session.id)) throw new Error(t('Ya hay una respuesta en curso en este chat.'));
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new Error(t('Escribe un mensaje de hasta 100.000 caracteres.'));
    const run = { controller: new AbortController(), ids: new Map(), id: randomUUID() };
    let submitted = false;
    const messages = await this.history(session);
    if (this.running.has(session.id)) throw new Error(t('Ya hay una respuesta en curso en este chat.'));
    this.running.set(session.id, run);
    try {
      const context = await this.collectContext(session, attachments);
      if (run.controller.signal.aborted) return;
      const prompt = `${text.trim()}${context ? `\n\n<user_supplied_context>\n${context}\n</user_supplied_context>` : ''}`;
      messages.push({ id: randomUUID(), role: 'user', text: text.trim(), contextText: prompt, attachments, created: Date.now() });
      submitted = true;
      session.updated = Date.now();
      await this.saveHistory(session); this.pushChat(session);
      await this.getBackend(session).run(prompt, messages);
      if (run.controller.signal.aborted) messages.push({ id: randomUUID(), role: 'activity', text: t('Respuesta detenida.'), created: Date.now() });
    } catch (error) {
      if (!submitted) throw error;
      const description = error.message;
      if (!run.controller.signal.aborted) messages.push({ id: randomUUID(), role: 'error', text: description, created: Date.now() });
      else messages.push({ id: randomUUID(), role: 'activity', text: t('Respuesta detenida.'), created: Date.now() });
    } finally {
      clearTimeout(run.timer);
      run.controller.abort(); this.clearApprovals(session.id);
      this.running.delete(session.id); await this.saveHistory(session); await this.persist();
    }
  }
  onAgentEvent(session, event) {
    const run = this.running.get(session.id); if (!run || run.controller.signal.aborted) return;
    const messages = this.histories.get(session.id); if (!messages) return;
    if (event.type === 'status') { this.pushChat(session, event.text); return; }
    let entry = run.ids.get(event.id);
    if (!entry) {
      entry = { id: randomUUID(), role: event.type === 'activity' ? 'activity' : 'assistant', text: '', created: Date.now() };
      run.ids.set(event.id, entry); messages.push(entry);
    }
    if (event.type === 'delta') entry.text += event.text || ''; else entry.text = event.text || '';
    if (event.status) entry.status = event.status;
    // Coalesce rapid token notifications; persist at turn boundaries, never on every token.
    if (!run.timer) run.timer = setTimeout(() => { run.timer = undefined; this.pushChat(session); }, 60);
  }
  approve(session, prompt, externalSignal) {
    const run = this.running.get(session.id);
    if (!run || run.controller.signal.aborted || externalSignal?.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const id = randomUUID();
      const finish = value => {
        if (!this.approvals.has(id)) return;
        this.approvals.delete(id); run.controller.signal.removeEventListener('abort', cancel); externalSignal?.removeEventListener('abort', cancel);
        resolve(value); this.pushChat(session);
      };
      const cancel = () => finish(false);
      this.approvals.set(id, { id, sessionId: session.id, ...prompt, resolve: finish });
      run.controller.signal.addEventListener('abort', cancel, { once: true }); externalSignal?.addEventListener('abort', cancel, { once: true }); this.pushChat(session);
    });
  }
  clearApprovals(id) { for (const prompt of [...this.approvals.values()]) if (prompt.sessionId === id) prompt.resolve(false); }
  async stopSession(session) {
    const run = this.running.get(session.id); if (!run) return;
    run.controller.abort(); this.clearApprovals(session.id); await this.backends.get(session.id)?.stop(); this.pushChat(session);
  }
  async closeSession(id) {
    const session = this.session(id); await this.officialTabs.close(id); await this.stopSession(session);
    this.backends.get(id)?.dispose(); this.backends.delete(id);
    const panel = this.panels.get(id); this.panels.delete(id); panel?.dispose();
    const terminal = this.terminals.get(id); this.terminals.delete(id); terminal?.dispose();
    session.closed = true;
    if (this.activeId === id) this.activeId = this.sessions.find(s => !s.closed)?.id;
    await this.persist(); return true;
  }
  async reopenSession() {
    const selected = await vscode.window.showQuickPick(this.sessions.filter(s => s.closed).map(s => ({ label: s.name, description: s.root, id: s.id })), { title: t('Reabrir conversación conservada') });
    if (!selected) return;
    const session = this.session(selected.id); delete session.closed;
    await this.selectSession(session.id);
  }
  async restartSession(id) {
    const session = this.session(id);
    if (session.mode === 'terminal' || session.provider === 'terminal') return super.restartSession(id);
    if (session.provider === 'claude') return this.showTerminal(session);
    await this.stopSession(session); this.backends.get(id)?.dispose(); this.backends.delete(id);
    // Reconnect to the saved provider conversation instead of dropping its history.
    await this.showTerminal(session); this.pushChat(session);
  }
  async terminalClosed(terminal) {
    const entry = [...this.terminals].find(([, value]) => value === terminal);
    if (entry && (this.session(entry[0]).mode === 'terminal' || this.session(entry[0]).provider === 'terminal' || this.session(entry[0]).provider === 'claude')) return super.terminalClosed(terminal);
    if (entry) this.terminals.delete(entry[0]);
  }
  pushChat(session, notice) {
    const messages = (this.histories.get(session.id) || []).map(({ contextText, ...entry }) => ({ ...entry, ...(entry.role === 'assistant' ? { html: md.render(entry.text) } : {}) }));
    this.panels.get(session.id)?.webview.postMessage({ type: 'chat', session, messages: messages.filter(entry => entry.role !== 'context'), running: this.running.has(session.id), notice,
      approvals: [...this.approvals.values()].filter(p => p.sessionId === session.id).map(({ resolve, ...prompt }) => prompt),
      sessions: this.sessions.filter(s => !s.closed).map(s => ({ id: s.id, name: s.name, provider: s.provider, root: s.root })) });
  }
  publish() {
    this.view?.webview.postMessage({ type: 'state', activeId: this.activeId, sessions: this.sessions.map(s => ({ ...s, connected: this.panels.has(s.id) || vscode.window.terminals.includes(this.terminals.get(s.id)) })) });
    for (const session of this.sessions) if (this.panels.has(session.id)) { this.panels.get(session.id).title = session.name; this.pushChat(session); }
  }
  dispose() { this.officialTabs.dispose(); for (const run of this.running.values()) run.controller.abort(); for (const agent of this.backends.values()) agent.dispose(); }
}
module.exports = { ChatSessions, MAX_CONTEXT };
