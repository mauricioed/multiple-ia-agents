'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/agent-cli');
const { OllamaBackend } = require('../src/backends');

test('Ollama lists and reads files through tool calls, then streams its answer', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-chat-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'chat');
  await fs.mkdir(root);
  await fs.mkdir(path.join(root, 'specs', '001-example'), { recursive: true });
  await fs.writeFile(path.join(root, 'specs', '001-example', 'spec.md'), 'Contenido único');
  await fs.writeFile(path.join(parent, 'other.txt'), 'Do not send');
  await fs.symlink(parent, path.join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  const call = (name, path) => ({ function: { name, arguments: { path } } });
  const stream = message => new Response(JSON.stringify({ message }) + '\n' + JSON.stringify({ done: true, prompt_eval_count: 100 }));
  t.mock.method(cli, 'ollamaEndpoint', async () => 'http://localhost:11434');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) {
      assert.deepEqual(body.tools.map(tool => tool.function.name), ['list_chat_directory', 'read_chat_file']);
      return stream({ tool_calls: [call('list_chat_directory', 'specs/001-example')] });
    }
    if (requests.length === 2) {
      const result = JSON.parse(body.messages.at(-1).content);
      assert.deepEqual(result.entries.map(entry => entry.name), ['spec.md']);
      return stream({ tool_calls: [
        call('read_chat_file', 'specs/001-example/spec.md'),
        call('read_chat_file', '../other.txt'),
        call('read_chat_file', 'outside/other.txt')
      ] });
    }
    const results = body.messages.slice(-3).map(message => {
      assert.equal(message.role, 'tool');
      assert.equal(message.tool_name, 'read_chat_file');
      return JSON.parse(message.content);
    });
    assert.deepEqual(results[0], { content: 'Contenido único', nextOffset: null });
    assert.ok(results[1].error && results[2].error);
    assert.doesNotMatch(JSON.stringify(body), /Do not send/);
    return stream({ content: 'Leído.' });
  });
  const events = [];
  const agent = new OllamaBackend({ root, model: 'test' }, '', event => events.push(event));
  await agent.run('Lee el archivo', [{ role: 'user', text: 'Lee el archivo' }]);
  assert.equal(requests.length, 3);
  assert.deepEqual(events.filter(event => event.type === 'activity').map(event => event.status), ['completed', 'completed', 'failed', 'failed']);
  assert.equal(events.find(event => event.type === 'delta').text, 'Leído.');
});

test('Ollama handles a root listing emitted as split JSON text', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-text-call-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'spec.md'), '');
  t.mock.method(cli, 'ollamaEndpoint', async () => 'http://localhost:11434');
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const { messages } = JSON.parse(options.body);
    if (messages.length === 1) {
      return new Response([
        { message: { content: ' {"name": "list_chat_directory",' } },
        { message: { content: ' "arguments": {"offset": 0, "path": "."}} ' } },
        { done: true }
      ].map(event => JSON.stringify(event)).join('\n'));
    }
    assert.equal(messages.at(-2).content, '');
    assert.equal(messages.at(-1).role, 'tool');
    assert.equal(messages.at(-1).tool_name, 'list_chat_directory');
    assert.deepEqual(JSON.parse(messages.at(-1).content).entries.map(entry => entry.name), ['spec.md']);
    return Response.json({ message: { content: '{"files":["spec.md"]}' }, done: true });
  });
  const events = [];
  const agent = new OllamaBackend({ root, model: 'qwen2.5' }, '', event => events.push(event));
  await agent.run('List files', [{ role: 'user', text: 'List files' }]);
  assert.equal(fetch.mock.callCount(), 2);
  assert.deepEqual(events.filter(event => event.type === 'delta').map(event => event.text), ['{"files":["spec.md"]}']);
});

test('Ollama keeps chat available when the model rejects tools', async t => {
  t.mock.method(cli, 'ollamaEndpoint', async () => 'http://localhost:11434');
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (JSON.parse(options.body).tools) return Response.json({ error: 'test does not support tools' }, { status: 400 });
    return new Response(JSON.stringify({ message: { content: 'Hola' }, done: true }));
  });
  const events = [];
  const agent = new OllamaBackend({ model: 'test' }, '', event => events.push(event));
  await agent.run('Hola', [{ role: 'user', text: 'Hola' }]);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(events[0].id, 'ollama-tools-unavailable');
  assert.equal(events[1].text, 'Hola');
});

test('Ollama asks for one-time approval before sending each external file', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-approval-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'chat');
  await fs.mkdir(root);
  const allowed = path.join(parent, 'approved.md');
  const denied = path.join(parent, 'denied.md');
  await fs.writeFile(allowed, 'Approved contents');
  await fs.writeFile(denied, 'Denied contents');
  t.mock.method(cli, 'ollamaEndpoint', async () => 'http://localhost:11434');
  let sent;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (fetch.mock.callCount() === 0) {
      const tool_calls = [allowed, denied, allowed].map(path => ({ function: { name: 'read_chat_file', arguments: { path } } }));
      return new Response(JSON.stringify({ message: { tool_calls }, done: true }));
    }
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ message: { content: 'Done' }, done: true }));
  });
  const decisions = [];
  const agent = new OllamaBackend({ root, model: 'test' }, '', () => {}, async ({ title, detail }, signal) => {
    assert.match(title, /fuera de la carpeta/);
    assert.equal(signal.aborted, false);
    assert.equal(fetch.mock.callCount(), 1);
    decisions.push(detail);
    return decisions.length === 1;
  });
  await agent.run('Read the files', [{ role: 'user', text: 'Read the files' }]);
  assert.deepEqual(decisions, await Promise.all([allowed, denied, allowed].map(file => fs.realpath(file))));
  const results = sent.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
  assert.deepEqual(results[0], { content: 'Approved contents', nextOffset: null });
  assert.ok(results[1].error && results[2].error);
  assert.doesNotMatch(JSON.stringify(sent), /Denied contents/);
});
