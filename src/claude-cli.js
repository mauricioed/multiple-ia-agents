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

module.exports = { UUID, configDirectory, conversationExists, conversationArguments, officialBinary };
