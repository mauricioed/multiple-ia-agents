'use strict';
const { t, language } = require('./i18n');
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const core = require('./core');
const cli = require('./agent-cli');
const claudeCli = require('./claude-cli');
const SESSION_ENV = 'MULTIPLE_IA_AGENTS_SESSION_ID';

class TerminalSessions {
  constructor(context, output) {
    this.context = context; this.output = output;
    this.sessions = core.restoreSessions(context.globalState.get('sessions'));
    this.activeId = context.globalState.get('activeId');
    this.terminals = new Map(); this.documents = new Map();
    this.busy = false; this.navigating = false;
    for (const terminal of vscode.window.terminals || []) {
      const id = terminal.creationOptions?.env?.[SESSION_ENV];
      if (id && this.sessions.some(session => session.id === id && !session.closed)) this.terminals.set(id, terminal);
    }
  }
  log(message) { this.output?.appendLine(`${new Date().toISOString()} ${message}`); }
  session(id) { const session = this.sessions.find(session => session.id === id); if (!session) throw new Error(t('La sesión ya no existe.')); return session; }
  async persist(sessions = this.sessions, activeId = this.activeId) {
    await this.context.globalState.update('sessions', sessions);
    await this.context.globalState.update('activeId', activeId);
    this.publish();
  }
  publish() {
    this.view?.webview.postMessage({ type: 'state', activeId: this.activeId,
      sessions: this.sessions.map(session => ({ ...session, connected: vscode.window.terminals.includes(this.terminals.get(session.id)) })) });
  }
  configuredExecutable(provider) { return vscode.workspace.getConfiguration?.('multipleIAAgents').get(`executables.${provider}`, '') || ''; }
  async pickFolder(defaultPath) {
    const chosen = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      openLabel: t('Usar carpeta para el agente'), defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : vscode.workspace.workspaceFolders?.[0]?.uri });
    if (!chosen?.length) return;
    if (chosen[0].scheme !== 'file') throw new Error(t('Esta versión admite carpetas locales.'));
    return fs.realpath(chosen[0].fsPath);
  }
  async pickAgent() {
    return vscode.window.showQuickPick([
      { label: 'Codex', provider: 'codex', description: t('Ejecutar Codex CLI') },
      { label: 'Claude', provider: 'claude', description: t('Ejecutar Claude Code CLI') },
      { label: 'Ollama', provider: 'ollama', description: t('Chat local: ollama run <modelo>') },
      { label: t('Terminal libre'), provider: 'terminal', description: t('Shell sin agente') }
    ], { title: t('Agente de la sesión') });
  }
  async pickModel() {
    const models = await cli.listOllamaModels(this.configuredExecutable('ollama'));
    if (!models.length) throw new Error(t('Ollama no tiene modelos instalados. Instala uno antes de crear la sesión.'));
    return vscode.window.showQuickPick(models, { title: t('Modelo instalado de Ollama') });
  }
  async createSession() {
    const selected = await this.pickAgent(); if (!selected) return;
    const model = selected.provider === 'ollama' ? await this.pickModel() : undefined;
    if (selected.provider === 'ollama' && !model) return;
    const root = await this.pickFolder(); if (!root) return;
    const baseName = `${selected.label || cli.AGENTS[selected.provider].label} · ${path.basename(root) || root}`;
    let name = baseName;
    for (let index = 2; this.sessions.some(session => session.name === name); index++) name = `${baseName} (${index})`;
    const session = { id: randomUUID(), name, root, provider: selected.provider, ...(model ? { model } : {}) };
    await this.showTerminal(session);
    this.sessions.push(session); this.activeId = session.id;
    await this.persist();
  }
  async createTerminalSession(provider = 'terminal', root, label) {
    if (!['codex', 'claude', 'ollama', 'terminal'].includes(provider)) throw new Error(t('Agente no disponible.'));
    root ||= await this.pickFolder(); if (!root) return;
    root = await core.resolveEntry(root);
    const model = provider === 'ollama' ? await this.pickModel() : undefined;
    if (provider === 'ollama' && !model) return;
    const base = (label || (provider === 'terminal' ? 'Terminal' : 'Terminal ' + cli.AGENTS[provider].label)) + ' · ' + (path.basename(root) || root);
    let name = base; for (let index = 2; this.sessions.some(s => !s.closed && s.name === name); index++) name = base + ' (' + index + ')';
    const session = { id: randomUUID(), name, root, provider, mode: 'terminal', permission: 'ask', ...(model ? { model } : {}) };
    const previousActive = this.activeId; this.sessions.push(session); this.activeId = session.id;
    try { await this.showTerminal(session); }
    catch (error) { this.sessions = this.sessions.filter(s => s !== session); this.activeId = previousActive; throw error; }
    await this.persist(); return session;
  }
  async ensureAgent(session) {
    if (session.needsAgentSelection) {
      const selected = await this.pickAgent(); if (!selected) return false;
      const model = selected.provider === 'ollama' ? await this.pickModel() : undefined;
      if (selected.provider === 'ollama' && !model) return false;
      session.provider = selected.provider;
      delete session.needsAgentSelection;
      if (model) session.model = model; else delete session.model;
    }
    return true;
  }
  resolveInvocation(session) {
    return cli.agentInvocation(session, this.configuredExecutable(session.provider), session.provider === 'claude' ? claudeCli.officialBinary(vscode) : undefined);
  }
  async showTerminal(session) {
    let terminal = this.terminals.get(session.id);
    if (terminal && vscode.window.terminals.includes(terminal)) { terminal.show(); return terminal; }
    if (!vscode.workspace.isTrusted) throw new Error(t('Confía en el workspace para ejecutar el agente.'));
    if (!await this.ensureAgent(session)) return;
    const root = await core.resolveEntry(session.root);
    if (!(await fs.stat(root)).isDirectory()) throw new Error(t('La carpeta de la sesión ya no existe.'));
    const invocation = session.provider === 'terminal' ? {} : await this.resolveInvocation(session);
    // Claude Code runs unmodified with the user's own sign-in; the chat only pins its conversation id.
    if (session.provider === 'claude') invocation.shellArgs = [...invocation.shellArgs, ...await claudeCli.conversationArguments(session)];
    const location = session.provider === 'claude' ? { viewColumn: vscode.ViewColumn.Active }
      : [...this.terminals.values()].some(value => vscode.window.terminals.includes(value))
        ? { viewColumn: vscode.ViewColumn.Beside } : vscode.TerminalLocation.Editor;
    const options = { name: session.name, cwd: vscode.Uri.file(root), location,
      isTransient: true, waitOnExit: true, ...invocation, env: { ...invocation.env, [SESSION_ENV]: session.id, TERM: 'xterm-256color', COLORTERM: 'truecolor' } };
    terminal = vscode.window.createTerminal(options);
    this.terminals.set(session.id, terminal);
    this.log(`Iniciar ${session.provider} en terminal de sesión ${session.id}`);
    terminal.show();
    return terminal;
  }
  async selectSession(id, focus = true) {
    const session = this.session(id); if (session.closed) return;
    if (focus && !await this.showTerminal(session)) return;
    this.activeId = id; await this.persist();
  }
  async restartSession(id) {
    const session = this.session(id);
    const answer = await vscode.window.showWarningMessage(t('¿Reiniciar {0}? Se cerrará su proceso actual y se iniciará uno nuevo.', session.name), { modal: true }, t('Reiniciar'));
    if (answer !== t('Reiniciar')) return;
    const terminal = this.terminals.get(id); this.terminals.delete(id);
    terminal?.dispose();
    delete session.closed;
    await this.showTerminal(session); this.activeId = id; await this.persist();
  }
  async closeSession(id) {
    const session = this.session(id);
    const terminal = this.terminals.get(id); this.terminals.delete(id);
    terminal?.dispose();
    session.closed = true;
    if (this.activeId === id) this.activeId = this.sessions.find(other => !other.closed)?.id;
    await this.persist(); return true;
  }
  async reopenSession() {
    const sessions = this.sessions.filter(session => session.closed);
    if (!sessions.length) { vscode.window.showInformationMessage(t('No hay sesiones cerradas.')); return; }
    const selected = await vscode.window.showQuickPick(sessions.map(session => ({ label: session.name, description: session.root, id: session.id })), { title: t('Reabrir una sesión en terminal (proceso nuevo)') });
    if (!selected) return;
    const session = this.session(selected.id);
    if (!await this.showTerminal(session)) return;
    delete session.closed; this.activeId = session.id; await this.persist();
  }
  async terminalClosed(terminal) {
    const entry = [...this.terminals].find(([, value]) => value === terminal);
    if (!entry) return;
    this.terminals.delete(entry[0]);
    const session = this.session(entry[0]); session.closed = true;
    if (this.activeId === session.id) this.activeId = this.sessions.find(other => !other.closed)?.id;
    await this.persist();
  }
  async bindActive() { vscode.window.showInformationMessage(t('Las sesiones nuevas ejecutan su propio agente en una terminal. Usa «Nueva sesión».')); }
}
module.exports = { TerminalSessions, SESSION_ENV };
