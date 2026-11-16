'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { codexPermissions, permissionMode } = require('../src/permissions');
const { CodexBackend } = require('../src/backends');

test('automatic review changes reviewer while preserving the workspace and network boundary', () => {
  const manual = codexPermissions('ask', 'C:/project');
  const automatic = codexPermissions('auto', 'C:/project');
  assert.equal(manual.thread.approvalsReviewer, 'user');
  assert.equal(automatic.thread.approvalsReviewer, 'auto_review');
  assert.equal(automatic.turn.approvalsReviewer, 'auto_review');
  assert.equal(automatic.thread.approvalPolicy, 'on-request');
  assert.equal(automatic.thread.sandbox, 'workspace-write');
  assert.deepEqual(automatic.turn.sandboxPolicy, manual.turn.sandboxPolicy);
  assert.equal(automatic.turn.sandboxPolicy.networkAccess, false);
});

test('legacy read-only sessions keep their restrictions and unknown modes stay manual', () => {
  assert.deepEqual(codexPermissions('read', 'C:/project').turn.sandboxPolicy, { type: 'readOnly' });
  assert.equal(permissionMode('unknown'), 'ask');
});

for (const mode of ['ask', 'auto', 'full', 'custom', 'read']) test('Codex adapter applies ' + mode + ' on resume and every turn', { timeout: 3000 }, async () => {
  const calls = [];
  const agent = new CodexBackend({ root: 'C:/synthetic-project', model: 'test-model', backendId: 'synthetic-thread', permission: mode }, '', () => {}, async () => false, async () => {});
  agent.connect = async () => {};
  agent.rpc = { dispose() {}, closed: false, request: async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/resume') return { thread: { id: 'synthetic-thread' } };
    if (method === 'turn/start') { setImmediate(() => agent.finish()); return { turn: { id: 'synthetic-turn' } }; }
    throw new Error('Unexpected request');
  } };
  try {
    await agent.run('Synthetic input');
    const expected = codexPermissions(mode, 'C:/synthetic-project');
    for (const [key, value] of Object.entries(expected.thread)) assert.deepEqual(calls[0].params[key], value);
    for (const [key, value] of Object.entries(expected.turn)) assert.deepEqual(calls[1].params[key], value);
    if (mode === 'custom') for (const key of ['approvalPolicy', 'approvalsReviewer', 'sandbox', 'sandboxPolicy']) { assert.equal(key in calls[0].params, false); assert.equal(key in calls[1].params, false); }
    await agent.run('Second synthetic input');
    assert.equal(calls[2].method, 'turn/start');
    for (const [key, value] of Object.entries(expected.turn)) assert.deepEqual(calls[2].params[key], value);
  } finally { agent.dispose(); }
});

test('full access maps to native unrestricted mode and custom delegates to native configuration', () => {
  const { permissionArguments } = require('../src/permissions');
  assert.deepEqual(codexPermissions('full', 'C:/project'), {
    thread: { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' },
    turn: { approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'dangerFullAccess' } }
  });
  assert.deepEqual(codexPermissions('custom', 'C:/project'), { thread: {}, turn: {} });
  assert.deepEqual(permissionArguments('codex', 'custom'), []);
  assert.deepEqual(permissionArguments('codex', 'full').slice(0, 4), ['--sandbox', 'danger-full-access', '--ask-for-approval', 'never']);
});
