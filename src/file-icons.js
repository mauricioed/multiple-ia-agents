'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { inside } = require('./core');
class FileIcons {
  roots() { return (vscode.extensions?.all || []).filter(e => e.packageJSON?.contributes?.iconThemes?.length).map(e => e.extensionUri); }
  async load() {
    const id = vscode.workspace.getConfiguration('workbench').get('iconTheme');
    if (this.id === id) return this.loading || this.theme;
    this.id = id; this.theme = undefined;
    const request = this.read(id).then(theme => { if (this.id === id) this.theme = theme; return theme; });
    this.loading = request;
    try { return await request; } finally { if (this.loading === request) this.loading = undefined; }
  }
  async read(id) {
    for (const extension of vscode.extensions?.all || []) {
      const contribution = extension.packageJSON?.contributes?.iconThemes?.find(t => t.id === id);
      if (!contribution) continue;
      const file = path.resolve(extension.extensionUri.fsPath, contribution.path);
      if (!inside(extension.extensionUri.fsPath, file)) return;
      try { return { data: JSON.parse(await fs.readFile(file, 'utf8')), directory: path.dirname(file), root: extension.extensionUri.fsPath }; } catch {}
      return;
    }
  }
  async icon(webview, entry, expanded = false) {
    const theme = await this.load(); if (!theme) return;
    const data = theme.data;
    const name = entry.name || path.basename(entry.rootPath);
    let id;
    if (entry.directory) id = (expanded ? data.folderNamesExpanded?.[name] : data.folderNames?.[name]) || (expanded ? data.folderExpanded : data.folder);
    else {
      id = data.fileNames?.[name];
      const parts = name.split('.');
      for (let start = 1; !id && start < parts.length; start++) id = data.fileExtensions?.[parts.slice(start).join('.')];
      id ||= data.file;
    }
    const definition = data.iconDefinitions?.[id];
    if (!definition?.iconPath) return;
    const target = path.resolve(theme.directory, definition.iconPath);
    if (inside(theme.root, target)) return webview.asWebviewUri(vscode.Uri.file(target)).toString();
  }
}
module.exports = { FileIcons };
