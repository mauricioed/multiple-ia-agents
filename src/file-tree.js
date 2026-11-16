'use strict';
const { t, language } = require('./i18n');
const vscode = require('vscode');
const path = require('node:path');
const core = require('./core');

class ChatFileTree {
  constructor(manager, { includeSessions = false, includeFiles = true } = {}) {
    this.manager = manager;
    this.includeSessions = includeSessions; this.includeFiles = includeFiles;
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
  }
  activeSession() {
    return this.manager.sessions.find(session => session.id === this.manager.activeId && !session.closed);
  }
  sync() {
    const session = this.activeSession();
    const key = JSON.stringify([
      session ? [session.id, session.name, session.root] : null,
      this.includeSessions ? this.manager.sessions.filter(item => !item.closed).map(item => [item.id, item.name, item.root, item.provider, this.manager.panels?.has(item.id)]) : null
    ]);
    if (this.view) {
      this.view.title = this.includeSessions ? t('Chats') : session?.name || t('Archivos del chat');
      this.view.description = undefined;
      this.view.message = session ? undefined : t('Selecciona o crea un chat para explorar sus archivos.');
    }
    if (key === this.key) return;
    this.key = key;
    this.clearActivation();
    this.refresh();
  }
  refresh() { this.changed.fire(); }
  getTreeItem(entry) {
    if (entry.kind === 'session') {
      const session = this.manager.session(entry.sessionId);
      const item = new vscode.TreeItem(session.name, vscode.TreeItemCollapsibleState.None);
      item.id = 'chat:' + session.id;
      item.contextValue = 'chatSession';
      const status = this.manager.panels?.has(session.id) ? 'open' : 'closed';
      item.iconPath = {
        light: vscode.Uri.file(path.join(__dirname, '..', 'media', 'chat-status-' + status + '-light.svg')),
        dark: vscode.Uri.file(path.join(__dirname, '..', 'media', 'chat-status-' + status + '-dark.svg'))
      };
      item.tooltip = session.root;
      item.description = session.id === this.manager.activeId ? t('Activo') : undefined;
      item.accessibilityInformation = { label: session.name + (session.id === this.manager.activeId ? t(', chat activo') : '') };
      item.command = { command: 'multipleIAAgents.selectChat', title: t('Abrir chat'), arguments: [entry] };
      return item;
    }
    const item = new vscode.TreeItem(entry.uri, entry.directory
      ? entry.root ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
    item.id = JSON.stringify([entry.sessionId, entry.rootPath, entry.segments]);
    item.resourceUri = entry.uri;
    item.iconPath = new vscode.ThemeIcon(entry.directory ? 'folder' : 'file');
    item.contextValue = entry.directory ? 'chatFolder' : entry.markdown ? 'chatMarkdown' : 'chatFile';
    if (entry.root) {
      item.label = path.basename(entry.rootPath) || entry.rootPath;
      if (this.includeSessions) {
        // A heading without an icon lets VS Code align the sibling chat rows
        // with the left edge instead of reserving an empty disclosure column.
        item.resourceUri = undefined;
        item.iconPath = undefined;
        item.tooltip = entry.rootPath;
        item.description = t('Archivos del chat activo');
      }
    }
    if (!entry.directory) item.command = {
      command: 'multipleIAAgents.openChatFile', title: t('Abrir archivo'), arguments: [entry]
    };
    return item;
  }
  async getChildren(parent) {
    const session = this.activeSession();
    if (!parent) {
      const chats = this.includeSessions ? this.manager.sessions.filter(item => !item.closed).map(item => ({ kind: 'session', sessionId: item.id })) : [];
      if (session && this.includeFiles) chats.push({ sessionId: session.id, rootPath: session.root, segments: [], directory: true, root: true, uri: vscode.Uri.file(session.root) });
      return chats;
    }
    if (!session || parent.kind === 'session' || parent.sessionId !== session.id || parent.rootPath !== session.root || !parent.directory) return [];
    const rootPath = session.root;
    const listing = await core.listDirectory(rootPath, parent.segments);
    if (session.closed || session.root !== rootPath || session !== this.activeSession()) return [];
    return listing.map(entry => {
      const segments = [...parent.segments, entry.name];
      return { ...entry, sessionId: session.id, rootPath, segments, uri: vscode.Uri.file(path.join(rootPath, ...segments)) };
    });
  }
  clearActivation() { this.lastActivation = undefined; }
  async activate(entry, now = Date.now()) {
    if (!entry || entry.directory) { this.clearActivation(); return; }
    if (!entry.markdown) { this.clearActivation(); return this.open(entry); }
    // TreeItem commands do not expose mouse events. Two native open gestures on
    // the same selected resource within the double-click interval activate it.
    const key = JSON.stringify([entry.sessionId, entry.rootPath, entry.segments]);
    const previous = this.lastActivation;
    this.lastActivation = { key, time: now };
    if (!previous || previous.key !== key || now - previous.time < 0 || now - previous.time > 500) return;
    this.clearActivation();
    return this.open(entry, true);
  }
  async open(entry, markdown = false) {
    if (!entry || entry.directory) return;
    const session = this.manager.session(entry.sessionId);
    if (session.closed || session.root !== entry.rootPath) throw new Error(t('La carpeta del chat ha cambiado. Actualiza el explorador.'));
    const target = await core.resolveEntry(session.root, entry.segments);
    if (markdown) return this.manager.openMarkdown(session, entry.segments);
    if (/\.(docx?|docm|dotx?|dotm)$/iu.test(target)) {
      const opened = await vscode.env.openExternal(vscode.Uri.file(target));
      if (!opened) throw new Error(t('No se pudo abrir el documento Word. Asocia este tipo de archivo con Microsoft Word o LibreOffice en tu equipo.'));
      return;
    }
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target));
  }
  dispose() { this.changed.dispose(); }
}
module.exports = { ChatFileTree };
