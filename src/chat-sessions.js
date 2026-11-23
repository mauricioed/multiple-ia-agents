'use strict';
const { t, language } = require('./i18n');
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { randomUUID, randomBytes } = require('node:crypto');
const MarkdownIt = require('markdown-it');
const { TerminalSessions } = require('./terminal-sessions');
const core = require('./core');
const { backend } = require('./backends');
const { openOfficialClaude, OfficialClaudeTabs } = require('./official-claude');
const { MODES, permissionMode } = require('./permissions');
const MAX_CONTEXT = 128 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES_TOTAL = 10 * 1024 * 1024;
const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
md.disable('image');
const validateMarkdownLink = md.validateLink;
md.validateLink = url => /^file:\/\/\//iu.test(url) || validateMarkdownLink(url);

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
}

class ChatSessions extends TerminalSessions {
  constructor(context, output) {
    super(context, output);
    const saved = context.globalState.get('sessions') || [];
    for (const session of this.sessions) {
      const original = saved.find(s => s.id === session.id);
      if (typeof original?.backendId === 'string') session.backendId = original.backendId;
      session.permission = permissionMode(original?.permission);
    }
    this.panelReady = new WeakMap(); this.panelBindings = new WeakMap(); this.vaultFolders = new WeakMap();
    this.panels = new Map(); this.backends = new Map(); this.histories = new Map(); this.running = new Map(); this.messageQueues = new Map(); this.approvals = new Map(); this.writes = Promise.resolve();
    this.officialTabs = new OfficialClaudeTabs(vscode, id => this.closeSession(id), error => this.log(error.message));
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
    const permission = permissionMode(this.context.globalState.get(`chatPermission.${selected.provider}`));
    const session = { id: randomUUID(), name, provider: selected.provider, root, permission, ...(model ? { model } : {}) };
    if (provider === 'claude') {
      const previousActive = this.activeId; this.sessions.push(session); this.activeId = session.id;
      let opened = false;
      try { opened = await this.showTerminal(session); }
      finally {
        if (!opened) {
          this.sessions = this.sessions.filter(item => item !== session);
          if (this.activeId === session.id) this.activeId = previousActive;
        }
      }
      if (opened) await this.persist();
      return;
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
      if (!this.histories.has(session.id)) this.histories.set(session.id, messages);
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
  async showTerminal(session, viewColumn) {
    if (session.mode === 'terminal' || session.provider === 'terminal') return super.showTerminal(session);
    if (session.provider === 'claude') return this.officialTabs.open(session.id, () => openOfficialClaude(vscode, session.root));
    if (!vscode.workspace.isTrusted) throw new Error(t('Confía en el workspace para iniciar el chat.'));
    const root = await core.resolveEntry(session.root);
    if (!(await fs.stat(root)).isDirectory()) throw new Error(t('La carpeta del chat ya no existe.'));
    const existing = this.panels.get(session.id);
    if (existing) { existing.reveal(existing.viewColumn); return existing; }
    await this.history(session);
    const panel = vscode.window.createWebviewPanel('multipleIAAgents.chat', session.name,
      viewColumn ?? vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] });
    this.attachChatPanel(session, panel);
    return panel;
  }
  attachChatPanel(session, panel) {
    this.panelBindings.get(panel)?.();
    this.panels.set(session.id, panel);
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    this.panelReady.set(panel, ready);
    panel.title = session.name;
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    // Subscribe before setting HTML: a cached webview may send ready immediately.
    const messages = panel.webview.onDidReceiveMessage(message => {
      if (message?.action === 'ready') resolveReady(true);
      return this.handleChat(session, panel, message);
    });
    const viewState = panel.onDidChangeViewState(() => { if (panel.active && this.activeId !== session.id) { this.activeId = session.id; this.persist().catch(error => this.log(error.message)); } });
    const disposal = panel.onDidDispose(() => {
      this.panelBindings.get(panel)?.();
      if (this.panels.get(session.id) !== panel) return;
      this.panels.delete(session.id); this.closeSession(session.id).catch(error => this.log(error.message));
    });
    this.panelBindings.set(panel, () => {
      resolveReady(false);
      messages.dispose();
      viewState.dispose();
      disposal.dispose();
      this.panelBindings.delete(panel);
    });
    panel.webview.html = this.chatHtml(panel.webview, session.id);
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
  chatHtml(webview, sessionId) {
    const encodedSessionId = encodeURIComponent(sessionId);
    const nonce = randomBytes(18).toString('base64');
    const asset = name => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));
    return `<!DOCTYPE html><html lang="${language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset('chat.css')}"><link rel="stylesheet" href="${asset('controls.css')}"><title>${t('Chat del agente')}</title></head><body><div id="app" data-session-id="${encodedSessionId}"><p role="status">${t('Cargando conversacion...')}</p></div><script nonce="${nonce}" src="${asset('i18n.js')}"></script><script nonce="${nonce}" src="${asset('icons.js')}"></script><script nonce="${nonce}" src="${asset('composer-editor.js')}"></script><script nonce="${nonce}" src="${asset('chat.js')}"></script></body></html>`;
  }
  supportsVaultChat(session) {
    return !!session && session.mode !== 'terminal' && session.provider !== 'terminal' && session.provider !== 'claude';
  }

  activeVaultChat(id) {
    const session = this.sessions.find(item => item.id === id && !item.closed);
    if (id !== this.activeId || !this.supportsVaultChat(session)) throw new Error(t('Activa un chat compatible para continuar.'));
    return session;
  }

  async insertVaultDocument(id, entry) {
    const session = this.activeVaultChat(id);
    const template = await this.vault.loadTemplate(entry);
    this.activeVaultChat(id);
    const panel = await this.showTerminal(session);
    const ready = this.panelReady.get(panel);
    let timer;
    try {
      const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); });
      if (!await Promise.race([ready, timeout]) || !await panel.webview.postMessage({ type: 'vaultTemplate', template })) {
        throw new Error(t('El editor del chat no está disponible.'));
      }
    } finally { clearTimeout(timer); }
  }

  async exportVaultConversation(session) {
    const saved = await this.vault.saveConversation(session, await this.history(session));
    if (saved) this.sidebar?.refreshVault();
    return saved;
  }

  async handleChat(session, panel, message) {
    if (this.panels.get(session.id) !== panel || !message || typeof message.action !== 'string') return;
    const reply = (result, error) => panel.webview.postMessage({ type: 'reply', requestId: message.requestId, result, error });
    try {
      if (message.action === 'ready') { this.pushChat(session); return; }
      if (message.action === 'send') { await this.submitMessage(session, message); reply(true); return; }
      if (message.action === 'closedChatHistory') { reply(await this.closedChatItems(session.root)); return; }
      if (message.action === 'reopenChat') {
        if (!this.closedChats(session.root).some(chat => chat.id === message.id)) {
          throw new Error(t('El chat cerrado no está disponible para esta carpeta.'));
        }
        const target = this.session(message.id);
        if (!this.supportsVaultChat(target)) throw new Error(t('El chat cerrado no est? disponible para esta carpeta.'));
        await this.history(target);
        if (this.panels.get(session.id) !== panel || !target.closed) return;
        this.panels.delete(session.id);
        delete target.closed;
        this.activeId = target.id;
        reply(true);
        this.attachChatPanel(target, panel);
        await this.closeSession(session.id);
        return;
      }
      if (message.action === 'stop') { await this.stopSession(session); reply(true); return; }
      if (message.action === 'approval') {
        const prompt = this.approvals.get(message.id);
        if (!prompt || prompt.sessionId !== session.id) throw new Error(t('La solicitud de permiso ha caducado.'));
        prompt.resolve(prompt.question ? String(message.answer || '').slice(0, 10000) : message.accept === true); reply(true); return;
      }
      if (message.action === 'githubVault') {
        const action = message.vaultAction;
        if (action === 'save') {
          reply({ saved: await this.exportVaultConversation(session) });
          return;
        }
        if (action === 'pickFolder') {
          const folder = await this.vault.pickFolder();
          if (folder) this.vaultFolders.set(panel, folder);
          reply(folder); return;
        }
        if (action === 'open' && message.folder !== this.vaultFolders.get(panel)?.root) throw new Error(t('Selecciona una carpeta.'));
        const changed = await this.vault.run(action, this.vaultFolders.get(panel), message.name);
        if (changed && action === 'open') this.vaultFolders.delete(panel);
        if (changed) this.sidebar?.refreshVault();
        reply(changed); return;
      }
      if (message.action === 'attach') {
        const chosen = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, canSelectFolders: false, defaultUri: vscode.Uri.file(session.root), openLabel: t('Adjuntar texto e imágenes') });
        const names = [];
        for (const uri of chosen || []) {
          if (uri.scheme !== 'file') throw new Error(t('Selecciona archivos locales.'));
          const relative = path.relative(session.root, uri.fsPath).split(path.sep);
          names.push(relative);
        }
        if (names.length) {
          const existing = Array.isArray(message.attachments) ? message.attachments : [];
          const unique = new Map([...existing, ...names].map(segments => [JSON.stringify(segments), segments]));
          await this.collectContext(session, [...unique.values()]);
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
        const run = this.running.get(session.id);
        if (run && ![...this.approvals.values()].some(prompt => prompt.sessionId === session.id && !prompt.question)) {
          throw new Error(t('Detén la respuesta antes de cambiar de permisos.'));
        }
        if (!MODES.has(message.value)) throw new Error(t('Modo de permisos no valido.'));
        if (session.provider === 'ollama') throw new Error(t('Ollama no utiliza herramientas de ejecucion en esta extension.'));
        if (session.permission !== message.value) {
          session.permission = message.value;
          if (run) {
            run.resumeWithPermissions = true;
            run.interrupted = this.stopSession(session, true).then(() => true, error => {
              run.interruptionError = error;
              return false;
            });
          } else this.resetPermissionConnection(session.id);
        }
        await this.context.globalState.update(`chatPermission.${session.provider}`, message.value);
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
      if (message.action === 'link') { await this.openChatLink(session, message.url); reply(true); return; }
      throw new Error(t('Acción de chat desconocida.'));
    } catch (error) { reply(undefined, error.message); this.pushChat(session, error.message); }
  }
  async openChatLink(session, url) {
    if (typeof url === 'string' && /^https?:\/\//iu.test(url)) {
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    const invalid = () => new Error(t('Enlace local no válido.'));
    if (typeof url !== 'string' || !url || url.startsWith('#')) throw invalid();
    const [destination, fragment] = url.split(/[#?]/u, 2);
    const position = /:(\d+)(?::(\d+))?$/u.exec(destination);
    const anchor = position || /^L(\d+)(?:C(\d+))?$/iu.exec(fragment || '');
    const destinationPath = position ? destination.slice(0, position.index) : destination;
    let localPath;
    try {
      localPath = /^file:\/\/\//iu.test(destinationPath)
        ? fileURLToPath(destinationPath)
        : decodeURIComponent(destinationPath);
    } catch { throw invalid(); }
    if (process.platform === 'win32') localPath = localPath.replace(/^\/(?=[a-z]:\/)/iu, '');
    const pathWithoutDrive = process.platform === 'win32' ? localPath.replace(/^[a-z]:[\\/]/iu, '') : localPath;
    if (!localPath || /[\x00-\x1f]|^[\\/]{2}/u.test(localPath) || pathWithoutDrive.includes(':')) throw invalid();
    const candidate = path.resolve(session.root, localPath);
    if (!core.inside(session.root, candidate)) throw invalid();
    const relative = path.relative(session.root, candidate);
    const target = await core.resolveEntry(session.root, relative ? relative.split(path.sep) : []);
    const stat = await fs.stat(target);
    const uri = vscode.Uri.file(target);
    if (stat.isDirectory()) {
      if (!await vscode.env.openExternal(uri)) throw new Error(t('No se pudo abrir la carpeta.'));
      return;
    }
    if (!stat.isFile()) throw invalid();
    if (!anchor) {
      await vscode.commands.executeCommand('vscode.open', uri);
      return;
    }
    const line = Number(anchor[1]);
    const column = Number(anchor[2] || 1);
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) throw invalid();
    await vscode.commands.executeCommand('vscode.open', uri, {
      selection: new vscode.Range(line - 1, column - 1, line - 1, column - 1)
    });
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
  resetPermissionConnection(id) {
    this.backends.get(id)?.dispose(); this.backends.delete(id);
    const terminal = this.terminals.get(id); this.terminals.delete(id); terminal?.dispose();
  }
  async collectContext(session, attachments, pastedImages = []) {
    if (!Array.isArray(attachments) || !Array.isArray(pastedImages) || attachments.length + pastedImages.length > 10) throw new Error(t('Adjunta como máximo 10 archivos.'));
    let total = 0; let imageTotal = 0;
    const chunks = []; const images = [];
    for (const image of pastedImages) {
      const invalid = () => new Error(t('Pega imágenes PNG, JPEG o WebP de hasta 5 MB.'));
      const data = image?.data;
      if (typeof data !== 'string' || !data || data.length > 4 * Math.ceil(MAX_IMAGE / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw invalid();
      const bytes = Buffer.from(data, 'base64');
      const mime = imageType(bytes);
      if (!mime || mime !== image.mime || bytes.length > MAX_IMAGE || bytes.toString('base64') !== data) throw invalid();
      imageTotal += bytes.length;
      if (imageTotal > MAX_IMAGES_TOTAL) throw new Error(t('Las imágenes adjuntas superan los 10 MB en total.'));
      images.push({ mime, data });
    }
    for (const segments of attachments) {
      const target = await core.resolveEntry(session.root, segments); const stat = await fs.stat(target);
      const name = segments.join('/');
      const invalid = () => new Error(t('No se puede adjuntar «{0}». Selecciona texto UTF-8, texto UTF-16 con BOM o una imagen PNG, JPEG o WebP.', name));
      if (!stat.isFile()) throw invalid();
      const tooBig = () => new Error(t('El archivo «{0}» supera el límite de 5 MB por imagen.', name));
      if (stat.size > MAX_IMAGE) throw tooBig();
      const bytes = await fs.readFile(target);
      if (bytes.length > MAX_IMAGE) throw tooBig();
      const mime = imageType(bytes);
      if (mime) {
        imageTotal += bytes.length;
        if (imageTotal > MAX_IMAGES_TOTAL) throw new Error(t('Las imágenes adjuntas superan los 10 MB en total.'));
        images.push({ mime, data: bytes.toString('base64') });
        continue;
      }
      total += bytes.length;
      if (total > MAX_CONTEXT) throw new Error(t('El contexto supera los 128 KB. Adjunta menos archivos o selecciona un fragmento.'));
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
      let content;
      try { content = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
      catch { throw invalid(); }
      if (content.includes('\0')) throw invalid();
      chunks.push(`Archivo adjunto: ${name}\n${content}`);
    }
    return { text: chunks.join('\n\n'), images };
  }
  async submitMessage(session, { text, attachments, pastedImages, formatted }) {
    if (session.closed) throw new Error(t('Reabre el chat antes de enviar.'));
    let queue = this.messageQueues.get(session.id);
    const processing = !!queue;
    if (!queue) {
      queue = [];
      this.messageQueues.set(session.id, queue);
    }
    if (queue.length >= 10) throw new Error(t('Hay 10 mensajes en cola. Espera a que se envíen.'));
    return new Promise((resolve, reject) => {
      queue.push({ text, attachments, pastedImages, formatted, resolve, reject });
      if (processing) this.pushChat(session);
      else void this.processMessages(session, queue);
    });
  }

  async processMessages(session, queue) {
    while (queue.length) {
      const { text, attachments, pastedImages, formatted, resolve, reject } = queue.shift();
      try { await this.send(session, text, attachments, pastedImages, formatted); resolve(true); }
      catch (error) { reject(error); }
    }
    this.messageQueues.delete(session.id);
    this.pushChat(session);
  }

  clearMessageQueue(id) {
    const queue = this.messageQueues.get(id);
    if (!queue) return;
    const error = new Error(t('Se canceló el envío de los mensajes en cola.'));
    for (const message of queue.splice(0)) message.reject(error);
  }

  async send(session, text, attachments = [], pastedImages = [], formatted) {
    if (session.provider === 'claude') throw new Error(t('Utiliza el chat oficial de Claude.'));
    if (session.closed) throw new Error(t('Reabre el chat antes de enviar.'));
    if (this.running.has(session.id)) throw new Error(t('Ya hay una respuesta en curso en este chat.'));
    if (typeof text !== 'string' || text.length > 100000) throw new Error(t('Escribe un mensaje de hasta 100.000 caracteres.'));
    let run = { controller: new AbortController(), ids: new Map(), id: randomUUID() };
    let submitted;
    const messages = await this.history(session);
    if (this.running.has(session.id)) throw new Error(t('Ya hay una respuesta en curso en este chat.'));
    this.running.set(session.id, run);
    let permission = session.permission;
    try {
      const { text: context, images } = await this.collectContext(session, attachments, pastedImages);
      if (!text.trim() && !context && !images.length) throw new Error(t('Escribe un mensaje.'));
      if (run.controller.signal.aborted) return;
      const displayText = text.trim() || t('Revisa los archivos adjuntos.');
      const prompt = `${displayText}${context ? `\n\n<user_supplied_context>\n${context}\n</user_supplied_context>` : ''}`;
      submitted = { id: randomUUID(), role: 'user', text: displayText, contextText: prompt, attachments,
        ...(typeof formatted === 'string' && formatted.length <= 250000 ? { formatted } : {}),
        ...(pastedImages.length ? { pastedImageCount: pastedImages.length } : {}),
        ...(session.provider === 'ollama' && images.length ? { images: images.map(image => image.data) } : {}),
        created: Date.now() };
      messages.push(submitted);
      session.updated = Date.now();
      await this.saveHistory(session); this.pushChat(session); void this.sidebar?.publish();
      let turnInput = prompt;
      let turnImages = images;
      while (!run.controller.signal.aborted) {
        try {
          await this.getBackend(session).run(turnInput, messages, turnImages);
        } catch (error) {
          if (!run.controller.signal.aborted) throw error;
        }
        if (!run.interrupted || !await run.interrupted || !run.resumeWithPermissions || session.closed) break;
        clearTimeout(run.timer);
        this.resetPermissionConnection(session.id);
        run = { controller: new AbortController(), ids: new Map(), id: randomUUID() };
        this.running.set(session.id, run);
        permission = session.permission;
        messages.push({ id: randomUUID(), role: 'activity', text: t('Continuando con el nuevo modo de permisos.'), created: Date.now() });
        turnInput = t('Continúa la tarea anterior desde donde se interrumpió. Revisa qué pasos ya se completaron antes de actuar y vuelve a evaluar la acción pendiente con el modo de permisos actual.');
        turnImages = [];
        await this.saveHistory(session);
        this.pushChat(session);
      }
      if (run.interruptionError) {
        messages.push({ id: randomUUID(), role: 'error', text: t('No se pudo continuar con el nuevo modo de permisos. {0}', run.interruptionError.message), created: Date.now() });
      } else if (run.controller.signal.aborted) messages.push({ id: randomUUID(), role: 'activity', text: t('Respuesta detenida.'), created: Date.now() });
    } catch (error) {
      if (!submitted) throw error;
      if (submitted.images) {
        submitted.failed = true;
        delete submitted.images;
      }
      const description = error.message;
      if (!run.controller.signal.aborted) messages.push({ id: randomUUID(), role: 'error', text: description, created: Date.now() });
      else messages.push({ id: randomUUID(), role: 'activity', text: t('Respuesta detenida.'), created: Date.now() });
    } finally {
      clearTimeout(run.timer);
      run.controller.abort(); this.clearApprovals(session.id);
      if (session.permission !== permission) this.resetPermissionConnection(session.id);
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
  async stopSession(session, resumeWithPermissions = false) {
    const run = this.running.get(session.id); if (!run) return;
    if (!resumeWithPermissions) run.resumeWithPermissions = false;
    if (run.controller.signal.aborted) {
      await run.interrupted;
      return;
    }
    run.controller.abort(); this.clearApprovals(session.id); await this.backends.get(session.id)?.stop(); this.pushChat(session);
  }
  async closeSession(id) {
    this.clearMessageQueue(id);
    const session = this.session(id); await this.officialTabs.close(id); await this.stopSession(session);
    this.backends.get(id)?.dispose(); this.backends.delete(id);
    const panel = this.panels.get(id); this.panels.delete(id); panel?.dispose();
    const terminal = this.terminals.get(id); this.terminals.delete(id); terminal?.dispose();
    session.closed = true;
    session.closedAt = Date.now();
    if (this.activeId === id) this.activeId = this.sessions.find(s => !s.closed)?.id;
    await this.persist(); return true;
  }
  async selectSession(id, focus = true, viewColumn = vscode.ViewColumn.Active) {
    const session = this.session(id);
    if (!session.closed || !focus) return super.selectSession(id, focus);
    if (!await this.showTerminal(session, viewColumn)) return;
    delete session.closed;
    this.activeId = id;
    await this.persist();
  }
  async latestMessage(session) {
    if (!this.supportsVaultChat(session)) return undefined;
    const messages = await this.history(session).catch(() => []);
    const latest = messages.findLast(entry =>
      entry.role === 'user' && typeof entry.text === 'string' && entry.text.trim());
    return latest;
  }

  closedChats(root) {
    return this.sessions.filter(session => session.closed &&
      (!root || (session.mode !== 'terminal' && session.provider !== 'terminal' && !path.relative(root, session.root))))
      .reverse().sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  }

  async closedChatItems(root) {
    const items = await Promise.all(this.closedChats(root).map(async session => ({
      session, message: await this.latestMessage(session)
    })));
    return items.filter(({ message }) => !root || message)
      .sort((a, b) => (b.message?.created || 0) - (a.message?.created || 0))
      .map(({ session, message }) => ({
        label: session.name, description: session.root, id: session.id, created: message?.created,
        detail: message?.text.trim().replace(/\s+/gu, ' ').slice(0, 180)
      }));
  }

  async reopenSession() {
    const items = await this.closedChatItems();
    if (!items.length) {
      vscode.window.showInformationMessage(t('No hay chats cerrados.'));
      return;
    }
    const selected = await vscode.window.showQuickPick(items, {
      title: t('Reabrir chats cerrados'), matchOnDescription: true, matchOnDetail: true
    });
    if (selected) await this.selectSession(selected.id);
  }
  async restartSession(id) {
    const session = this.session(id);
    if (session.mode === 'terminal' || session.provider === 'terminal') return super.restartSession(id);
    if (session.provider === 'claude') return this.showTerminal(session);
    this.clearMessageQueue(id);
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
    const messages = (this.histories.get(session.id) || []).map(({ contextText, images, ...entry }) => ({ ...entry, ...(entry.role === 'assistant' ? { html: md.render(entry.text) } : {}) }));
    this.panels.get(session.id)?.webview.postMessage({ type: 'chat', session, messages: messages.filter(entry => entry.role !== 'context'), running: this.running.has(session.id), queued: this.messageQueues.get(session.id)?.length || 0, notice,
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
