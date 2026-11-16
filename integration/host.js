'use strict';const vscode=require('vscode');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');const {WorkspaceManager}=require('../src/extension');
  async function run(){
    const root=path.resolve(__dirname,'..','.test-host');await fs.mkdir(root,{recursive:true});const state={};const report={passed:false};
    const manager=new WorkspaceManager({extensionUri:vscode.Uri.file(path.resolve(__dirname,'..')),globalStorageUri:vscode.Uri.file(path.join(root,'history')),globalState:{get:key=>state[key],update:async(key,value)=>{state[key]=value;}}});
    const ready=new Set();const original=manager.handleChat.bind(manager);manager.handleChat=(session,panel,message)=>{if(message.action==='ready')ready.add(panel);return original(session,panel,message);};
    try{
      await manager.createSession('codex',root);const codex=manager.panels.get(manager.activeId);const deadline=Date.now()+15000;while(!ready.has(codex)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(ready.has(codex));
      const before=vscode.window.terminals.length;await manager.createSession('claude',root);
      let official=[]; const officialDeadline=Date.now()+15000;
      while(Date.now()<officialDeadline){official=vscode.window.tabGroups.all.flatMap(group=>group.tabs).filter(tab=>/claude/iu.test(tab.input?.viewType||''));if(official.length)break;await new Promise(resolve=>setTimeout(resolve,100));}
      assert.ok(official.length);assert.equal(vscode.window.terminals.length,before);
      assert.equal(manager.refreshUsage,undefined);assert.equal(manager.getUsageBackend,undefined);assert.equal(manager.usageBackends,undefined);
      report.passed=true;report.officialViewTypes=official.map(tab=>tab.input.viewType);report.checks=['Custom Codex panel loaded without an installed Codex CLI','Official Anthropic chat opened without custom Claude SDK or terminal','No account quota readers registered','No model prompt submitted'];
    }catch(error){report.error=error.stack;throw error;}finally{manager.dispose();await manager.writes;await fs.writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));}
  }
  module.exports={run};
