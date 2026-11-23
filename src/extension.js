'use strict';
const { t, language } = require('./i18n');
const vscode = require('vscode');
const fs = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const core = require('./core');
const { ChatFileTree } = require('./file-tree');
const { GitHubVault } = require('./github-vault');
const { ChatSessions } = require('./chat-sessions');

class WorkspaceManager extends ChatSessions {
  async openMarkdown(session, segments) {
    // Serialize preview/move commands so double clicks on different files cannot
    // detach an unrelated editor that became active during another request.
    const operation = (this.markdownQueue || Promise.resolve()).then(() => this.openMarkdownViewer(session, segments));
    this.markdownQueue = operation.catch(() => {});
    return operation;
  }
  async openMarkdownViewer(session, segments) {
    const target = await core.resolveEntry(session.root, segments);
    if (!/\.(md|markdown)$/iu.test(target) || !(await fs.stat(target)).isFile()) throw new Error(t('Selecciona un archivo Markdown.'));
    const extension = vscode.extensions.getExtension('vscode.markdown-language-features');
    if (!extension) throw new Error(t('El editor Markdown de VS Code no está disponible. Habilita la extensión integrada Markdown Language Features.'));
    await extension.activate();
    const viewType = 'vscode.markdown.editor';
    const supported = extension.packageJSON?.contributes?.customEditors?.some(editor => editor.viewType === viewType);
    if (!supported) throw new Error(t('Esta version de VS Code no incluye Markdown Editor. Actualiza VS Code a 1.145 o posterior.'));
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('workbench.action.moveEditorToNewWindow')) throw new Error(t('Tu versión de VS Code no ofrece ventanas flotantes para editores.'));
    const uri = vscode.Uri.file(target);
    const previous = this.markdownViewers?.get(target);
    const existing = previous && vscode.window.tabGroups.all.some(group => group.tabs.includes(previous.tab));
    const options = { preview: false, preserveFocus: false };
    if (existing && previous.group.viewColumn !== undefined) options.viewColumn = previous.group.viewColumn;
    await vscode.commands.executeCommand('vscode.openWith', uri, viewType, options);
    // Let VS Code reveal an existing auxiliary-window editor. Its group may
    // not become active in this window's API, and must never be moved twice.
    if (existing) return;
    const isPreview = tab => tab?.input instanceof vscode.TabInputCustom
      && tab.input.viewType === viewType && tab.input.uri.toString() === uri.toString();
    let active;
    for (let attempt = 0; attempt < 20; attempt++) {
      active = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (isPreview(active)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!isPreview(active)) throw new Error(t('No se pudo enfocar el visor Markdown; no se ha movido ningún otro editor.'));
    if (existing && active === previous.tab) return;
    const sourceGroup = vscode.window.tabGroups.activeTabGroup;
    await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
    for (let attempt = 0; attempt < 30; attempt++) {
      const group = vscode.window.tabGroups.all.find(group => group !== sourceGroup && group.tabs.some(isPreview));
      if (group) {
        this.markdownViewers ||= new Map();
        this.markdownViewers.set(target, { group, tab: group.tabs.find(isPreview) });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(t('El visor se ha abierto, pero VS Code no ha confirmado su traslado a la ventana flotante.'));
  }
  publish() {
    super.publish();
    this.fileTree?.sync(); this.sidebar?.publish();
  }
  dispose() { require('./ollama-runtime').stopServer(); super.dispose(); }

}

function activate(context) {
  const output = vscode.window.createOutputChannel('Multiple IA Agents');
  const manager = new WorkspaceManager(context, output);
  manager.fileTree = new ChatFileTree(manager);
  manager.vault = new GitHubVault(context);
  const { Sidebar } = require('./sidebar');
  manager.sidebar = new Sidebar(manager, context.extensionUri);
  const sidebarRegistration = vscode.window.registerWebviewViewProvider('multipleIAAgents.explorer', manager.sidebar);
  const run = action => async (...args) => {
    if (manager.busy) return;
    manager.busy = true;
    try { await action(...args); } catch (error) { manager.log(error.stack || error.message); vscode.window.showErrorMessage(error.message); }
    finally { manager.busy = false; }
  };
  context.subscriptions.push(manager, output, manager.fileTree, manager.sidebar, sidebarRegistration,
    vscode.window.registerWebviewPanelSerializer('multipleIAAgents.chat', { deserializeWebviewPanel: (panel, state) => manager.restoreChatPanel(panel, state) }),
    vscode.commands.registerCommand('multipleIAAgents.refreshFiles', () => { manager.sidebar.refreshFiles(); manager.sidebar.refreshVault(); }),
    vscode.commands.registerCommand('multipleIAAgents.openChatFile', async entry => {
      try { await manager.fileTree.activate(entry); } catch (error) { vscode.window.showErrorMessage(error.message); }
    }),
    vscode.commands.registerCommand('multipleIAAgents.previewMarkdown', async entry => {
      try { await manager.fileTree.open(entry, true); } catch (error) { vscode.window.showErrorMessage(error.message); }
    }),
    vscode.commands.registerCommand('multipleIAAgents.selectChat', run(entry => manager.selectSession(entry.sessionId))),
    vscode.commands.registerCommand('multipleIAAgents.closeChat', run(entry => manager.closeSession(entry.sessionId))),
    vscode.commands.registerCommand('multipleIAAgents.reopen', run(() => manager.reopenSession())),
    ...['codex', 'claude', 'ollama', 'terminal'].map(provider => vscode.commands.registerCommand('multipleIAAgents.newTerminal.' + provider, run(() => manager.createTerminalSession(provider)))),
    ...['codex', 'claude', 'ollama'].map(provider => vscode.commands.registerCommand('multipleIAAgents.new.' + provider, run(() => manager.createSession(provider)))),
    vscode.commands.registerCommand('multipleIAAgents.new', run(() => manager.createSession())),
    vscode.commands.registerCommand('multipleIAAgents.bind', run(() => manager.bindActive())),
    vscode.commands.registerCommand('multipleIAAgents.show', () => vscode.commands.executeCommand('multipleIAAgents.explorer.focus')),
    vscode.window.onDidCloseTerminal(terminal => {
      manager.terminalClosed(terminal).catch(error => vscode.window.showErrorMessage(error.message));
    }),
    vscode.window.onDidChangeActiveTerminal(terminal => {
      if (manager.busy || manager.navigating) return;
      const entry = [...manager.terminals].find(([, value]) => value === terminal);
      if (entry) manager.selectSession(entry[0], false).catch(error => vscode.window.showErrorMessage(error.message));
    })
  );
  return { manager };
}
module.exports = { activate, WorkspaceManager };
