'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const core = require('./core');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const vscode = require('vscode');
const { t } = require('./i18n');

const exec = promisify(execFile);
const activeKey = 'githubVault.active';
const markdown = { Markdown: ['md', 'markdown'] };
const registryKey = 'githubVault.localFolders';
const folderKey = 'githubVault.lastFolder';

function missingVaultPath(error) { return error.code === 'ENOENT' || error.code === 'ENOTDIR'; }
const repoUrl = /^https:\/\/github\.com\/([a-z\d-]+\/[a-z\d_.-]+?)(?:\.git)?$/iu;

function syncKey(root) { return 'githubVault.sync.' + createHash('sha256').update(root).digest('hex'); }
function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/iu.test(key)));
  return { ...env, GIT_TERMINAL_PROMPT: '0' };
}

function githubGit(options, token, hooks, failure) {
  const entries = [
    ['http.extraHeader', ''],
    ['http.https://github.com/.extraHeader', `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`],
    ['http.followRedirects', 'false'],
    ['core.hooksPath', hooks]
  ];
  const env = { ...options.env, GIT_CONFIG_COUNT: String(entries.length) };
  for (const [index, [key, value]] of entries.entries()) {
    env['GIT_CONFIG_KEY_' + index] = key;
    env['GIT_CONFIG_VALUE_' + index] = value;
  }
  return async (...args) => {
    try { return (await exec('git', args, { ...options, env })).stdout.trim(); }
    catch { throw new Error(failure); }
  };
}

function repositoryName(name) {
  const normalized = name.normalize('NFKD').replace(/\p{M}/gu, '').trim().replace(/[^a-z\d_.-]+/giu, '-');
  if (/^[a-z\d_.-]{1,100}$/iu.test(normalized) && /[a-z\d]/iu.test(normalized) && !/\.git$/iu.test(normalized)) return normalized;
}

const invalidVaultName = () => t('El nombre de la bóveda debe permitir crear un nombre de repositorio válido en GitHub.');

async function github(token, endpoint, body) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`${t('GitHub rechazó la operación')} (${response.status}).`);
  return response.json();
}

function privateRepo(metadata) {
  if (metadata?.private !== true || metadata.visibility !== 'private') {
    throw new Error(t('GitHub Markdown Vault requiere un repositorio privado verificado.'));
  }
}

function insideVault(root, target) {
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).some(part => /^(\.\.|\.git)$/iu.test(part))) {
    throw new Error(t('Selecciona un archivo Markdown dentro de GitHub Markdown Vault.'));
  }
}

async function readTemplate(root, target) {
  insideVault(root, target);
  if (!/\.(md|markdown)$/iu.test(target)) throw new Error(t('Selecciona un archivo Markdown dentro de GitHub Markdown Vault.'));
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > 400000) throw new Error(t('Selecciona una plantilla Markdown de hasta 100.000 caracteres.'));
  const content = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(target));
  if (content.length > 100000 || content.includes('\0')) throw new Error(t('Selecciona una plantilla Markdown de hasta 100.000 caracteres.'));
  return content;
}

async function saveConversation(root, session, history) {
  const messages = history.filter(entry => entry.role === 'user' || entry.role === 'assistant');
  if (!messages.length) throw new Error(t('Esta conversación todavía no tiene mensajes.'));
  const title = session.name.replace(/[\r\n]+/gu, ' ');
  const name = title.replace(/[<>:"/\\|?*\x00-\x1f]/gu, '-').slice(0, 80);
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const file = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(root, `${stamp} ${name}.md`)), filters: markdown,
    saveLabel: t('Guardar conversación en GitHub Markdown Vault')
  });
  if (!file) return;
  const target = /\.(md|markdown)$/iu.test(file.fsPath) ? file.fsPath : `${file.fsPath}.md`;
  const folder = await fs.realpath(path.dirname(target));
  const destination = path.join(folder, path.basename(target));
  insideVault(root, destination);
  const sections = messages.map(entry => {
    const speaker = entry.role === 'user' ? t('Usuario') : session.provider;
    return `## ${speaker}\n\n${entry.text}`;
  });
  try { await fs.writeFile(destination, [`# ${title}`, ...sections].join('\n\n') + '\n', { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(t('Ese archivo ya existe. Elige otro nombre.')); throw error; }
  return true;
}

class GitHubVault {
  constructor(context) { this.context = context; }

  get active() {
    const storage = this.context.workspaceState;
    const active = storage.get(activeKey);
    if (active) return active;
    const root = storage.get('githubVaultFolder');
    if (typeof root === 'string' && path.isAbsolute(root)) return { name: path.basename(root) || root, root };
    return this.context.globalState.get(registryKey, [])?.at(-1);
  }

  get lastFolder() {
    const saved = this.context.workspaceState.get(folderKey);
    return saved && saved.root === this.active?.root ? saved.segments : undefined;
  }

  async rememberFolder(root, segments) {
    if (this.active?.root === root) await this.context.workspaceState.update(folderKey, { root, segments });
  }

  async loadTemplate(entry) {
    const vault = this.active;
    if (!vault || !entry?.vault || entry.rootPath !== vault.root) throw new Error(t('La bóveda activa ha cambiado.'));
    const root = await this.localRoot(vault);
    const target = await core.resolveEntry(root, entry.segments);
    return readTemplate(root, target);
  }

  async saveConversation(session, history) { return saveConversation(await this.activeRoot(), session, history); }

  async activeRoot() {
    const vault = this.active;
    if (!vault) throw new Error(t('Abre una carpeta como bóveda primero.'));
    return this.localRoot(vault);
  }

  async run(action, folder, value) {
    if (this.busy) return false;
    this.busy = true;
    try {
      if (action === 'open') return await this.open(folder, value);
      if (action === 'clone') return await this.clone(folder, value);
      if (action === 'sync') return await this.sync();
      return false;
    } finally { this.busy = false; }
  }

  async pickFolder(forClone = false) {
    const currentVault = this.active;
    const defaultRoot = currentVault && await this.localRoot(currentVault, true);
    const [folder] = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      defaultUri: defaultRoot ? vscode.Uri.file(forClone ? path.dirname(defaultRoot) : defaultRoot) : undefined,
      openLabel: forClone ? t('Elegir carpeta de destino') : t('Abrir carpeta como bóveda')
    }) || [];
    if (!folder || folder.scheme !== 'file') return false;
    const root = await fs.realpath(folder.fsPath);
    if (!(await fs.stat(root)).isDirectory()) return false;
    const storage = this.context.globalState;
    const vaults = storage.get(registryKey, []);
    const existing = vaults.find(item => !path.relative(item.root, root));
    return { root, name: existing?.name || path.basename(folder.fsPath) || path.basename(root) };
  }

  async open(folder, name) {
    if (!folder) return false;
    if (typeof name !== 'string' || !repositoryName(name)) throw new Error(invalidVaultName());
    const root = await this.localRoot({ root: folder.root });
    const storage = this.context.globalState;
    const vaults = storage.get(registryKey, []);
    const vault = { name: name.trim(), root };
    await storage.update(registryKey, [...vaults.filter(item => path.relative(item.root, root)), vault]);
    await this.context.workspaceState.update(activeKey, vault);
    return true;
  }

  async clone(folder, input) {
    if (!folder) return false;
    if (!vscode.workspace.isTrusted) throw new Error(t('Clonar una bóveda requiere un espacio de trabajo de confianza.'));
    const value = typeof input === 'string' ? input.trim().replace(/\/$/u, '') : '';
    const url = value.includes('://') ? value : 'https://github.com/' + value;
    const repository = repoUrl.exec(url)?.[1];
    const name = repository?.split('/')[1];
    if (!name || repositoryName(name) !== name || name.endsWith('.')) {
      throw new Error(t('Introduce una URL HTTPS de GitHub o propietario/repositorio.'));
    }
    const parent = await this.localRoot(folder);
    const root = path.join(parent, name);
    const occupied = t('Ya existe una carpeta con el nombre del repositorio. Elige otra carpeta de destino.');
    const existing = await fs.lstat(root).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (existing) throw new Error(occupied);
    const { accessToken } = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    const metadata = await github(accessToken, `/repos/${repository}`);
    privateRepo(metadata);
    const remote = metadata.clone_url;
    const canonical = repoUrl.exec(remote)?.[1];
    if (canonical?.toLowerCase() !== repository.toLowerCase()) {
      throw new Error(t('El destino debe ser un repositorio HTTPS de GitHub.'));
    }
    const options = { cwd: parent, timeout: 120000, windowsHide: true, env: gitEnvironment() };
    const failure = t('No se pudo clonar el repositorio. Revisa el acceso a GitHub y el destino local.');
    const { stdout } = await exec('git', ['ls-remote', '--get-url', '--', remote], options).catch(() => { throw new Error(failure); });
    if (stdout.trim() !== remote) throw new Error(t('El destino debe ser un repositorio HTTPS de GitHub.'));
    try { await fs.mkdir(root); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(occupied);
      throw error;
    }
    const remoteGit = githubGit(options, accessToken, path.join(root, '.git', 'vault-disabled-hooks'), failure);
    try {
      await remoteGit('-c', 'credential.helper=', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
        'clone', '--origin', 'origin', '--no-recurse-submodules', '--', remote, root);
    } catch (error) {
      await fs.rmdir(root).catch(() => {});
      throw error;
    }
    const urls = await Promise.all([[], ['--push']].map(flags => exec(
      'git', ['remote', 'get-url', '--all', ...flags, 'origin'], { ...options, cwd: root }
    )));
    if (urls.some(result => result.stdout.trim() !== remote)) {
      throw new Error(t('La descarga y la subida deben usar el mismo repositorio HTTPS de GitHub.'));
    }
    await this.open({ root }, name);
    return true;
  }

  async localRoot(vault, allowMissing = false) {
    try {
      const root = await fs.realpath(vault.root);
      if (path.relative(vault.root, root) || !(await fs.stat(root)).isDirectory()) throw new Error(t('La carpeta de la bóveda ha cambiado.'));
      return root;
    } catch (error) {
      if (!missingVaultPath(error)) throw error;
      if (allowMissing) return;
      throw new Error(t('La carpeta de la bóveda ha cambiado.'));
    }
  }

  async syncStatus(rootPath) {
    const vault = this.active;
    if (!vault || rootPath !== vault.root) return 'unknown';
    try {
      const root = await this.localRoot(vault);
      const record = this.context.globalState.get(syncKey(root));
      if (!record) return 'unknown';
      const options = { cwd: root, timeout: 5000, windowsHide: true, env: gitEnvironment() };
      const git = async (...args) => (await exec('git', ['-c', 'core.fsmonitor=false', ...args], options)).stdout.trim();
      const [status, fetchUrl, pushUrl, ignoredMarkdown] = await Promise.all([
        git('status', '--porcelain=v2', '--branch', '--untracked-files=all', '--ignore-submodules=none'),
        git('remote', 'get-url', '--all', 'origin'),
        git('remote', 'get-url', '--push', '--all', 'origin'),
        git('ls-files', '--others', '--ignored', '--exclude-standard', '--', ':(icase,glob)**/*.md', ':(icase,glob)**/*.markdown')
      ]);
      const lines = status.split(/\r?\n/u);
      return fetchUrl === record.remote && pushUrl === record.remote && !ignoredMarkdown
        && lines.includes('# branch.oid ' + record.commit) && lines.includes('# branch.head ' + record.branch)
        && lines.every(line => line.startsWith('# ')) ? 'synced' : 'pending';
    } catch { return 'unknown'; }
  }

  async sync() {
    const vault = this.active;
    if (!vault) throw new Error(t('Abre una carpeta como bóveda primero.'));
    if (!vscode.workspace.isTrusted) throw new Error(t('La sincronización requiere un espacio de trabajo de confianza.'));
    const root = await this.localRoot(vault);
    const env = gitEnvironment();
    const options = { cwd: root, timeout: 120000, windowsHide: true, env };
    const hooks = path.join(root, '.git', 'vault-disabled-hooks');
    const git = async (...args) => (await exec('git', ['-c', `core.hooksPath=${hooks}`, ...args], options)).stdout.trim();
    const dotGit = await fs.lstat(path.join(root, '.git')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (dotGit && !dotGit.isDirectory()) throw new Error(t('La bóveda requiere su propio repositorio Git local.'));
    if (dotGit && path.relative(root, await git('rev-parse', '--show-toplevel'))) throw new Error(t('La bóveda requiere su propio repositorio Git local.'));
    const hasOrigin = dotGit && (await git('remote')).split(/\r?\n/u).includes('origin');
    const name = hasOrigin ? undefined : repositoryName(vault.name);
    if (!hasOrigin && !name) throw new Error(invalidVaultName());
    if (!dotGit) await git('init', '--initial-branch=main');
    await this.context.globalState.update(syncKey(root), undefined);
    const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    const token = session.accessToken;
    if (!hasOrigin) {
      const metadata = await github(token, '/user/repos', { name, private: true, auto_init: false });
      privateRepo(metadata);
      if (!repoUrl.test(metadata.clone_url)) throw new Error(t('El destino debe ser un repositorio HTTPS de GitHub.'));
      await git('remote', 'add', 'origin', metadata.clone_url);
    }
    const fetchUrl = await git('remote', 'get-url', '--all', 'origin');
    const pushUrl = await git('remote', 'get-url', '--push', '--all', 'origin');
    const repository = repoUrl.exec(fetchUrl)?.[1];
    if (!repository || fetchUrl !== pushUrl) throw new Error(t('La descarga y la subida deben usar el mismo repositorio HTTPS de GitHub.'));
    privateRepo(await github(token, `/repos/${repository}`));

    const branch = await git('symbolic-ref', '--short', 'HEAD');
    const ref = `refs/heads/${branch}`;
    const remoteGit = githubGit(options, token, hooks, t('No se pudo sincronizar con GitHub. Revisa el acceso y el estado de las ramas.'));
    const remoteBranch = await remoteGit('ls-remote', '--heads', fetchUrl, ref);
    await git('add', '-A', '--', '.');
    const initial = !(await git('rev-parse', '--verify', 'HEAD').catch(() => ''));
    if (initial || await git('diff', '--cached', '--name-only')) {
      await git('commit', '--allow-empty', '-m', 'Sync GitHub Markdown Vault');
    }
    if (remoteBranch) {
      await remoteGit('fetch', '--no-tags', '--no-recurse-submodules', fetchUrl, ref);
      await git('merge', '--ff-only', 'FETCH_HEAD');
    }
    privateRepo(await github(token, `/repos/${repository}`));
    const commit = await git('rev-parse', '--verify', ref);
    await remoteGit('push', '--no-recurse-submodules', fetchUrl, commit + ':' + ref);
    await this.context.globalState.update(syncKey(root), { remote: fetchUrl, branch, commit });
    vscode.window.showInformationMessage(t('Bóveda sincronizada con GitHub.'));
    return true;
  }
}

module.exports = { GitHubVault, missingVaultPath };
