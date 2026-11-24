'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { ClaudeApiBackend, ClaudeApiKey, SECRET_KEY, apiEnvironment, claudeArguments } = require('../src/claude-api');
const claudeCli = require('../src/claude-cli');

const KEY = 'sk-ant-test-0123456789abcdefghij';

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-api-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'config');
  t.after(async () => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  const executable = path.join(root, process.platform === 'win32' ? 'claude.exe' : 'claude');
  await fs.writeFile(executable, 'test fixture');
  return { root, executable };
}

function fakeClaude(t, options = {}) {
  const spawned = [];
  const spawnProcess = (file, args, spawnOptions) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.written = [];
    child.stdin.on('data', chunk => String(chunk).split('\n').filter(Boolean).forEach(line => {
      const message = JSON.parse(line); child.written.push(message); child.emit('input', message);
    }));
    child.send = message => child.stdout.write(JSON.stringify(message) + '\n');
    child.kill = () => { child.killed = true; child.emit('exit', null); };
    Object.assign(child, { file, args, options: spawnOptions });
    spawned.push(child);
    return child;
  };
  return { spawned, spawnProcess };
}

async function backend(t, overrides = {}) {
  const { root, executable } = await workspace(t);
  const session = { id: 'chat', root, provider: 'claude', access: 'apiKey', permission: 'ask', ...overrides.session };
  const events = []; const prompts = []; let saved = 0;
  const fake = fakeClaude(t);
  const agent = new ClaudeApiBackend(session, { configured: executable, apiKey: async () => overrides.key === undefined ? KEY : overrides.key },
    event => events.push(event), overrides.approve || (async prompt => { prompts.push(prompt); return true; }), async () => { saved++; }, fake.spawnProcess);
  t.after(() => agent.dispose());
  return { agent, session, events, prompts, fake, saved: () => saved };
}

async function started(fake, count) {
  for (let attempt = 0; attempt < 200 && fake.spawned.length < count; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(fake.spawned.length, count);
  return fake.spawned[count - 1];
}

function nextInput(child, type) {
  const found = child.written.find(message => message.type === type);
  if (found) return Promise.resolve(found);
  return new Promise(resolve => child.on('input', message => { if (message.type === type) resolve(message); }));
}

test('the API environment keeps only the user key and drops inherited credentials and endpoints', () => {
  const env = apiEnvironment(KEY, { PATH: 'bin', ANTHROPIC_API_KEY: 'other', ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_BASE_URL: 'https://proxy',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_API_KEY_HELPER: 'helper', AWS_BEARER_TOKEN_BEDROCK: 'aws' });
  assert.deepEqual(env, { PATH: 'bin', ANTHROPIC_API_KEY: KEY });
  assert.throws(() => apiEnvironment(''), /clave de API/);
  assert.throws(() => apiEnvironment('short'), /clave de API/);
});

test('arguments force bare API-key mode and map permissions, model and conversation', () => {
  const session = { root: 'C:/work', permission: 'auto', model: 'sonnet' };
  const args = claudeArguments(session, ['--resume', 'id']);
  for (const flag of ['-p', '--bare', '--permission-prompt-tool', 'stdio', '--include-partial-messages']) assert.ok(args.includes(flag), flag);
  assert.deepEqual(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2), ['--permission-mode', 'acceptEdits']);
  assert.deepEqual(args.slice(-4), ['--model', 'sonnet', '--resume', 'id']);
  assert.equal(claudeArguments({ ...session, permission: 'full' }, []).includes('bypassPermissions'), true);
  assert.equal(claudeArguments({ ...session, permission: 'read' }, []).includes('plan'), true);
  for (const permission of ['ask', 'custom']) assert.equal(claudeArguments({ ...session, permission }, []).includes('--permission-mode'), false);
});

test('conversations start with a fixed id and are resumed once Claude Code has saved them', async t => {
  const { root } = await workspace(t);
  const session = { root };
  const first = await claudeCli.conversationArguments(session);
  assert.equal(first[0], '--session-id'); assert.match(session.backendId, claudeCli.UUID);
  const folder = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'C--work');
  await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, `${session.backendId}.jsonl`), '');
  assert.deepEqual(await claudeCli.conversationArguments(session), ['--resume', session.backendId]);
  session.backendId = '../../escape';
  assert.equal((await claudeCli.conversationArguments(session))[0], '--session-id');
  assert.match(session.backendId, claudeCli.UUID);
});

test('a turn streams text, reports tools and finishes on the result', async t => {
  const f = await backend(t);
  const running = f.agent.run('Hola', [], [{ mime: 'image/png', data: 'AAAA' }]);
  const child = await started(f.fake, 1);
  assert.equal(child.options.env.ANTHROPIC_API_KEY, KEY);
  assert.equal(child.options.cwd, f.session.root);
  assert.ok(child.args.includes('--session-id'));
  assert.equal(f.saved(), 1);
  const input = await nextInput(child, 'user');
  assert.deepEqual(input.message.content, [{ type: 'text', text: 'Hola' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]);
  child.send({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' });
  child.send({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1' } } });
  child.send({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } });
  child.send({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Ho' } } });
  child.send({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'la' } } });
  child.send({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'Hola' }, { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }] } });
  child.send({ type: 'stream_event', parent_tool_use_id: 'tool-1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'subagent' } } });
  child.send({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: false }] } });
  child.send({ type: 'result', subtype: 'success', is_error: false, result: 'Hola' });
  await running;
  assert.deepEqual(f.events, [
    { type: 'delta', id: 'm1', text: 'Ho' }, { type: 'delta', id: 'm1', text: 'la' },
    { type: 'activity', id: 'tool-1', text: 'Bash: ls', status: 'inProgress' },
    { type: 'activity', id: 'tool-1', text: 'Bash: ls', status: 'completed' }
  ]);
});

test('a missing key blocks the turn before Claude Code starts', async t => {
  const f = await backend(t, { key: '' });
  await assert.rejects(f.agent.run('Hola', []), /clave de API/);
  assert.equal(f.fake.spawned.length, 0);
});

test('a credential source other than the user key stops the process', async t => {
  const f = await backend(t);
  const running = f.agent.run('Hola', []);
  const child = await started(f.fake, 1);
  child.send({ type: 'system', subtype: 'init', apiKeySource: '/login managed key' });
  await assert.rejects(running, /no está usando tu clave/);
  assert.equal(child.killed, true);
});

test('an invalid key reports the authentication error instead of the CLI hint', async t => {
  const f = await backend(t);
  const running = f.agent.run('Hola', []);
  const child = await started(f.fake, 1);
  child.send({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' });
  child.send({ type: 'assistant', parent_tool_use_id: null, error: 'authentication_failed', message: { id: 'x', content: [{ type: 'text', text: 'Invalid API key' }] } });
  child.send({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key' });
  await assert.rejects(running, /no es válida o se ha revocado/);
  assert.deepEqual(f.events, []);
});

test('tool permissions and questions are answered from the chat', async t => {
  let answers = [true, false, 'Sí'];
  const prompts = [];
  const f = await backend(t, { approve: async prompt => { prompts.push(prompt); return answers.shift(); } });
  const running = f.agent.run('Hola', []);
  const child = await started(f.fake, 1);
  const responses = [];
  child.on('input', message => { if (message.type === 'control_response') responses.push(message.response); });
  child.send({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Write', display_name: 'Write', input: { file_path: 'a.md' } } });
  child.send({ type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm x' } } });
  child.send({ type: 'control_request', request_id: 'r3', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion',
    input: { questions: [{ question: '¿Seguimos?', header: 'Confirmar', options: [{ label: 'Sí' }, { label: 'No' }] }] } } });
  child.send({ type: 'control_request', request_id: 'r4', request: { subtype: 'mcp_message' } });
  while (responses.length < 4) await new Promise(resolve => setImmediate(resolve));
  const byId = Object.fromEntries(responses.map(response => [response.request_id, response]));
  assert.deepEqual(byId.r1.response, { behavior: 'allow', updatedInput: { file_path: 'a.md' } });
  assert.equal(byId.r2.response.behavior, 'deny');
  assert.deepEqual(byId.r3.response.updatedInput.answers, { '¿Seguimos?': 'Sí' });
  assert.equal(byId.r4.subtype, 'error');
  assert.match(prompts[0].title, /Write/); assert.match(prompts[0].detail, /a\.md/);
  assert.equal(prompts[2].question, true);
  child.send({ type: 'result', subtype: 'success', is_error: false });
  await running;
});

test('stopping interrupts the turn and model changes restart the process with the saved conversation', async t => {
  const f = await backend(t);
  const running = f.agent.run('Hola', []);
  const child = await started(f.fake, 1);
  child.on('input', message => {
    if (message.request?.subtype !== 'interrupt') return;
    child.send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } });
    child.send({ type: 'result', subtype: 'error_during_execution', is_error: true });
  });
  await f.agent.stop();
  await running;
  f.session.model = 'opus';
  const next = f.agent.run('Otra', []);
  await started(f.fake, 2);
  assert.equal(child.killed, true);
  assert.ok(f.fake.spawned[1].args.includes('opus'));
  f.fake.spawned[1].send({ type: 'result', subtype: 'success', is_error: false });
  await next;
});

test('the API key is stored in VS Code secret storage and invalid values are ignored', async () => {
  const store = new Map(); let prompts = 0;
  const secrets = { get: async key => store.get(key), store: async (key, value) => store.set(key, value), delete: async key => store.delete(key) };
  const window = { showInputBox: async options => { prompts++; assert.equal(options.password, true); assert.match(options.prompt, /suscripción/); return `  ${KEY}  `; } };
  const key = new ClaudeApiKey(secrets, window);
  assert.equal(await key.ensure(), KEY);
  assert.equal(await key.ensure(), KEY);
  assert.equal(prompts, 1);
  store.set(SECRET_KEY, 'bad key');
  assert.equal(await key.get(), undefined);
  await key.remove();
  assert.equal(store.has(SECRET_KEY), false);
});
