'use strict';
const { t, language } = require('./i18n');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
function fingerprint(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
async function resolveEntry(root, segments = []) {
  if (!Array.isArray(segments) || segments.some(s => typeof s !== 'string' || !s || s === '.' || s === '..' || /[\\/\x00:]/u.test(s))) {
    throw new Error(t('Ruta de archivo no válida.'));
  }
  const realRoot = await fs.realpath(root);
  const target = await fs.realpath(path.join(realRoot, ...segments));
  if (!inside(realRoot, target)) throw new Error(t('El archivo está fuera de la carpeta de este chat.'));
  return target;
}
async function listDirectory(root, segments) {
  const target = await resolveEntry(root, segments);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.filter(e => e.isDirectory() || e.isFile()).map(e => ({
    name: e.name, directory: e.isDirectory(), markdown: /\.(md|markdown)$/iu.test(e.name)
  })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}
async function readMarkdown(root, segments) {
  const target = await resolveEntry(root, segments);
  if (!/\.(md|markdown)$/iu.test(target)) throw new Error(t('Selecciona un documento Markdown.'));
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > MAX_MARKDOWN_BYTES) throw new Error(t('El editor admite archivos Markdown de hasta 2 MB.'));
  const bytes = await fs.readFile(target);
  if (bytes.length > MAX_MARKDOWN_BYTES) throw new Error(t('El archivo supera los 2 MB.'));
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return { target, text, hash: fingerprint(bytes) };
}
function restoreSessions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(s => {
    if (!s || typeof s.id !== 'string' || seen.has(s.id) || typeof s.name !== 'string' || typeof s.root !== 'string' || !path.isAbsolute(s.root) || !['vscode', 'codex', 'claude', 'ollama', 'terminal'].includes(s.provider)) return false;
    seen.add(s.id);
    return true;
  }).map(({ id, name, root, provider, nativeAgent, closed, closedAt, model, needsAgentSelection, mode, access }) => {
    const agent = provider === 'vscode' ? ['codex', 'claude', 'ollama'].includes(nativeAgent) ? nativeAgent : 'terminal' : provider;
    const apiKey = agent === 'claude' && access === 'apiKey' && mode !== 'terminal';
    return { id, name, root, provider: agent,
    ...(closed === true ? { closed: true, ...(Number.isFinite(closedAt) ? { closedAt } : {}) } : {}),
    ...(apiKey ? { access: 'apiKey' } : {}),
    // Claude chats without the user's API key run the official Claude Code CLI in a terminal.
    ...(mode === 'terminal' || provider === 'terminal' || (agent === 'claude' && !apiKey) ? { mode: 'terminal' } : {}),
    ...(typeof model === 'string' && model && !/[\x00\r\n]/u.test(model) && !model.startsWith('-') ? { model } : {}),
    ...(needsAgentSelection === true || provider === 'vscode' && !['codex', 'claude', 'ollama'].includes(nativeAgent) ? { needsAgentSelection: true } : {}) };
  });
}
module.exports = { MAX_MARKDOWN_BYTES, fingerprint, inside, resolveEntry, listDirectory, readMarkdown, restoreSessions };
