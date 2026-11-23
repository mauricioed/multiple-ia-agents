'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openOfficialClaude, OfficialClaudeTabs } = require('../src/official-claude');

const root = __dirname;
function fixture(commands = ['claude-vscode.primaryEditor.open']) {
  const calls = [];
  return { calls, vscode: {
    workspace: { isTrusted: true, workspaceFolders: [{ uri: { fsPath: root } }] },
    window: { showWarningMessage: async () => undefined },
    Uri: { file: fsPath => ({ fsPath }) },
    extensions: { getExtension: id => {
      assert.equal(id, 'anthropic.claude-code');
      return { activate: async () => calls.push('activate') };
    } },
    commands: { getCommands: async () => commands, executeCommand: async (...args) => calls.push(args) }
  } };
}

test('opens native Claude in the first workspace folder when it matches the chat', async () => {
  const f = fixture();
  assert.equal(await openOfficialClaude(f.vscode, root), true);
  assert.deepEqual(f.calls, ['activate', ['claude-vscode.primaryEditor.open']]);
});

test('uses the official new-tab command on older versions', async () => {
  const f = fixture(['claude-vscode.editor.open']);
  await openOfficialClaude(f.vscode, root);
  assert.deepEqual(f.calls.at(-1), ['claude-vscode.editor.open']);
});

test('opens a non-primary Claude folder in the current window only on confirmation', async () => {
  const f = fixture();
  const selected = path.dirname(root);
  f.vscode.workspace.workspaceFolders.push({ uri: { fsPath: selected } });
  assert.equal(await openOfficialClaude(f.vscode, selected), false);
  assert.deepEqual(f.calls, []);
  f.vscode.window.showWarningMessage = async (_message, options, button) => {
    assert.equal(options.detail, selected);
    return button;
  };
  assert.equal(await openOfficialClaude(f.vscode, selected), false);
  assert.deepEqual(f.calls, [['vscode.openFolder', { fsPath: selected }, { forceReuseWindow: true }]]);
});

test('an empty window never launches Claude in its default directory', async () => {
  const f = fixture();
  f.vscode.workspace.workspaceFolders = undefined;
  assert.equal(await openOfficialClaude(f.vscode, root), false);
  assert.deepEqual(f.calls, []);
});

test('missing extension, unsupported commands and untrusted workspace give actionable errors', async () => {
  const missing = fixture();
  missing.vscode.extensions.getExtension = () => undefined;
  await assert.rejects(openOfficialClaude(missing.vscode, root), /Instala y habilita/);
  const unsupported = fixture([]);
  await assert.rejects(openOfficialClaude(unsupported.vscode, root), /Actualiza/);
  const untrusted = fixture();
  untrusted.vscode.workspace.isTrusted = false;
  await assert.rejects(openOfficialClaude(untrusted.vscode, root), /Confia/);
});

test('closing the tracked official tab closes only its linked sessions, even when inactive',async()=>{
  const claude={input:{viewType:'mainThreadWebview-claudeVSCodePanel'},isActive:true};
  const other={input:{viewType:'multipleIAAgents.chat'}};
  let changed;const closed=[];let disposed=false;
  const groups={all:[{tabs:[other]}],onDidChangeTabs:handler=>{changed=handler;return{dispose(){disposed=true;}};},close:async tab=>{groups.all[0].tabs=groups.all[0].tabs.filter(item=>item!==tab);changed({closed:[tab]});}};
  const tracker=new OfficialClaudeTabs({window:{tabGroups:groups}},async id=>closed.push(id),error=>{throw error;});
  await tracker.open('claude-one',async()=>{ groups.all[0].tabs.push(claude); return true; });
  changed({closed:[other]});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(closed,[]);
  claude.isActive=false;groups.all[0].tabs=[other];changed({closed:[claude]});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(closed,['claude-one']);
  changed({closed:[claude]});await new Promise(resolve=>setImmediate(resolve));assert.equal(closed.length,1);
  tracker.dispose();assert.equal(disposed,true);
});
test('closing a list entry closes its official tab without recursively closing the same entry',async()=>{
  const tab={input:{viewType:'mainThreadWebview-claudeVSCodePanel'},isActive:true};let changed;let tabClosed=0;const closed=[];
  const groups={all:[{tabs:[]}],onDidChangeTabs:handler=>{changed=handler;return{dispose(){}};},close:async item=>{assert.equal(item,tab);tabClosed++;groups.all[0].tabs=[];changed({closed:[tab]});}};
  const tracker=new OfficialClaudeTabs({window:{tabGroups:groups}},async id=>closed.push(id),error=>{throw error;});
  await tracker.open('one',async()=>{ groups.all[0].tabs.push(tab); return true; });
  assert.equal(await tracker.open('two',async()=>false),false);
  await tracker.close('one');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(tabClosed,1);assert.deepEqual(closed,[]);tracker.dispose();
});
test('official tab tracking waits for asynchronous tab creation',async()=>{
  const tab={input:{viewType:'mainThreadWebview-claudeVSCodePanel'},isActive:true};
  const groups={all:[{tabs:[]}],onDidChangeTabs:()=>({dispose(){}})};
  const tracker=new OfficialClaudeTabs({window:{tabGroups:groups}},()=>{},()=>{});
  await tracker.open('one',async()=>{setTimeout(()=>groups.all[0].tabs.push(tab),10);return true;});
  assert.equal(tracker.tabs.get('one'),tab);tracker.dispose();
});
