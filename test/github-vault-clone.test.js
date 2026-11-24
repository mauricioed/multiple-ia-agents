'use strict';
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');

const remote = 'https://github.com/owner/notes.git';
const vscode = {
  workspace: { isTrusted: true },
  authentication: { getSession: async () => ({ accessToken: 'test-token' }) }
};
const git = promisify(childProcess.execFile);
let transport;
const load = Module._load;
Module._load = function(name, parent, ...args) {
  if (name === 'vscode') return vscode;
  if (name === 'node:child_process' && parent.filename.endsWith('github-vault.js')) {
    const execFile = (...args) => transport(...args);
    execFile[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
      transport(file, args, options, (error, stdout) => error ? reject(error) : resolve({ stdout }));
    });
    return { execFile };
  }
  return load.call(this, name, parent, ...args);
};
const { GitHubVault } = require('../src/github-vault');
Module._load = load;

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-vault-clone-')));
  const oldVault = { name: 'Previous', root };
  const storage = (initial = {}) => {
    const data = new Map(Object.entries(initial));
    return { get: (key, fallback) => data.get(key) ?? fallback, update: async (key, value) => data.set(key, value) };
  };
  const context = { workspaceState: storage({ 'githubVault.active': oldVault }), globalState: storage() };
  const requests = [];
  const originalFetch = global.fetch;
  const respond = (metadata, status = 200) => {
    global.fetch = async (url, options) => {
      requests.push([url, options.method]);
      return { ok: status === 200, status, json: async () => metadata };
    };
  };
  respond({ private: true, visibility: 'private', clone_url: remote });
  t.after(async () => {
    global.fetch = originalFetch;
    vscode.workspace.isTrusted = true;
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, oldVault, context, vault: new GitHubVault(context), requests, respond };
}

test('clones existing Git history and registers the folder as the active Vault', async t => {
  const f = await fixture(t);
  const source = await fs.mkdtemp(path.join(f.root, 'source-'));
  const sourceGit = (...args) => git('git', args, { cwd: source });
  await sourceGit('init', '--initial-branch=main');
  await fs.writeFile(path.join(source, 'template.md'), '# Plantilla existente\n');
  await sourceGit('add', '--', 'template.md');
  await sourceGit('-c', 'user.name=Vault test', '-c', 'user.email=vault-test', 'commit', '-m', 'Add template');
  transport = (file, args, options, callback) => {
    if (!args.includes('clone')) return childProcess.execFile(file, args, options, callback);
    assert.ok(args.includes('--no-recurse-submodules'));
    assert.ok(args.includes('credential.helper='));
    assert.ok(Object.values(options.env).includes('http.https://github.com/.extraHeader'));
    assert.equal(args.at(-2), remote);
    assert.ok(!args.join(' ').includes('test-token'));
    const destination = args.at(-1);
    (async () => {
      await git('git', ['clone', '--', source, destination], { cwd: f.root });
      await git('git', ['remote', 'set-url', 'origin', remote], { cwd: destination });
    })().then(() => callback(null, '', ''), callback);
  };
  const folder = { root: f.root };
  assert.equal(await f.vault.run('clone', folder, 'https://github.com/owner/notes.git'), true);
  const cloned = await fs.realpath(path.join(f.root, 'notes'));
  const restored = new GitHubVault(f.context);
  assert.deepEqual(restored.active, { name: 'notes', root: cloned });
  assert.match(await restored.loadTemplate({ vault: true, rootPath: cloned, segments: ['template.md'] }), /^# Plantilla existente\r?\n$/u);
  assert.equal((await git('git', ['rev-parse', 'HEAD'], { cwd: cloned })).stdout, (await sourceGit('rev-parse', 'HEAD')).stdout);
  assert.deepEqual(f.requests, [['https://api.github.com/repos/owner/notes', 'GET']]);
  await assert.rejects(f.vault.run('clone', folder, 'owner/notes'), /Ya existe/);
  assert.deepEqual(restored.active, { name: 'notes', root: cloned });
});

test('rejects untrusted workspaces, invalid URLs and repositories GitHub cannot verify as private', async t => {
  const f = await fixture(t);
  const folder = { root: f.root };
  transport = () => assert.fail('Git must not run before verification');
  assert.equal(await f.vault.run('clone', undefined, 'owner/notes'), false);
  vscode.workspace.isTrusted = false;
  await assert.rejects(f.vault.run('clone', folder, 'owner/notes'), /confianza/);
  vscode.workspace.isTrusted = true;
  await assert.rejects(f.vault.run('clone', folder, 'https://example.test/owner/notes'), /URL HTTPS/);
  assert.deepEqual(f.requests, []);
  for (const [metadata, status, message] of [
    [{ private: false, visibility: 'public', clone_url: remote }, 200, /privado verificado/],
    [{ private: true, visibility: 'internal', clone_url: remote }, 200, /privado verificado/],
    [{ private: true, visibility: 'private', clone_url: 'https://github.com/other/notes.git' }, 200, /destino/],
    [{}, 404, /404/]
  ]) {
    f.respond(metadata, status);
    await assert.rejects(f.vault.run('clone', folder, 'owner/notes'), message);
    assert.deepEqual(f.vault.active, f.oldVault);
  }
  assert.deepEqual(await fs.readdir(f.root), []);
});

test('keeps the active Vault and removes only the empty destination if Git cannot clone', async t => {
  const f = await fixture(t);
  transport = (file, args, options, callback) => {
    if (args.includes('clone')) return callback(new Error('git failure with sensitive process details'));
    return childProcess.execFile(file, args, options, callback);
  };
  await assert.rejects(f.vault.run('clone', { root: f.root }, 'owner/notes'), { message: 'No se pudo clonar el repositorio. Revisa el acceso a GitHub y el destino local.' });
  assert.deepEqual(f.vault.active, f.oldVault);
  assert.deepEqual(await fs.readdir(f.root), []);
});
