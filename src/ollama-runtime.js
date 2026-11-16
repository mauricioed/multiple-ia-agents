'use strict';
const { t, language } = require('./i18n');
const { spawn } = require('node:child_process');

class OllamaRuntime {
  constructor({ baseUrl = 'http://127.0.0.1:11435', existingUrl = 'http://127.0.0.1:11434', env = {} } = {}) {
    this.baseUrl = baseUrl; this.existingUrl = existingUrl; this.env = env;
  }
  async available(url) {
    try {
      const response = await fetch(url + '/api/version', { signal: AbortSignal.timeout(1000) });
      return response.ok && typeof (await response.json()).version === 'string';
    } catch { return false; }
  }
  async ensure(invocation) {
    if (this.starting) return this.starting;
    this.starting = this.start(invocation).finally(() => { this.starting = undefined; });
    return this.starting;
  }
  async start(invocation) {
    for (const url of [this.baseUrl, this.existingUrl].filter(Boolean)) if (await this.available(url)) return url;
    let failure; let exited = false;
    const child = spawn(invocation.shellPath, [...invocation.shellArgs, 'serve'], {
      windowsHide: true, shell: false, stdio: 'ignore',
      env: { ...process.env, ...this.env, OLLAMA_HOST: new URL(this.baseUrl).host }
    });
    this.child = child;
    child.on('error', error => { failure = error; });
    child.once('exit', () => { exited = true; if (this.child === child) this.child = undefined; });
    child.unref();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await this.available(this.baseUrl)) return this.baseUrl;
      if (failure || exited) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (this.child === child) this.stop();
    throw new Error(t('No se pudo iniciar el servidor de Ollama instalado') + (failure?.code ? ' (' + failure.code + ')' : '') + t('. Comprueba el puerto local ') + new URL(this.baseUrl).port + t(' y vuelve a intentarlo.'));
  }
  stop() { const child = this.child; this.child = undefined; child?.kill(); }
}

const runtime = new OllamaRuntime();
process.once('exit', () => runtime.stop());
module.exports = { OllamaRuntime, ensureServer: invocation => runtime.ensure(invocation), stopServer: () => runtime.stop() };
