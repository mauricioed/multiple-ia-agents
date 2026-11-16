'use strict';
  const {t}=require('./i18n');
  async function openOfficialClaude(vscode){
    if(!vscode.workspace.isTrusted)throw new Error(t('Confia en el workspace para abrir Claude.'));
    const extension=vscode.extensions.getExtension('anthropic.claude-code');
    if(!extension)throw new Error(t('Instala y habilita Claude Code de Anthropic para abrir su chat oficial.'));
    await extension.activate();
    const commands=await vscode.commands.getCommands(true);
    const command=commands.includes('claude-vscode.primaryEditor.open')?'claude-vscode.primaryEditor.open':commands.includes('claude-vscode.editor.open')?'claude-vscode.editor.open':undefined;
    if(!command)throw new Error(t('Actualiza la extension oficial de Claude y recarga VS Code.'));
    await vscode.commands.executeCommand(command);return true;
  }
  module.exports={openOfficialClaude};

// Track VS Code's public tab objects, without accessing Claude's private state.
class OfficialClaudeTabs {
  constructor(vscode, onClose, onError) {
    this.vscode = vscode; this.onClose = onClose; this.onError = onError;
    this.tabs = new Map();
    this.subscription = vscode.window.tabGroups?.onDidChangeTabs(event => {
      for (const tab of event.closed) {
        for (const [id, tracked] of this.tabs) {
          if (tracked !== tab) continue;
          this.tabs.delete(id);
          Promise.resolve().then(() => this.onClose(id)).catch(this.onError);
        }
      }
    });
  }
  all() { return this.vscode.window.tabGroups?.all.flatMap(group => group.tabs) || []; }
  isClaude(tab) { return /(?:^|-)claudeVSCodePanel$/iu.test(tab.input?.viewType || ''); }
  async open(id, openChat) {
    const before = new Set(this.all());
    const result = await openChat();
    // The official command can resolve before VS Code publishes the new tab.
    for (let attempt = 0; attempt < 40; attempt++) {
      const tabs = this.all().filter(tab => this.isClaude(tab));
      const tab = tabs.find(tab => !before.has(tab)) || tabs.find(tab => tab.isActive) || (tabs.length === 1 ? tabs[0] : undefined);
      if (tab) { this.tabs.set(id, tab); break; }
      if (!this.vscode.window.tabGroups) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return result;
  }
  async close(id) {
    const tab = this.tabs.get(id); this.tabs.delete(id);
    if (tab && this.all().includes(tab)) await this.vscode.window.tabGroups.close(tab);
  }
  dispose() { this.subscription?.dispose(); this.tabs.clear(); }
}
module.exports.OfficialClaudeTabs = OfficialClaudeTabs;
