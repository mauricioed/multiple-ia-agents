'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function configDirectory(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Claude Code stores each conversation as projects/<folder>/<session id>.jsonl.
async function conversationExists(id, env = process.env) {
  if (typeof id !== 'string' || !UUID.test(id)) return false;
  const projects = path.join(configDirectory(env), 'projects');
  let entries;
  try { entries = await fs.readdir(projects, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try { if ((await fs.stat(path.join(projects, entry.name, `${id}.jsonl`))).isFile()) return true; } catch {}
  }
  return false;
}

async function conversationCandidates(root, since, env = process.env) {
  const folder = await fs.realpath(root);
  const key = folder.replace(/[^a-zA-Z0-9]/gu, '-');
  const projects = path.join(configDirectory(env), 'projects');
  const projectDirectories = await fs.readdir(projects, { withFileTypes: true }).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return [];
  });
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const expected = normalize(key);
  const directories = projectDirectories.filter(entry => {
    const name = normalize(entry.name);
    return entry.isDirectory() && (key.length > 200 ? name.startsWith(expected.slice(0, 200) + '-') : name === expected);
  });
  const found = new Map();
  let uncertain = false;
  for (const entry of directories) {
    const directory = path.join(projects, entry.name);
    for (const file of await fs.readdir(directory, { withFileTypes: true })) {
      const id = path.basename(file.name, '.jsonl');
      if (!file.isFile() || !file.name.endsWith('.jsonl') || !UUID.test(id)) continue;
      const filename = path.join(directory, file.name);
      const metadata = await readConversationCandidate(filename, id, folder, since);
      if (metadata === null) uncertain = true;
      if (metadata && (!found.has(id) || found.get(id).modified < metadata.modified)) found.set(id, metadata);
    }
  }
  return { conversations: [...found.values()].sort((a, b) => b.modified - a.modified), uncertain };
}

async function readConversationCandidate(filename, id, root, since) {
  const file = await fs.open(filename, 'r').catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!file) return;
  try {
    const stat = await file.stat();
    if (Number.isFinite(since) && stat.mtimeMs < since) return;
    const limit = 128 * 1024;
    const buffer = Buffer.alloc(Math.min(stat.size, limit));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    let matchesFolder = false;
    let hasFolder = false;
    let title;
    for (const line of buffer.toString('utf8', 0, bytesRead).split('\n')) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row?.type === 'custom-title' || row?.type === 'ai-title') {
        const value = row.customTitle || row.aiTitle;
        if (typeof value === 'string' && (row.sessionId === id || !row.sessionId)) title = value.trim().slice(0, 200);
      }
      if (!hasFolder && row?.sessionId === id && !row.isSidechain && typeof row.cwd === 'string' &&
          path.isAbsolute(row.cwd) && (row.type === 'user' || row.type === 'assistant')) {
        hasFolder = true;
        if (path.relative(root, row.cwd)) return;
        const created = Date.parse(row.timestamp);
        if (Number.isFinite(since) && Number.isFinite(created) && created < since) return;
        matchesFolder = true;
      }
    }
    // A large first message can hide the cwd from a bounded read.
    if (!matchesFolder) return stat.size > bytesRead ? null : undefined;
    return { id, title, modified: stat.mtimeMs };
  } finally {
    await file.close();
  }
}

// Each chat owns one Claude Code conversation: create it with a known id, then resume it.
async function conversationArguments(session, env = process.env, createId = randomUUID) {
  if (typeof session.backendId !== 'string' || !UUID.test(session.backendId)) session.backendId = createId();
  return await conversationExists(session.backendId, env) ? ['--resume', session.backendId] : ['--session-id', session.backendId];
}

// The official VS Code extension ships the unmodified Claude Code binary.
function officialBinary(vscode) {
  const extension = vscode?.extensions?.getExtension('anthropic.claude-code');
  if (!extension?.extensionPath) return undefined;
  return path.join(extension.extensionPath, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude');
}

module.exports = { UUID, configDirectory, conversationExists, conversationCandidates, conversationArguments, officialBinary };
