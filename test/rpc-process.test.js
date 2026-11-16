const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { RpcProcess } = require('../src/rpc-process');
function fixture() {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const rpc = new RpcProcess({ shellPath: 'node', shellArgs: ['codex.js'] }, '.', (file, args, options) => {
    assert.equal(options.shell, false); assert.deepEqual(args, ['codex.js', 'app-server']); return child;
  });
  return { child, rpc };
}
test('RPC handles fragmented lines, concurrent replies and server requests', async () => {
  const { child, rpc } = fixture(); let approval;
  rpc.on('message', message => { approval = message; });
  const one = rpc.request('one'); const two = rpc.request('two');
  child.stdout.write('{"id":2,"result":"two"}\n{"id":1,"res'); child.stdout.write('ult":"one"}\n');
  assert.deepEqual(await Promise.all([one, two]), ['one', 'two']);
  child.stdout.write('{"method":"approval","id":123,"params":{"threadId":"first"}}\n');
  assert.equal(approval.id, 123); rpc.dispose();
});
test('disconnect rejects pending work and clears timeouts', async () => {
  const { child, rpc } = fixture(); const pending = rpc.request('pending');
  child.emit('exit', 1); await assert.rejects(pending, /desconectado/); assert.equal(rpc.pending.size, 0); rpc.dispose();
});
