'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const opened = [];
const fake = {
  EventEmitter: class { event = () => {}; fire() {} dispose() {} },
  Uri: { file: fsPath => ({ fsPath }), parse: value => ({ value }) },
  TreeItem: class { constructor(uri, collapsibleState) { this.resourceUri = uri; this.collapsibleState = collapsibleState; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(id) { this.id = id; } },
  commands: { executeCommand: async (...args) => opened.push(args) }
};
const original = Module._load;
Module._load = function(name, ...args) { return name === 'vscode' ? fake : original.call(this, name, ...args); };
const { ChatFileTree } = require('../src/file-tree');
Module._load = original;

test('native tree follows the active chat, uses resource icons and rejects stale or escaping entries', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-tree-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'folder'));
  await fs.writeFile(path.join(root, 'doc.md'), '# Test');
  const first = { id: 'first', root, name: 'First' };
  const second = { id: 'second', root, name: 'Second' };
  const manager = { sessions: [first, second], activeId: first.id, session: id => manager.sessions.find(s => s.id === id) };
  const tree = new ChatFileTree(manager);
  t.after(() => tree.dispose());
  tree.view = {};
  tree.sync();
  assert.equal(tree.view.title, 'First');
  const [parent] = await tree.getChildren();
  const children = await tree.getChildren(parent);
  assert.deepEqual(children.map(e => e.name), ['folder', 'doc.md']);
  const file = children[1];
  const item = tree.getTreeItem(file);
  assert.equal(item.resourceUri.fsPath, path.join(root, 'doc.md'));
  assert.equal(item.iconPath.id, 'file');
  assert.equal(tree.getTreeItem(children[0]).iconPath.id, 'folder');
  assert.equal(item.contextValue, 'chatMarkdown');
  await tree.open(file);
  assert.equal(opened.at(-1)[0], 'vscode.open');
  assert.equal(opened.at(-1)[1].fsPath, await fs.realpath(path.join(root, 'doc.md')));
  await assert.rejects(tree.open({ ...file, segments: ['..', 'outside'] }), /Ruta/);
  manager.activeId = second.id;
  tree.sync();
  assert.equal(tree.view.title, 'Second');
  assert.deepEqual(await tree.getChildren(parent), []);
  assert.notEqual(tree.getTreeItem((await tree.getChildren())[0]).id, tree.getTreeItem(parent).id);
  first.closed = true;
  await assert.rejects(tree.open(file), /chat/);
  second.closed = true;
  tree.sync();
  assert.deepEqual(await tree.getChildren(), []);
  assert.ok(tree.view.message);
});

test('Markdown activates only after two clicks on the same resource and resets after opening or changing chat', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-activation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'first.md'), '# First');
  await fs.writeFile(path.join(root, 'second.md'), '# Second');
  await fs.writeFile(path.join(root, 'note.txt'), 'Text');
  const first = { id: 'first', root };
  const second = { id: 'second', root };
  const previews = [];
  const manager = { sessions: [first, second], activeId: 'first', session: id => manager.sessions.find(s => s.id === id),
    openMarkdown: async (session, segments) => previews.push({ id: session.id, segments }) };
  const tree = new ChatFileTree(manager);
  t.after(() => tree.dispose());
  tree.sync();
  const [parent] = await tree.getChildren();
  const entries = await tree.getChildren(parent);
  const a = entries.find(e => e.name === 'first.md');
  const b = entries.find(e => e.name === 'second.md');
  const text = entries.find(e => e.name === 'note.txt');
  const before = opened.length;
  await tree.activate(a, 1000);
  assert.equal(opened.length, before, 'single click must not open the source editor');
  assert.equal(previews.length, 0, 'single click must not open the Markdown editor');
  await tree.activate(a, 1200);
  assert.deepEqual(previews, [{ id: 'first', segments: ['first.md'] }]);
  await tree.activate(a, 1300);
  assert.equal(previews.length, 1, 'third click starts a new pair');
  await tree.activate(a, 2000);
  assert.equal(previews.length, 1, 'slow separate clicks must not open');
  await tree.activate(b, 2100);
  assert.equal(previews.length, 1, 'clicks on different documents must not open');
  tree.clearActivation();
  await tree.activate(b, 2200);
  assert.equal(previews.length, 1, 'changing selection clears the pending pair');
  manager.activeId = 'second'; tree.sync();
  await tree.activate(b, 2300);
  assert.equal(previews.length, 1, 'changing chat clears the pending pair');
  tree.clearActivation();
  await tree.activate(text, 2400);
  assert.equal(opened.length, before + 1, 'non-Markdown files retain their original opening behavior');
});

test('chat panel lists open chats followed by the selected chat file tree', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unified-chat-tree-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const a = path.join(root, 'a'); const b = path.join(root, 'b');
  await fs.mkdir(a); await fs.mkdir(b);
  await fs.writeFile(path.join(a, 'first.md'), '# First');
  await fs.writeFile(path.join(b, 'second.md'), '# Second');
  const first = { id: 'first', name: 'Codex First', provider: 'codex', root: a };
  const second = { id: 'second', name: 'Claude Second', provider: 'claude', root: b };
  const closed = { id: 'closed', name: 'Closed', provider: 'codex', root: a, closed: true };
  const manager = { sessions: [first, closed, second], activeId: 'first', panels: new Map([['first', {}]]), session: id => manager.sessions.find(s => s.id === id) };
  const tree = new ChatFileTree(manager, { includeSessions: true });
  t.after(() => tree.dispose()); tree.view = {}; tree.sync();
  assert.equal(tree.view.title, 'Chats');
  const items = await tree.getChildren();
  assert.deepEqual(items.map(item => item.kind || 'files'), ['session', 'session', 'files']);
  assert.deepEqual(items.slice(0, 2).map(item => item.sessionId), ['first', 'second']);
  const firstRoot = items[2];
  assert.equal(firstRoot.rootPath, a);
  assert.deepEqual(await tree.getChildren(items[0]), []);
  assert.equal(tree.getTreeItem(items[0]).command.command, 'multipleIAAgents.selectChat');
  assert.match(tree.getTreeItem(items[0]).iconPath.light.fsPath, /chat-status-open-light\.svg$/);
  assert.match(tree.getTreeItem(items[1]).iconPath.dark.fsPath, /chat-status-closed-dark\.svg$/);
  assert.equal(tree.getTreeItem(items[0]).collapsibleState, fake.TreeItemCollapsibleState.None);
  assert.equal(tree.getTreeItem(items[0]).description, 'Activo');
  assert.deepEqual((await tree.getChildren(firstRoot)).map(item => item.name), ['first.md']);
  manager.activeId = 'second'; tree.sync();
  const switched = await tree.getChildren();
  assert.equal(switched.length, 3);
  const secondRoot = switched[2];
  assert.equal(secondRoot.rootPath, b);
  assert.equal(tree.getTreeItem(items[1]).description, 'Activo');
  assert.deepEqual((await tree.getChildren(secondRoot)).map(item => item.name), ['second.md']);
  assert.deepEqual(await tree.getChildren(firstRoot), []);
  first.closed = true; tree.sync();
  assert.equal((await tree.getChildren()).length, 2);
  assert.deepEqual(await tree.getChildren(items[0]), []);
  assert.deepEqual(await tree.getChildren(firstRoot), []);
  second.closed = true; tree.sync();
  assert.deepEqual(await tree.getChildren(), []);
});

test('chat list can be separated from files for the weekly progress view', async t => {
  const session = { id: 'chat', provider: 'codex', root: '.', name: 'Codex' };
  const manager = { sessions: [session], activeId: session.id };
  const tree = new ChatFileTree(manager, { includeSessions: true, includeFiles: false });
  t.after(() => tree.dispose());
  assert.deepEqual((await tree.getChildren()).map(entry => entry.kind), ['session']);
});

test('Word documents open in the default desktop application after validating the chat path', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'chat-word-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const previous = fake.env; const external = []; fake.env={openExternal:async uri=>{external.push(uri.fsPath);return true;}};
  t.after(()=>{fake.env=previous;});
  const session={id:'word',root}; const tree=new ChatFileTree({session:()=>session});t.after(()=>tree.dispose());
  const before=opened.length;
  for(const name of ['report.docx','legacy.doc','TEMPLATE.DOTX','macro.docm']) {
    await fs.writeFile(path.join(root,name),'test');
    await tree.open({sessionId:session.id,rootPath:root,segments:[name]});
  }
  assert.equal(external.length,4);assert.equal(opened.length,before);
  await assert.rejects(tree.open({sessionId:session.id,rootPath:root,segments:['..','outside.docx']}),/Ruta/);
  assert.equal(external.length,4);
  fake.env.openExternal=async()=>false;
  await assert.rejects(tree.open({sessionId:session.id,rootPath:root,segments:['report.docx']}),/Microsoft Word o LibreOffice/);
});
