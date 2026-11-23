'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const fake = { workspace: { isTrusted: true }, window: { terminals: [] } };
const load = Module._load;
Module._load = function(name, ...args) { return name === 'vscode' ? fake : load.call(this, name, ...args); };
const { ChatSessions } = require('../src/chat-sessions');
const { Sidebar } = require('../src/sidebar');
const { GitHubVault } = require('../src/github-vault');
Module._load = load;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gui-chats-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = { sessions: [{ id: 'first', name: 'First', root, provider: 'codex', backendId: 'saved-thread', permission: 'read' }, { id: 'second', name: 'Second', root, provider: 'claude' }] };
  const context = { globalStorageUri: { fsPath: path.join(root, 'history') }, globalState: { get: (key, fallback) => data[key] ?? fallback, update: async (key, value) => { data[key] = structuredClone(value); } } };
  const manager = new ChatSessions(context); return { root, context, manager, session: manager.session('first') };
}
test('restores provider thread and permissions and saves history across manager reload', async t => {
  const f = await fixture(t);
  assert.equal(f.session.backendId, 'saved-thread'); assert.equal(f.session.permission, 'read');
  f.manager.getBackend = () => ({ run: async () => { f.manager.onAgentEvent(f.session, { type: 'delta', id: 'reply', text: 'Hola ' }); f.manager.onAgentEvent(f.session, { type: 'answer', id: 'reply', text: 'Hola mundo' }); } });
  await f.manager.send(f.session, 'Pregunta');
  const restored = new ChatSessions(f.context);
  const history = await restored.history(restored.session('first'));
  assert.deepEqual(history.map(m => [m.role, m.text]), [['user', 'Pregunta'], ['assistant', 'Hola mundo']]);
  assert.equal(restored.session('first').backendId, 'saved-thread');
});
test('attachments stay inside the folder and failed validation preserves the transcript', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.root, 'doc.md'), '# Contexto');
  f.manager.getBackend = () => ({ run: async prompt => assert.match(prompt, /# Contexto/) });
  await f.manager.send(f.session, 'Lee esto', [['doc.md']]);
  await assert.rejects(f.manager.send(f.session, 'Escape', [['..', 'secret']]), /Ruta/);
  await fs.writeFile(path.join(f.root, 'binary'), Buffer.from([0, 1, 2]));
  await assert.rejects(f.manager.send(f.session, 'Binario', [['binary']]), /binary.*UTF-8/);
  assert.equal((await f.manager.history(f.session)).filter(m => m.role === 'user').length, 1);
  assert.equal(f.manager.running.size, 0);
});
test('attachment picker accepts a mix of UTF-16 text and images and rejects unsupported files', async t => {
  const f = await fixture(t);
  const { Uri } = fake;
  const { showOpenDialog } = fake.window;
  t.after(() => { fake.Uri = Uri; fake.window.showOpenDialog = showOpenDialog; });
  fake.Uri = { file: value => value };
  await fs.writeFile(path.join(f.root, 'notes.txt'), Buffer.from('\uFEFFHola', 'utf16le'));
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';
  await fs.writeFile(path.join(f.root, 'photo.png'), Buffer.from(image, 'base64'));
  await fs.writeFile(path.join(f.root, 'unsupported.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  let selected = ['notes.txt', 'photo.png'];
  fake.window.showOpenDialog = async () => selected.map(name => ({ scheme: 'file', fsPath: path.join(f.root, name) }));
  const replies = [];
  const panel = { webview: { postMessage: value => { if (value.type === 'reply') replies.push(value); } } };
  f.manager.panels.set(f.session.id, panel);
  await f.manager.handleChat(f.session, panel, { action: 'attach', requestId: 1 });
  assert.deepEqual(replies[0].result, [['notes.txt'], ['photo.png']]);
  f.manager.getBackend = () => ({ run: async (prompt, _history, images) => {
    assert.match(prompt, /Hola/u);
    assert.deepEqual(images, [{ mime: 'image/png', data: image }]);
  } });
  await f.manager.send(f.session, 'Describe the image and notes', replies[0].result);
  assert.equal((await f.manager.history(f.session)).at(-1).role, 'user');
  selected = ['unsupported.bin'];
  await f.manager.handleChat(f.session, panel, { action: 'attach', requestId: 2, attachments: replies[0].result });
  assert.match(replies[1].error, /unsupported\.bin.*UTF-8/u);
});
test('pasted images reach the backend on an image-only turn and invalid data is rejected', async t => {
  const f = await fixture(t);
  const image = { mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==' };
  let observed;
  f.manager.getBackend = () => ({ run: async (prompt, _history, images) => { observed = { prompt, images }; } });
  await f.manager.send(f.session, '', [], [image]);
  assert.deepEqual(observed, { prompt: 'Revisa los archivos adjuntos.', images: [image] });
  const [entry] = await f.manager.history(f.session);
  assert.equal(entry.pastedImageCount, 1);
  assert.deepEqual(entry.attachments, []);
  await assert.rejects(f.manager.send(f.session, 'Invalid', [], [{ ...image, mime: 'image/jpeg' }]), /PNG, JPEG o WebP/u);
  await assert.rejects(f.manager.send(f.session, 'Too many', [], Array(11).fill(image)), /10 archivos/u);
  assert.equal((await f.manager.history(f.session)).length, 1);
});
test('concurrent chats remain independent; duplicate send is rejected', async t => {
  const f = await fixture(t); const second = f.manager.session('second'); second.provider = 'codex';
  let finish; const waiting = new Promise(resolve => { finish = resolve; });
  f.manager.getBackend = session => ({ run: async () => { if (session.id === 'first') await waiting; f.manager.onAgentEvent(session, { type: 'answer', id: 'same-id', text: session.name }); } });
  const firstRun = f.manager.send(f.session, 'Uno');
  while (!f.manager.running.has('first')) await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(f.manager.send(f.session, 'Repetido'), /en curso/);
  await f.manager.send(second, 'Dos'); finish(); await firstRun;
  assert.equal((await f.manager.history(f.session)).at(-1).text, 'First');
  assert.equal((await f.manager.history(second)).at(-1).text, 'Second');
});
test('chat submissions finish the current turn and send queued messages in order', async t => {
  const f = await fixture(t);
  let started;
  let finish;
  const firstStarted = new Promise(resolve => { started = resolve; });
  const firstWaiting = new Promise(resolve => { finish = resolve; });
  const prompts = [];
  const states = [];
  f.manager.panels.set(f.session.id, { webview: { postMessage: message => states.push(message) } });
  f.manager.getBackend = () => ({
    run: async text => {
      prompts.push(text);
      if (text === 'One') { started(); await firstWaiting; }
      f.manager.onAgentEvent(f.session, { type: 'answer', id: 'answer', text: 'Reply ' + text });
    },
    stop: () => assert.fail('Queueing must not stop the active turn')
  });
  const first = f.manager.submitMessage(f.session, { text: 'One' });
  await firstStarted;
  const second = f.manager.submitMessage(f.session, { text: 'Two' });
  const third = f.manager.submitMessage(f.session, { text: 'Three' });
  assert.deepEqual(prompts, ['One']);
  assert.equal(states.at(-1).queued, 2);
  assert.equal(f.manager.running.get(f.session.id).controller.signal.aborted, false);
  finish();
  await Promise.all([first, second, third]);
  assert.deepEqual(prompts, ['One', 'Two', 'Three']);
  assert.deepEqual((await f.manager.history(f.session)).map(entry => entry.text),
    ['One', 'Reply One', 'Two', 'Reply Two', 'Three', 'Reply Three']);
  assert.equal(states.at(-1).queued, 0);
});

test('permissions are scoped to session and outstanding approvals are rejected on stop', async t => {
  const f = await fixture(t); const controller = new AbortController();
  f.manager.running.set('first', { controller });
  const decision = f.manager.approve(f.session, { title: 'Comando', detail: 'test' });
  const prompt = [...f.manager.approvals.values()][0];
  let response;
  const panel = { webview: { postMessage: message => { if (message.type === 'reply') response = message; } } };
  f.manager.panels.set('second', panel);
  await f.manager.handleChat(f.manager.session('second'), panel, { action: 'approval', id: prompt.id, accept: true, requestId: 1 });
  assert.match(response.error, /caducado/);
  assert.equal(f.manager.approvals.size, 1);
  await f.manager.stopSession(f.session); assert.equal(await decision, false); assert.equal(f.manager.approvals.size, 0);
});
test('closing one chat preserves another and its saved provider thread', async t => {
  const f = await fixture(t); const disposed = [];
  f.manager.backends.set('first', { dispose: () => disposed.push('first') }); f.manager.backends.set('second', { dispose: () => disposed.push('second') });
  await f.manager.closeSession('first');
  assert.deepEqual(disposed, ['first']); assert.equal(f.manager.session('second').closed, undefined); assert.equal(f.session.backendId, 'saved-thread');
});
test('rendered markdown escapes HTML and does not allow executable links', async t => {
  const f = await fixture(t); let state;
  f.manager.panels.set('first', { webview: { postMessage: value => { state = value; } } });
  f.manager.histories.set('first', [{ id: 'x', role: 'assistant', text: '<script>alert(1)</script> [run](javascript:alert(1)) ![remote](https://example.com/a.png)' }]);
  f.manager.pushChat(f.session);
  assert.doesNotMatch(state.messages[0].html, /<script|<img|href="javascript/u);
});

test('chat opens local folders and files inside the session root and allows HTTP links', async t => {
  const { pathToFileURL } = require('node:url');
  const f = await fixture(t);
  const folder = path.join(f.root, 'test folder');
  await fs.mkdir(folder);
  const file = path.join(folder, 'notes.md');
  await fs.writeFile(file, '# Notes\n\nExample');
  const opened = [];
  const editor = [];
  const { Uri, env, commands, Range } = fake;
  t.after(() => { Object.assign(fake, { Uri, env, commands, Range }); });
  fake.Uri = { file: value => value, parse: value => value };
  fake.Range = class { constructor(...coordinates) { this.coordinates = coordinates; } };
  fake.commands = { executeCommand: async (...args) => { editor.push(args); } };
  fake.env = { openExternal: async value => { opened.push(value); return true; } };
  await f.manager.openChatLink(f.session, './test%20folder/');
  const fileUrl = pathToFileURL(folder).href;
  let view;
  const panel = { webview: { postMessage: message => { view = message; } } };
  f.manager.panels.set(f.session.id, panel);
  f.manager.histories.set(f.session.id, [{ role: 'assistant', text: `[Folder](${fileUrl})` }]);
  f.manager.pushChat(f.session);
  assert.ok(view.messages[0].html.includes(`href="${fileUrl}"`));
  await f.manager.handleChat(f.session, panel, { action: 'link', url: fileUrl, requestId: 1 });
  assert.equal(view.error, undefined);
  await f.manager.openChatLink(f.session, './test%20folder/notes.md');
  const absoluteLink = file.split(path.sep).join('/');
  f.manager.histories.set(f.session.id, [{ role: 'assistant', text: `[Notes](<${absoluteLink}:3:2>)` }]);
  f.manager.pushChat(f.session);
  const renderedLink = /href="([^"]+)"/u.exec(view.messages[0].html);
  assert.ok(renderedLink);
  await f.manager.handleChat(f.session, panel, { action: 'link', url: renderedLink[1], requestId: 2 });
  assert.equal(view.error, undefined);
  await f.manager.openChatLink(f.session, pathToFileURL(file).href + '#L3');
  await f.manager.openChatLink(f.session, 'https://example.com');
  await assert.rejects(f.manager.openChatLink(f.session, '../'));
  await assert.rejects(f.manager.openChatLink(f.session, 'command:workbench.action.closeWindow'));
  assert.deepEqual(opened, [await fs.realpath(folder), await fs.realpath(folder), 'https://example.com']);
  const target = await fs.realpath(file);
  assert.deepEqual(editor, [
    ['vscode.open', target],
    ['vscode.open', target, { selection: new fake.Range(2, 1, 2, 1) }],
    ['vscode.open', target, { selection: new fake.Range(2, 0, 2, 0) }]
  ]);
});

test('new chat asks only for its folder, persists and opens immediately without Quick Pick', async t => {
  const f = await fixture(t);
  const calls = [];
  f.manager.pickFolder = async () => { calls.push('folder'); return f.root; };
  f.manager.pickAgent = async () => { assert.fail('New chat must not open the agent Quick Pick'); };
  f.manager.pickModel = async () => { assert.fail('New chat must not open the model Quick Pick'); };
  f.manager.showTerminal = async session => {
    assert.equal(f.manager.activeId, session.id);
    assert.ok(f.manager.sessions.includes(session));
    calls.push('open');
  };
  await f.manager.createSession();
  assert.deepEqual(calls, ['folder', 'open']);
  const created = f.manager.session(f.manager.activeId);
  assert.equal(created.root, await fs.realpath(f.root));
  assert.equal(created.provider, 'codex');
  assert.equal(new ChatSessions(f.context).session(created.id).root, created.root);
  f.manager.activeId = 'second';
  await f.manager.createSession();
  assert.equal(f.manager.session(f.manager.activeId).provider, 'claude');
});

test('generated names ignore closed chats and remove obsolete suffixes after closing and restoring', async t => {
  const f = await fixture(t);
  const base = `Codex · ${path.basename(f.root)}`;
  f.session.name = base;
  f.session.closed = true;
  f.manager.pickFolder = async () => f.root;
  f.manager.showTerminal = async () => {};
  await f.manager.createSession('codex');
  const first = f.manager.session(f.manager.activeId);
  assert.equal(first.name, base, 'closed history must not consume the base title');
  await f.manager.createSession('codex');
  const second = f.manager.session(f.manager.activeId);
  assert.equal(second.name, `${base} (2)`);
  await f.manager.closeSession(first.id);
  assert.equal(second.name, base, 'remaining chat must lose the obsolete suffix');
  assert.equal(f.manager.session('second').name, 'Second', 'custom titles remain unchanged');
  second.name = `${base} (12)`;
  await f.context.globalState.update('sessions', f.manager.sessions);
  const restored = new ChatSessions(f.context);
  assert.equal(restored.session(second.id).name, base, 'existing saved suffixes are repaired on load');
  delete first.closed;
  await f.manager.persist();
  assert.equal(first.name, base);
  assert.equal(second.name, `${base} (2)`, 'reopening keeps simultaneous titles distinct');
});

test('cancelling the folder picker does not create or activate a chat', async t => {
  const f = await fixture(t);
  const before = f.manager.sessions.length;
  const activeId = f.manager.activeId;
  f.manager.pickFolder = async () => undefined;
  f.manager.showTerminal = async () => assert.fail('Cancelled folder must not open a chat');
  await f.manager.createSession();
  assert.equal(f.manager.sessions.length, before);
  assert.equal(f.manager.activeId, activeId);
});

test('new chat menu passes the explicitly selected provider to session creation', async t => {
  const f = await fixture(t);
  const calls = [];
  const panel = { webview: { postMessage() {} } };
  f.manager.panels.set(f.session.id, panel);
  f.manager.createSession = async (...args) => calls.push(args);
  for (const provider of ['codex', 'claude', 'ollama']) await f.manager.handleChat(f.session, panel, { action: 'new', provider, requestId: 1 });
  await f.manager.handleChat(f.session, panel, { action: 'new', requestId: 2 });
  assert.deepEqual(calls, [['codex'], ['claude'], ['ollama'], ['codex']]);
});

test('explicit new chat provider overrides active agent and invalid providers do not open a folder picker', async t => {
  const f = await fixture(t);
  f.manager.activeId = 'first';
  f.manager.pickFolder = async () => f.root;
  f.manager.showTerminal = async () => false;
  await f.manager.createSession('claude');
  assert.equal(f.manager.activeId, 'first');
  assert.equal(f.manager.sessions.length, 2);
  f.manager.showTerminal = async () => true;
  await f.manager.createSession('claude');
  assert.equal(f.manager.session(f.manager.activeId).provider, 'claude');
  f.manager.pickFolder = async () => assert.fail('Invalid provider must not open the folder picker');
  await assert.rejects(f.manager.createSession('unknown-agent'), /Agente no disponible/);
});

test('Ollama opens without models and leaves download as an explicit user action', async t => {
  const f = await fixture(t); const cli = require('../src/agent-cli');
  const original = cli.listOllamaModels;
  t.after(() => { cli.listOllamaModels = original; });
  cli.listOllamaModels = async () => [];
  f.manager.pickFolder = async () => f.root;
  let opened;
  f.manager.showTerminal = async session => { opened = session; };
  await f.manager.createSession('ollama');
  assert.equal(opened.provider, 'ollama');
  assert.equal(opened.model, undefined);
  assert.equal(f.manager.activeId, opened.id);
  await assert.rejects(f.manager.downloadOllamaModel(f.session), /corresponde a Ollama/);
});

test('Ollama download picker lists explicit tags and supports selection, manual entry and cancellation', async t => {
  const f = await fixture(t); f.session.provider = 'ollama';
  const cli = require('../src/agent-cli'); const catalog = require('../src/ollama-catalog');
  const original = { picker:fake.window.showQuickPick, input:fake.window.showInputBox, progress:fake.window.withProgress, location:fake.ProgressLocation, pull:cli.pullOllamaModel };
  t.after(()=>{fake.window.showQuickPick=original.picker;fake.window.showInputBox=original.input;fake.window.withProgress=original.progress;fake.ProgressLocation=original.location;cli.pullOllamaModel=original.pull;});
  const downloaded = []; let items;
  cli.pullOllamaModel = async name => downloaded.push(name);
  fake.ProgressLocation = {Notification:1};
  fake.window.withProgress = async (_options,callback)=>callback({report(){}},{isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})});
  fake.window.showInputBox = async ()=>assert.fail('Preset selection must not ask for a model name');
  fake.window.showQuickPick = async values => { items=values;return values.find(value=>value.model==='qwen2.5-coder:7b'); };
  assert.equal(await f.manager.downloadOllamaModel(f.session),true);
  assert.equal(f.session.model,'qwen2.5-coder:7b');
  assert.equal(items.filter(item=>item.model).length,catalog.length);
  assert.equal(new Set(catalog.map(item=>item.model)).size,catalog.length);
  assert.ok(catalog.every(item=>cli.MODEL_NAME.test(item.model)));
  assert.ok(items.filter(item=>item.model).every(item=>item.detail && item.description));
  fake.window.showQuickPick=async values=>values.find(value=>value.manual);
  fake.window.showInputBox=async()=> 'custom-model:latest';
  assert.equal(await f.manager.downloadOllamaModel(f.session),true);
  assert.deepEqual(downloaded,['qwen2.5-coder:7b','custom-model:latest']);
  fake.window.showInputBox=async()=>undefined;
  assert.equal(await f.manager.downloadOllamaModel(f.session),false);
  fake.window.showQuickPick=async()=>undefined;
  assert.equal(await f.manager.downloadOllamaModel(f.session),false);
  assert.equal(downloaded.length,2);
});

function fakeChatPanels(t, manager) {
  const oldUri = fake.Uri; const oldColumns = fake.ViewColumn; const oldCreate = fake.window.createWebviewPanel;
  fake.Uri = { joinPath: (_base, ...segments) => segments.join('/') };
  fake.ViewColumn = { Active: 1, Beside: 2 };
  manager.context.extensionUri = 'extension';
  t.after(() => { fake.Uri = oldUri; fake.ViewColumn = oldColumns; fake.window.createWebviewPanel = oldCreate; });
  const make = title => {
    let listener; const sent = [];
    const panel = { title, active: false, viewColumn: 1, disposed: false, reveal() {}, dispose() { this.disposed = true; }, onDidChangeViewState() { return { dispose() {} }; }, onDidDispose() { return { dispose() {} }; }, webview: {
      asWebviewUri(uri) { return uri; }, onDidReceiveMessage(callback) { listener = callback; return { dispose() { listener = undefined; } }; }, postMessage(message) { sent.push(message); }
    } };
    Object.defineProperty(panel.webview, 'html', { set(html) { panel.html = html; assert.ok(listener, 'the listener must be registered before HTML can send ready'); listener({ action: 'ready' }); } });
    panel.sent = sent; return panel;
  };
  fake.window.createWebviewPanel = (_type, title) => make(title);
  return make;
}

test('cold chat startup handles an immediate ready message and publishes initial state', async t => {
  const f = await fixture(t); fakeChatPanels(t, f.manager);
  const panel = await f.manager.showTerminal(f.session);
  assert.equal(f.manager.panels.get(f.session.id), panel);
  assert.ok(panel.sent.some(message => message.type === 'chat' && message.session.id === f.session.id));
});

test('closed chat previews sort by the last non-empty user message, regardless of closure order', async t => {
  const { manager, root, session } = await fixture(t);
  const older = { ...session, id: 'older', closed: true, closedAt: 100 };
  const newer = { ...session, id: 'newer', closed: true, closedAt: 90 };
  manager.sessions = [older, newer];
  manager.history = async chat => chat === older
    ? [{ role: 'user', text: 'Older', created: 10 },
       { role: 'assistant', text: 'Later reply', created: 60 },
       { role: 'user', text: '  ', created: 70 }]
    : [{ role: 'user', text: 'Newer', created: 20 }];

  const items = await manager.closedChatItems(root);
  assert.deepEqual(items.map(item => [item.detail, item.created]), [['Newer', 20], ['Older', 10]]);
});

test('closed chats stay off the sidebar and reopen with their saved history', async t => {
  const f = await fixture(t);
  f.manager.getBackend = () => ({ run: async () => {
    f.manager.onAgentEvent(f.session, { type: 'answer', id: 'reply', text: 'Saved reply' });
  } });
  await f.manager.send(f.session, 'Earlier question');
  await f.manager.send(f.session, 'Saved question');
  await f.manager.closeSession(f.session.id);

  const restored = new ChatSessions(f.context);
  fakeChatPanels(t, restored);
  const sidebar = new Sidebar(restored);
  const messages = [];
  sidebar.view = { webview: { postMessage: message => messages.push(message) } };
  await sidebar.publish();
  assert.deepEqual(messages[0].sessions.map(session => session.id), ['second']);

  const foreign = { ...restored.session(f.session.id), id: 'foreign', root: path.join(f.root, 'another-folder') };
  const empty = { ...foreign, id: 'empty', root: f.root };
  restored.sessions.push(foreign, empty);
  const source = restored.session('second');
  source.provider = 'codex';
  const openChat = await restored.showTerminal(source);
  const createPanel = fake.window.createWebviewPanel;
  fake.window.createWebviewPanel = () => assert.fail('reopening must reuse the current panel');
  const replies = () => openChat.sent.filter(message => message.type === 'reply');
  await restored.handleChat(source, openChat, { action: 'closedChatHistory', requestId: 1 });
  assert.deepEqual(replies().at(-1).result.map(item => [item.id, item.detail]), [[f.session.id, 'Saved question']]);
  await restored.handleChat(source, openChat, { action: 'reopenChat', id: foreign.id, requestId: 2 });
  assert.ok(replies().at(-1).error);
  assert.equal(foreign.closed, true);
  await restored.handleChat(source, openChat, { action: 'reopenChat', id: f.session.id, requestId: 3 });
  assert.equal(replies().at(-1).result, true);
  assert.ok(restored.session(f.session.id).closedAt);
  fake.window.createWebviewPanel = createPanel;
  assert.equal(restored.panels.get(f.session.id), openChat);
  assert.equal(openChat.disposed, false);
  assert.equal(source.closed, true);

  assert.equal(restored.activeId, f.session.id);
  assert.equal(restored.session(f.session.id).closed, undefined);
  await sidebar.publish();
  const reopened = messages.filter(message => message.type === 'sidebar').at(-1);
  assert.equal(reopened.activeId, f.session.id);
  assert.ok(reopened.sessions.every(session => !('latestMessage' in session)));
  assert.deepEqual(reopened.sessions.map(session => session.id), [f.session.id]);
  const panel = restored.panels.get(f.session.id);
  const transcript = panel.sent.filter(message => message.type === 'chat').at(-1);
  assert.deepEqual(transcript.messages.map(message => message.text), ['Earlier question', 'Saved reply', 'Saved question', 'Saved reply']);
  assert.equal(restored.session(f.session.id).backendId, 'saved-thread');
});

test('restored chat reattaches scripts and state by session ID and supports old tabs by unique title', async t => {
  const f = await fixture(t); const make = fakeChatPanels(t, f.manager);
  f.session.closed = true;
  const panel = make('Old title');
  await f.manager.restoreChatPanel(panel, { sessionId: f.session.id });
  assert.equal(f.manager.panels.get(f.session.id), panel);
  assert.equal(f.session.closed, undefined);
  assert.equal(panel.title, f.session.name);
  assert.ok(panel.html.includes('data-session-id="' + f.session.id + '"'));
  assert.ok(panel.sent.some(message => message.type === 'chat' && message.session.id === f.session.id));
  const second = f.manager.session('second'); second.provider = 'codex'; const legacy = make(second.name);
  await f.manager.restoreChatPanel(legacy, undefined);
  assert.equal(f.manager.panels.get(second.id), legacy);
  assert.ok(legacy.sent.some(message => message.type === 'chat' && message.session.id === second.id));
});

test('changing to automatic review during approval resumes the same conversation under the new mode', async t => {
  const f = await fixture(t);
  const { manager, session } = f;
  let approvalReady;
  const ready = new Promise(resolve => { approvalReady = resolve; });
  let finishInterrupt;
  const interrupted = new Promise(resolve => { finishInterrupt = resolve; });
  let receivedDecision;
  const original = {
    async run() {
      const pending = manager.approve(session, { title: 'Pending action', detail: 'test' });
      approvalReady();
      receivedDecision = await pending;
    },
    stop: () => interrupted,
    dispose() {}
  };
  const next = {
    async run(input) {
      assert.equal(session.permission, 'auto');
      assert.equal(session.backendId, 'saved-thread');
      assert.match(input, /Continúa la tarea anterior/);
      manager.onAgentEvent(session, { type: 'answer', id: 'next', text: 'Continued' });
    }
  };
  manager.backends.set(session.id, original);
  manager.getBackend = () => manager.backends.get(session.id) || next;
  let reply;
  const panel = { webview: { postMessage: value => { if (value.type === 'reply') reply = value; } } };
  manager.panels.set(session.id, panel);
  const sending = manager.send(session, 'Original task');
  await ready;
  await manager.handleChat(session, panel, { action: 'permission', value: 'auto', requestId: 1 });
  assert.equal(reply.error, undefined);
  assert.equal(receivedDecision, false);
  assert.equal(manager.approvals.size, 0);
  assert.equal(manager.backends.get(session.id), original);
  assert.equal(f.context.globalState.get('chatPermission.codex'), 'auto');
  finishInterrupt();
  await sending;
  assert.deepEqual((await manager.history(session)).map(entry => entry.text), [
    'Original task', 'Continuando con el nuevo modo de permisos.', 'Continued'
  ]);
  assert.equal(manager.running.size, 0);
});

test('permission mode changes restart the idle adapter, persist automatic review and preserve the provider thread', async t => {
  const f = await fixture(t); let disposed = 0;
  const panel = { webview: { postMessage() {} } }; f.manager.panels.set(f.session.id, panel);
  f.manager.backends.set(f.session.id, { dispose() { disposed++; } });
  await f.manager.handleChat(f.session, panel, { action: 'permission', value: 'auto', requestId: 1 });
  assert.equal(f.session.permission, 'auto');
  assert.equal(disposed, 1);
  assert.equal(f.manager.backends.has(f.session.id), false);
  assert.equal(f.session.backendId, 'saved-thread');
  assert.equal(new ChatSessions(f.context).session(f.session.id).permission, 'auto');
});

test('full and custom are explicit per-chat choices and reverting clears stale permissions', async t => {
  const f = await fixture(t); const panel = { webview: { postMessage() {} } };
  f.manager.panels.set(f.session.id, panel);
  let terminalsClosed = 0;
  f.manager.terminals.set(f.session.id, { dispose() { terminalsClosed++; } });
  for (const mode of ['full', 'custom', 'ask']) {
    f.manager.backends.set(f.session.id, { dispose() {} });
    await f.manager.handleChat(f.session, panel, { action: 'permission', value: mode, requestId: 1 });
    assert.equal(f.session.permission, mode);
    assert.equal(f.manager.backends.has(f.session.id), false);
    assert.equal(f.session.backendId, 'saved-thread');
    assert.equal(new ChatSessions(f.context).session(f.session.id).permission, mode);
    assert.equal(f.manager.session('second').permission, 'ask');
  }
  assert.equal(terminalsClosed, 1);
});

test('Ollama panel opens when the runtime is missing or unavailable', async t => {
  const f = await fixture(t); const cli = require('../src/agent-cli');
  const original = cli.listOllamaModels;
  t.after(() => { cli.listOllamaModels = original; });
  for (const reason of ['Ollama is not installed', 'Local Ollama server unavailable']) {
    cli.listOllamaModels = async () => { throw new Error(reason); };
    let opened; f.manager.showTerminal = async session => { opened = session; };
    await f.manager.createSession('ollama', f.root);
    assert.equal(opened.provider, 'ollama'); assert.equal(opened.model, undefined);
    assert.equal(f.manager.activeId, opened.id); assert.ok(!opened.closed);
  }
});

test('terminal sessions use their folder, select the existing terminal and survive reload as terminals', async t => {
  const f = await fixture(t); const previous = {...fake.window};
  const oldUri=fake.Uri, oldLocation=fake.TerminalLocation, oldColumn=fake.ViewColumn;
  t.after(()=>{Object.assign(fake.window,previous);fake.Uri=oldUri;fake.TerminalLocation=oldLocation;fake.ViewColumn=oldColumn;});
  fake.Uri={file:fsPath=>({fsPath})};fake.TerminalLocation={Editor:1};fake.ViewColumn={Beside:2};
  fake.window.terminals=[];const created=[];
  fake.window.createTerminal=options=>{
    const terminal={creationOptions:options,shown:0,show(){this.shown++;},dispose(){fake.window.terminals=fake.window.terminals.filter(item=>item!==terminal);}};
    fake.window.terminals.push(terminal);created.push(terminal);return terminal;
  };
  const session=await f.manager.createTerminalSession('terminal',f.root);
  assert.equal(session.mode,'terminal');assert.equal(f.manager.panels.size,0);
  assert.equal(created[0].creationOptions.cwd.fsPath,await fs.realpath(f.root));
  await f.manager.selectSession(session.id);assert.equal(created.length,1);assert.equal(created[0].shown,2);
  const restored=new ChatSessions(f.context);assert.equal(restored.session(session.id).mode,'terminal');
  await restored.selectSession(session.id);assert.equal(created.length,1);
  const secondRoot=path.join(f.root,'second-folder');await fs.mkdir(secondRoot);
  const second=await restored.createTerminalSession('terminal',secondRoot);
  assert.equal(created[1].creationOptions.cwd.fsPath,await fs.realpath(secondRoot));
  await restored.selectSession(session.id);assert.equal(restored.activeId,session.id);
  await restored.terminalClosed(created[0]);assert.equal(restored.session(session.id).closed,true);assert.notEqual(restored.activeId,session.id);
  assert.ok(!restored.session(second.id).closed);
  await restored.closeSession(second.id);assert.equal(restored.session(second.id).closed,true);
  assert.ok(!fake.window.terminals.includes(created[1]));restored.dispose();f.manager.dispose();
});

test('agent terminal creation rolls back on failure and never opens a custom chat or Claude graphical panel',async t=>{
  const f=await fixture(t);const original=fake.window.terminals;
  t.after(()=>{fake.window.terminals=original;});fake.window.terminals=[];
  f.manager.pickFolder=async()=>undefined;const count=f.manager.sessions.length;
  await f.manager.createTerminalSession('codex');assert.equal(f.manager.sessions.length,count);
  const active=f.manager.activeId;
  f.manager.resolveInvocation=async session=>{assert.equal(session.provider,'claude');throw Error('Missing external CLI');};
  await assert.rejects(f.manager.createTerminalSession('claude',f.root),/Missing external CLI/);
  assert.equal(f.manager.sessions.length,count);assert.equal(f.manager.activeId,active);assert.equal(f.manager.panels.size,0);
  await assert.rejects(f.manager.createTerminalSession('unknown',f.root),/Agente/);
});

test('terminal submenu registers each provider independently of chat creation',()=>{
  const pkg=require('../package.json');const menu=pkg.contributes.menus['multipleIAAgents.newTerminals'];
  assert.deepEqual(menu.map(item=>item.command),['codex','claude','ollama','terminal'].map(provider=>'multipleIAAgents.newTerminal.'+provider));
  assert.ok(pkg.contributes.menus['view/title'].some(item=>item.submenu==='multipleIAAgents.newTerminals'));
});

test('opens an existing Markdown vault and lists its nested documents independently of the chat folder', async t => {
  const f = await fixture(t);
  const root = path.join(f.root, 'existing-vault');
  await fs.mkdir(path.join(root, 'notes'), { recursive: true });
  await fs.mkdir(path.join(root, '.git'));
  await fs.writeFile(path.join(root, 'README.md'), '# Vault');
  await fs.writeFile(path.join(root, 'notes', 'Daily.MARKDOWN'), '# Daily');
  await fs.writeFile(path.join(root, 'notes', 'other.txt'), 'Other');
  const workspace = new Map();
  f.context.workspaceState = { get: key => workspace.get(key), update: async (key, value) => workspace.set(key, value) };
  const { showOpenDialog } = fake.window;
  t.after(() => { fake.window.showOpenDialog = showOpenDialog; });
  fake.window.showOpenDialog = async options => {
    assert.equal(options.canSelectFolders, true);
    return [{ scheme: 'file', fsPath: root }];
  };
  f.manager.vault = new GitHubVault(f.context);
  const folder = await f.manager.vault.pickFolder();
  assert.equal(folder.name, 'existing-vault');
  await assert.rejects(f.manager.vault.run('open', folder, '...'));
  assert.equal(await f.manager.vault.run('open', folder, folder.name), true);
  assert.equal(f.manager.vault.active.name, 'existing-vault');
  const sidebar = new Sidebar(f.manager);
  const activeRoot = f.manager.vault.active.root;
  const [vault] = await sidebar.vaultChildren(activeRoot);
  const entries = await sidebar.vaultChildren(activeRoot, vault);
  assert.deepEqual(entries.map(entry => entry.name), ['notes', 'README.md']);
  const [document] = await sidebar.vaultChildren(activeRoot, entries[0], true);
  const restoredVault = new GitHubVault(f.context);
  assert.deepEqual(restoredVault.lastFolder, ['notes']);
  const newWindowVault = new GitHubVault({ ...f.context, workspaceState: { get: () => undefined } });
  assert.equal(newWindowVault.active.root, activeRoot);
  assert.deepEqual(document.segments, ['notes', 'Daily.MARKDOWN']);
  assert.equal(document.markdown, true);
  assert.equal(await f.manager.vault.loadTemplate(document), '# Daily');
  const makePanel = fakeChatPanels(t, f.manager);
  const chatPanel = makePanel(f.session.name);
  const post = chatPanel.webview.postMessage;
  chatPanel.webview.postMessage = message => { post(message); return true; };
  f.manager.activeId = f.session.id;
  f.manager.attachChatPanel(f.session, chatPanel);
  await f.manager.insertVaultDocument(f.session.id, document);
  assert.deepEqual(chatPanel.sent.at(-1), { type: 'vaultTemplate', template: '# Daily' });
  await assert.rejects(f.manager.insertVaultDocument('second', document));
  const { Uri } = fake;
  fake.Uri = { file: fsPath => ({ scheme: "file", fsPath }) };
  t.after(() => { fake.Uri = Uri; });
  const { showSaveDialog } = fake.window;
  t.after(() => { fake.window.showSaveDialog = showSaveDialog; });
  fake.window.showSaveDialog = async () => ({ scheme: 'file', fsPath: path.join(root, 'Export.md') });
  assert.equal(await f.manager.vault.saveConversation(f.session, [{ role: 'user', text: 'Saved question' }]), true);
  assert.match(await fs.readFile(path.join(root, 'Export.md'), 'utf8'), /Saved question/u);
  const originalFs = fake.workspace.fs;
  const originalWarning = fake.window.showWarningMessage;
  t.after(() => { fake.workspace.fs = originalFs; fake.window.showWarningMessage = originalWarning; });
  const trashed = [];
  fake.workspace.fs = { delete: async (uri, options) => trashed.push([uri.fsPath, options]) };
  fake.window.showWarningMessage = async () => undefined;
  assert.equal(await sidebar.trashVaultFile(document), false);
  assert.equal(trashed.length, 0);
  fake.window.showWarningMessage = async (_message, _options, confirm) => confirm;
  await assert.rejects(sidebar.trashVaultFile({ ...document, segments: ['notes'] }));
  assert.equal(await sidebar.trashVaultFile(document), true);
  assert.deepEqual(trashed, [[path.join(activeRoot, 'notes', 'Daily.MARKDOWN'), { recursive: false, useTrash: true }]]);
  await fs.rename(path.join(root, 'notes'), path.join(root, 'renamed-outside-vscode'));
  assert.deepEqual(await sidebar.vaultChildren(activeRoot, entries[0], true), []);
  assert.deepEqual(restoredVault.lastFolder, ['notes']);
  assert.ok((await sidebar.vaultChildren(activeRoot, vault)).some(entry => entry.name === 'renamed-outside-vscode'));
  await assert.rejects(sidebar.vaultChildren(activeRoot, { segments: ['..'] }));

  workspace.delete('githubVault.active');
  workspace.set('githubVaultFolder', activeRoot);
  assert.equal(new GitHubVault(f.context).active.root, activeRoot);
  fake.window.showOpenDialog = async () => undefined;
  assert.equal(await f.manager.vault.pickFolder(), false);
  assert.equal(workspace.has('githubVault.active'), false);
  assert.equal(await f.manager.vault.run('open', folder, 'Notas de sesión'), true);
  assert.equal(f.manager.vault.active.name, 'Notas de sesión');
  assert.equal(f.manager.vault.active.root, activeRoot);
});

test('sync derives a private repository name from the vault and rejects unverified visibility', async t => {
  const f = await fixture(t);
  const root = await fs.realpath(await fs.mkdtemp(path.join(f.root, 'vault-sync-')));
  f.context.workspaceState = { get: key => key === 'githubVault.active' ? { name: 'Notas de sesión', root } : undefined };
  const originalFetch = globalThis.fetch;
  const originalAuthentication = fake.authentication;
  t.after(() => { globalThis.fetch = originalFetch; fake.authentication = originalAuthentication; });
  fake.authentication = { getSession: async () => ({ accessToken: 'mock-token' }) };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push([url, options.method, JSON.parse(options.body)]);
    return { ok: true, json: async () => ({ private: false, visibility: 'public' }) };
  };
  await assert.rejects(new GitHubVault(f.context).run('sync'), /privad|private/iu);
  assert.deepEqual(requests, [['https://api.github.com/user/repos', 'POST', {
    name: 'Notas-de-sesion', private: true, auto_init: false
  }]]);
});

test('vault status reports a clean confirmed commit and local changes without contacting GitHub', async t => {
  const f = await fixture(t);
  const { execFileSync } = require('node:child_process');
  const { createHash } = require('node:crypto');
  const root = await fs.realpath(f.root);
  const vault = new GitHubVault(f.context);
  f.context.workspaceState = { get: key => key === 'githubVault.active' ? { root } : undefined };
  const remote = 'https://github.com/example/vault.git';
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Vault Test', '-c', 'user.email=vault-test', ...args], { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--initial-branch=main');
  git('remote', 'add', 'origin', remote);
  await fs.writeFile(path.join(root, 'tracked.md'), '# Original');
  git('add', 'tracked.md');
  git('commit', '-m', 'Vault test');
  assert.equal(await vault.syncStatus(root), 'unknown');
  const key = 'githubVault.sync.' + createHash('sha256').update(root).digest('hex');
  await f.context.globalState.update(key, { remote, branch: 'main', commit: git('rev-parse', 'HEAD') });
  assert.equal(await vault.syncStatus(root), 'synced');
  await fs.writeFile(path.join(root, 'tracked.md'), '# Edited');
  assert.equal(await vault.syncStatus(root), 'pending');
  await fs.writeFile(path.join(root, 'tracked.md'), '# Original');
  await fs.writeFile(path.join(root, 'Export.MARKDOWN'), '# Conversation');
  assert.equal(await vault.syncStatus(root), 'pending');
});
