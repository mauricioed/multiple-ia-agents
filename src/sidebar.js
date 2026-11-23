'use strict';
const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const core = require('./core');
const { missingVaultPath } = require('./github-vault');
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
    view.webview.html = `<!doctype html><html lang="${language}"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource}; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'"><link rel="stylesheet" href="${asset('sidebar.css')}"></head><body><details class="section" open><summary>${t('Chats')}</summary><nav id="chats" aria-label="${t('Chats')}"></nav></details><details class="section" open><summary id="files-title">${t('Archivos del chat')}</summary><nav id="files" aria-label="${t('Archivos del chat activo')}"></nav></details><details id="vault-section" class="section" open hidden><summary>GitHub Markdown Vault <button type="button" id="vault-sync" class="vault-sync" aria-label="${t('Sincronizar')}"></button></summary><nav id="vault-files" aria-label="GitHub Markdown Vault"></nav></details><p id="sidebar-notice" role="status"></p><script nonce="${nonce}" src="${asset('i18n.js')}"></script><script nonce="${nonce}" src="${asset('icons.js')}"></script><script nonce="${nonce}" src="${asset('sidebar.js')}"></script></body></html>`;
    view.onDidChangeVisibility(() => { if (view.visible) this.publish(); });
  }
  publish() {
    const sessions = this.manager.sessions.filter(session => !session.closed).map(({ id, name, root, mode }) => ({ id, name, root, mode }));
    const active = this.manager.sessions.find(s => s.id === this.manager.activeId && !s.closed);
    this.view?.webview.postMessage({ type: 'sidebar', activeId: active?.id, activeRoot: active?.root, activeName: active?.name, vaultChatId: this.manager.supportsVaultChat?.(active) ? active.id : undefined,
      vault: this.manager.vault?.active, vaultFolder: this.manager.vault?.lastFolder, vaultRevision: this.vaultRevision || 0, revision: this.revision || 0, sessions });
  }
  refreshFiles() { this.revision = (this.revision || 0) + 1; return this.publish(); }
  refreshVault() { this.vaultRevision = (this.vaultRevision || 0) + 1; return this.publish(); }
  vaultEntry(vault, segments, entry) {
    return { ...entry, vault: true, rootPath: vault.root, segments };
  }
  async vaultChildren(rootPath, parent, rememberFolder = false) {
    const vault = this.manager.vault?.active;
    if (!vault || rootPath !== vault.root) return [];
    const root = await this.manager.vault.localRoot(vault, true);
    if (!root) return [];
    if (!parent) return [this.vaultEntry(vault, [], { name: vault.name, directory: true, root: true })];
    try {
      const target = await this.vaultTarget(root, parent.segments);
      const segments = path.relative(root, target).split(path.sep).filter(Boolean);
      const entries = await core.listDirectory(root, segments);
      if (rememberFolder) await this.manager.vault.rememberFolder(vault.root, segments);
      return entries.filter(entry => entry.name.toLowerCase() !== '.git' && (entry.directory || entry.markdown)).map(entry => this.vaultEntry(vault, [...segments, entry.name], entry));
    } catch (error) {
      if (missingVaultPath(error)) return [];
      throw error;
    }
  }
  async vaultTarget(root, segments) {
    const target = await core.resolveEntry(root, segments);
    if (path.relative(root, target).split(path.sep).some(segment => segment.toLowerCase() === '.git')) {
      throw new Error(t('Ruta de archivo no válida.'));
    }
    return target;
  }
  async openVault(entry, preview) {
    const vault = this.manager.vault?.active;
    if (!vault || vault.root !== entry.rootPath) return;
    const root = await this.manager.vault.localRoot(vault, true);
    if (!root) return;
    const target = await this.vaultTarget(root, entry.segments);
    return this.manager.fileTree.openPath({ root }, entry.segments, target, preview);
  }
  async vaultFileForTrash(entry) {
    const vault = this.manager.vault?.active;
    if (!entry?.vault || !vault || entry.rootPath !== vault.root) throw new Error(t('La bóveda activa ha cambiado.'));
    const root = await this.manager.vault.localRoot(vault);
    const segments = entry.segments;
    const target = await this.vaultTarget(root, segments);
    if (!segments?.length || path.relative(path.join(root, ...segments), target) ||
        !/\.(md|markdown)$/iu.test(target) || !(await fs.lstat(target)).isFile()) {
      throw new Error(t('Selecciona un archivo Markdown dentro de GitHub Markdown Vault.'));
    }
    return target;
  }

  async trashVaultFile(entry) {
    await this.vaultFileForTrash(entry);
    const move = t('Mover a la papelera');
    const choice = await vscode.window.showWarningMessage(
      t('¿Mover «{0}» a la papelera?', entry.segments.join('/')), { modal: true }, move);
    if (choice !== move) return false;
    const confirmed = await this.vaultFileForTrash(entry);
    await vscode.workspace.fs.delete(vscode.Uri.file(confirmed), { recursive: false, useTrash: true });
    await this.refreshVault();
    return true;
  }

  async handle(message) {
    try {
      if (message?.type === 'ready') { this.publish(); return; }
      let result;
      if (message?.action === 'select') await this.manager.selectSession(message.sessionId);
      else if (message?.action === 'close') await this.manager.closeSession(message.sessionId);
      else if (message?.action === 'vaultStatus') result = await this.manager.vault.syncStatus(message.vaultRoot);
      else if (message?.action === 'vaultSync') {
        if (!message.vaultRoot || this.manager.vault.active?.root !== message.vaultRoot) throw new Error(t('La bóveda activa ha cambiado.'));
        result = await this.manager.vault.run('sync');
        if (result) await this.refreshVault();
      }
      else if (message?.action === 'vaultInsert') await this.manager.insertVaultDocument(message.sessionId, message.entry);
      else if (message?.action === 'vaultTrash') result = await this.trashVaultFile(message.entry);
      else if (message?.action === 'list') {
        const entries = message.vaultRoot || message.parent?.vault
          ? await this.vaultChildren(message.parent?.rootPath || message.vaultRoot, message.parent, message.rememberFolder === true)
          : await this.manager.fileTree.getChildren(message.parent);
        result = await Promise.all(entries.map(async ({ uri, ...entry }) => ({ ...entry,
          iconUrl: await this.icons?.icon(this.view.webview, entry), expandedIconUrl: entry.directory ? await this.icons?.icon(this.view.webview, entry, true) : undefined })));
      } else if (message?.action === 'open') {
        if (message.entry?.vault) await this.openVault(message.entry, !!message.preview);
        else await this.manager.fileTree.open(message.entry, !!message.preview);
      }
      else return;
      this.view?.webview.postMessage({ type: 'sidebarReply', requestId: message.requestId, result });
    } catch (error) {
      const missingEntry = message?.entry?.vault && missingVaultPath(error);
      this.view?.webview.postMessage({ type: 'sidebarReply', requestId: message?.requestId, error: missingEntry ? undefined : error.message });
    }
  }
  dispose() {}
}
module.exports = { Sidebar };
