'use strict';const {test}=require('node:test');const assert=require('node:assert/strict');const {openOfficialClaude}=require('../src/official-claude');
  function fixture(commands=['claude-vscode.primaryEditor.open']){const calls=[];return{calls,vscode:{workspace:{isTrusted:true},extensions:{getExtension:id=>{assert.equal(id,'anthropic.claude-code');return{activate:async()=>calls.push('activate')};}},commands:{getCommands:async()=>commands,executeCommand:async command=>calls.push(command)}}};}
  test('official Claude graphical chat opens with no workspace-folder requirement and no credentials',async()=>{const f=fixture();assert.equal(await openOfficialClaude(f.vscode),true);assert.deepEqual(f.calls,['activate','claude-vscode.primaryEditor.open']);});
  test('official Claude can use the published new-tab command on other versions',async()=>{const f=fixture(['claude-vscode.editor.open']);await openOfficialClaude(f.vscode);assert.equal(f.calls.at(-1),'claude-vscode.editor.open');});
  test('missing extension, unsupported commands and untrusted workspace give actionable errors',async()=>{
    const missing=fixture();missing.vscode.extensions.getExtension=()=>undefined;await assert.rejects(openOfficialClaude(missing.vscode),/Instala y habilita/);
    const unsupported=fixture([]);await assert.rejects(openOfficialClaude(unsupported.vscode),/Actualiza/);
    const untrusted=fixture();untrusted.vscode.workspace.isTrusted=false;await assert.rejects(openOfficialClaude(untrusted.vscode),/Confia/);
  });

const {OfficialClaudeTabs}=require('../src/official-claude');
test('closing the tracked official tab closes only its linked sessions, even when inactive',async()=>{
  const claude={input:{viewType:'mainThreadWebview-claudeVSCodePanel'},isActive:true};
  const other={input:{viewType:'multipleIAAgents.chat'}};
  let changed;const closed=[];let disposed=false;
  const groups={all:[{tabs:[claude,other]}],onDidChangeTabs:handler=>{changed=handler;return{dispose(){disposed=true;}};},close:async tab=>{groups.all[0].tabs=groups.all[0].tabs.filter(item=>item!==tab);changed({closed:[tab]});}};
  const tracker=new OfficialClaudeTabs({window:{tabGroups:groups}},async id=>closed.push(id),error=>{throw error;});
  await tracker.open('claude-one',async()=>true);
  changed({closed:[other]});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(closed,[]);
  claude.isActive=false;groups.all[0].tabs=[other];changed({closed:[claude]});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(closed,['claude-one']);
  changed({closed:[claude]});await new Promise(resolve=>setImmediate(resolve));assert.equal(closed.length,1);
  tracker.dispose();assert.equal(disposed,true);
});
test('closing a list entry closes its official tab without recursively closing the same entry',async()=>{
  const tab={input:{viewType:'mainThreadWebview-claudeVSCodePanel'},isActive:true};let changed;let tabClosed=0;const closed=[];
  const groups={all:[{tabs:[tab]}],onDidChangeTabs:handler=>{changed=handler;return{dispose(){}};},close:async item=>{assert.equal(item,tab);tabClosed++;groups.all[0].tabs=[];changed({closed:[tab]});}};
  const tracker=new OfficialClaudeTabs({window:{tabGroups:groups}},async id=>closed.push(id),error=>{throw error;});
  await tracker.open('one',async()=>true);await tracker.open('two',async()=>true);
  await tracker.close('one');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(tabClosed,1);assert.deepEqual(closed,['two']);tracker.dispose();
});
test('official tab tracking waits for asynchronous tab creation',async()=>{
  const tab={input:{viewType:'mainThreadWebview-claudeVSCodePanel'},isActive:true};
  const groups={all:[{tabs:[]}],onDidChangeTabs:()=>({dispose(){}})};
  const tracker=new OfficialClaudeTabs({window:{tabGroups:groups}},()=>{},()=>{});
  await tracker.open('one',async()=>{setTimeout(()=>groups.all[0].tabs.push(tab),10);return true;});
  assert.equal(tracker.tabs.get('one'),tab);tracker.dispose();
});
