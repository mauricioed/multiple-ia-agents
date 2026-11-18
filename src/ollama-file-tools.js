'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { inside, listDirectory, resolveEntry } = require('./core');

const FILE_CHUNK_BYTES = 16 * 1024;
const DIRECTORY_PAGE_SIZE = 100;

function tool(name, description, properties, required) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

const toolPath = { type: 'string', description: 'Use a path relative to the chat folder by default. Use a full local path when the user requests access outside it. External access requires approval.' };
const offset = { type: 'integer', minimum: 0 };
const tools = [
  tool('list_chat_directory', 'List files and folders. Use "." for the chat root. Explore project documentation and specifications when relevant. Pass nextOffset as offset to continue.', {
    path: toolPath, offset
  }, ['path']),
  tool('read_chat_file', 'Read a UTF-8 text file by path, including project specifications. Pass nextOffset as offset to continue.', {
    path: toolPath, offset
  }, ['path'])
];

async function resolveToolPath(root, target, authorize, signal) {
  if (typeof target !== 'string' || !target.trim() || target.length > 4096 || /[\x00-\x1f]/u.test(target)) throw new Error('Invalid path.');
  const localPath = target.replace(/\\/gu, '/');
  if (localPath.startsWith('//') || localPath.replace(/^[a-z]:\//iu, '').includes(':')) throw new Error('Expected a local filesystem path.');
  const candidate = path.resolve(root, localPath);
  if (inside(root, candidate)) {
    const relative = path.relative(root, candidate);
    return resolveEntry(root, relative ? relative.split(path.sep) : []);
  }
  const absolute = process.platform === 'win32' ? /^[a-z]:\//iu.test(localPath) : path.isAbsolute(localPath);
  if (!absolute || !authorize) throw new Error('Use a full local path to request access outside the chat folder.');
  const realTarget = await fs.realpath(candidate);
  if (realTarget.replace(/\\/gu, '/').startsWith('//')) throw new Error('Expected a local filesystem path.');
  signal.throwIfAborted();
  if (!await authorize(realTarget, signal)) throw new Error('The user did not approve access to this path.');
  signal.throwIfAborted();
  if (path.relative(realTarget, await fs.realpath(realTarget))) throw new Error('The approved path changed.');
  return realTarget;
}

async function readText(target, offset, signal) {
  if (!(await fs.stat(target)).isFile()) throw new Error('Expected a regular file.');
  signal.throwIfAborted();
  const file = await fs.open(target);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || offset > stat.size) throw new Error('Invalid file or offset.');
    const buffer = Buffer.alloc(FILE_CHUNK_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) throw new Error('Expected a UTF-8 text file.');
    const hasMore = offset + bytesRead < stat.size && bytesRead > 0;
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes, { stream: hasMore });
    const nextOffset = hasMore ? offset + Buffer.byteLength(content) : null;
    return { content, nextOffset };
  } finally {
    await file.close();
  }
}

async function runFileTool(root, call, signal, authorize) {
  signal.throwIfAborted();
  const name = call.function.name;
  const args = call.function.arguments;
  try {
    if (name !== 'read_chat_file' && name !== 'list_chat_directory') return { error: 'Unknown tool.' };
    const offset = args?.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid offset.');
    const target = await resolveToolPath(root, args?.path, authorize, signal);
    signal.throwIfAborted();
    if (name === 'read_chat_file') return await readText(target, offset, signal);
    const entries = await listDirectory(target, []);
    const end = offset + DIRECTORY_PAGE_SIZE;
    return { entries: entries.slice(offset, end), nextOffset: end < entries.length ? end : null };
  } catch (error) {
    signal.throwIfAborted();
    return { error: error.code ? 'The path could not be accessed.' : error.message };
  }
}

module.exports = { tools, runFileTool };
