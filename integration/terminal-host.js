'use strict';
const vscode=require('vscode');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
async function waitFor(predicate){const deadline=Date.now()+10000;while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(predicate(),'VS Code did not report the expected terminal lifecycle change');}
async function run(){
  const root=path.resolve(__dirname,'..','.test-terminal-host');await fs.mkdir(root,{recursive:true});
  const extension=vscode.extensions.getExtension('local-development.multiple-ia-agents');assert.ok(extension);
  const {manager}=await extension.activate();const created=[];const report={passed:false};
  try{
    for(const name of ['first','second']){
      const folder=path.join(root,name);await fs.mkdir(folder,{recursive:true});
      const session=await manager.createTerminalSession('terminal',folder);created.push(session);
      const terminal=manager.terminals.get(session.id);assert.ok(vscode.window.terminals.includes(terminal));
      const actual=await fs.realpath(terminal.creationOptions.cwd.fsPath),expected=await fs.realpath(folder);
      assert.equal(process.platform==='win32'?actual.toLowerCase():actual,process.platform==='win32'?expected.toLowerCase():expected);
    }
    const [first,second]=created;await manager.selectSession(first.id);
    assert.equal(manager.activeId,first.id);assert.equal((await manager.fileTree.getChildren())[0].rootPath,first.root);
    manager.terminals.get(first.id).dispose();await waitFor(()=>first.closed===true);
    assert.equal(second.closed,undefined);assert.ok(manager.terminals.has(second.id));
    await manager.closeSession(second.id);await waitFor(()=>!manager.terminals.has(second.id));
    report.passed=true;report.checks=['Two editor terminals created in different folders','Selecting a session follows its file tree','Closing a native terminal removes its active entry','Closing a list session disposes its terminal','No agent, credential, or model request used'];
  }catch(error){report.error=error.stack;throw error;}
  finally{for(const session of created)if(!session.closed)await manager.closeSession(session.id);await fs.writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));}
}
module.exports={run};
