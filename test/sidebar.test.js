'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const fake = { workspace:{getConfiguration:()=>({get:()=> 'theme'})}, extensions:{all:[]}, Uri:{file:fsPath=>({fsPath})} };
const load = Module._load;
Module._load = function(name,...args) { return name === 'vscode' ? fake : load.call(this,name,...args); };
const { Sidebar } = require('../src/sidebar');
const { FileIcons } = require('../src/file-icons');
Module._load = load;
test('compact sidebar follows the active chat and contains only chats and files without usage rows', async () => {
  const messages = []; const opened = [];
  const manager = { sessions:[{id:'one',name:'Custom title',root:'.'}],activeId:'one',running:new Map(),
    fileTree:{getChildren:async()=>[{name:'doc.md',uri:{},segments:['doc.md']}],open:async(entry,preview)=>opened.push([entry,preview])},
    selectSession:async id=>{manager.activeId=id;} };
  const view = new Sidebar(manager); view.view={webview:{postMessage:message=>messages.push(message)}};
  await view.publish(); assert.equal(messages[0].activeName,'Custom title');
  await view.handle({action:'list',requestId:1}); assert.equal(messages.at(-1).result[0].uri,undefined);
  await view.handle({action:'open',requestId:2,entry:{name:'doc.md'},preview:true}); assert.deepEqual(opened,[[{name:'doc.md'},true]]);
  await view.refreshFiles(); assert.equal(messages.at(-1).revision,1);
});
test('compact explorer reuses file theme icons for concurrent requests and rejects paths outside the extension', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'sidebar-icons-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'theme.json'),JSON.stringify({fileExtensions:{md:'md'},folder:'folder',iconDefinitions:{md:{iconPath:'markdown.svg'},folder:{iconPath:'../outside.svg'}}}));
  fake.extensions.all=[{extensionUri:{fsPath:root},packageJSON:{contributes:{iconThemes:[{id:'theme',path:'theme.json'}]}}}];
  const icons = new FileIcons(); const webview={asWebviewUri:uri=>uri.fsPath};
  const results=await Promise.all([icons.icon(webview,{name:'a.md'}),icons.icon(webview,{name:'b.md'})]);
  assert.deepEqual(results,[path.join(root,'markdown.svg'),path.join(root,'markdown.svg')]);
  assert.equal(await icons.icon(webview,{name:'folder',directory:true}),undefined);
});
