'use strict';
const vscode = require('vscode');
const { randomBytes } = require('node:crypto');
const { FileIcons } = require('./file-icons');
const { t, language } = require('./i18n');
class Sidebar {
  constructor(manager, extensionUri) { this.manager = manager; this.extensionUri = extensionUri; }
  resolveWebviewView(view) {
    this.view = view; this.icons = new FileIcons();
    const nonce = randomBytes(18).toString('base64');
    const asset = name => view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media'), ...this.icons.roots()] };
    view.webview.onDidReceiveMessage(message => { void this.handle(message); });
    view.webview.html = `<!doctype html><html lang="${language}"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource}; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'"><link rel="stylesheet" href="${asset('sidebar.css')}"></head><body><details class="section" open><summary>${t('Chats')}</summary><nav id="chats" aria-label="${t('Chats')}"></nav></details><details class="section" open><summary id="files-title">${t('Archivos del chat')}</summary><nav id="files" aria-label="${t('Archivos del chat activo')}"></nav></details><p id="sidebar-notice" role="status"></p><script nonce="${nonce}" src="${asset('i18n.js')}"></script><script nonce="${nonce}" src="${asset('icons.js')}"></script><script nonce="${nonce}" src="${asset('sidebar.js')}"></script></body></html>`;
    view.onDidChangeVisibility(() => { if (view.visible) this.publish(); });
  }
  publish() {
    const active = this.manager.sessions.find(s => s.id === this.manager.activeId && !s.closed);
    this.view?.webview.postMessage({ type: 'sidebar', activeId: active?.id, activeRoot: active?.root, activeName: active?.name,
      revision: this.revision || 0, sessions: this.manager.sessions.filter(s => !s.closed).map(s => ({ id: s.id, name: s.name, root: s.root, mode: s.mode, running: this.manager.running.has(s.id) })) });
  }
  refreshFiles() { this.revision = (this.revision || 0) + 1; this.publish(); }
  async handle(message) {
    try {
      if (message?.type === 'ready') { this.publish(); return; }
      let result;
      if (message?.action === 'select') await this.manager.selectSession(message.sessionId);
      else if (message?.action === 'close') await this.manager.closeSession(message.sessionId);
      else if (message?.action === 'list') {
        const entries = await this.manager.fileTree.getChildren(message.parent);
        result = await Promise.all(entries.map(async ({ uri, ...entry }) => ({ ...entry,
          iconUrl: await this.icons?.icon(this.view.webview, entry), expandedIconUrl: entry.directory ? await this.icons?.icon(this.view.webview, entry, true) : undefined })));
      } else if (message?.action === 'open') await this.manager.fileTree.open(message.entry, !!message.preview);
      else return;
      this.view?.webview.postMessage({ type: 'sidebarReply', requestId: message.requestId, result });
    } catch (error) { this.view?.webview.postMessage({ type: 'sidebarReply', requestId: message?.requestId, error: error.message }); }
  }
  dispose() {}
}
module.exports = { Sidebar };
