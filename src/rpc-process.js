'use strict';
const { t, language } = require('./i18n');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { EventEmitter } = require('node:events');

// Codex stdio is newline-delimited JSON, not LSP Content-Length framing.
class RpcProcess extends EventEmitter {
  constructor(invocation, cwd, spawnProcess = spawn) {
    super(); this.pending = new Map(); this.sequence = 0; this.closed = false;
    this.child = spawnProcess(invocation.shellPath, [...invocation.shellArgs, 'app-server'], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', error => this.fail(error));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.method) this.emit('message', message);
      else {
        const call = this.pending.get(message.id); if (!call) return;
        this.pending.delete(message.id); clearTimeout(call.timer);
        if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
      }
    });
    // Do not copy subprocess stderr to the transcript: it can contain account details.
    this.child.stderr.on('data', () => {});
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(t('Codex se ha desconectado ({0}). Vuelve a enviar para reconectar.', code ?? t('cerrado')))));
  }
  write(message) {
    if (this.closed) throw new Error(t('Conexión Codex cerrada.'));
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(t('Codex no ha respondido a {0}.', method))); }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
    this.pending.clear(); this.emit('disconnect', error);
  }
  dispose() { this.fail(new Error(t('Conexión cerrada.'))); this.lines.close(); this.child.kill(); }
}
module.exports = { RpcProcess };
