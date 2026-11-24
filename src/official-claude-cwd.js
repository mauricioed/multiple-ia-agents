'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const { t } = require('./i18n');

const supportedVersion = '2.1.331';
const supportedEntryHash = '9dead0c8f6970cb4120bd002ee1eb2b10d025677941e4fc19c7162c67f3f25fa';
const normalize = value => value.replace(/\\/gu, '/').toLowerCase();
const isPanel = value => typeof value?.webview?.onDidReceiveMessage === 'function' &&
  typeof value.onDidDispose === 'function';

function unavailable() {
  return new Error(t('Esta versión de Claude Code no admite abrir otra carpeta en una pestaña nativa de esta ventana.'));
}

function supportsBuild(extension) {
  return process.platform === 'win32' && process.arch === 'x64' &&
    extension?.packageJSON?.version === supportedVersion && extension.packageJSON.main === './extension.js';
}

async function verifiedEntry(extension) {
  if (!supportsBuild(extension)) return undefined;
  const file = await fs.promises.realpath(path.join(extension.extensionPath, extension.packageJSON.main));
  const source = await fs.promises.readFile(file);
  return createHash('sha256').update(source).digest('hex') === supportedEntryHash ? file : undefined;
}

function stackMatches(stack, file, names) {
  const frames = String(stack).split('\n').slice(2, 2 + names.length);
  const location = normalize(file) + ':';
  return frames.length === names.length && frames.every((frame, index) =>
    frame.includes(names[index]) && normalize(frame).includes(location));
}

function watchOfficialClaudeRestores(extension, defaultFolder, findSession, bind, onError) {
  if (!supportsBuild(extension)) return undefined;
  // VS Code revives the selected webview before asynchronous extension startup
  // work finishes. Validate the installed build before registering this observer.
  const file = fs.realpathSync(path.join(extension.extensionPath, extension.packageJSON.main));
  if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== supportedEntryHash) return undefined;
  const primary = fs.realpathSync(defaultFolder);
  const weakSet = WeakMap.prototype.set;
  let disposed = false;
  const capture = new Proxy(weakSet, {
    apply(fn, receiver, args) {
      const result = Reflect.apply(fn, receiver, args);
      if (disposed || typeof args[1] !== 'boolean' || typeof args[0]?.reveal !== 'function') return result;
      const stack = new Error().stack;
      if (!stackMatches(stack, file, ['.setupPanel (']) || !isPanel(args[0])) return result;
      const panel = args[0];
      const session = findSession(panel);
      if (!session) return result;
      try {
        const folder = fs.realpathSync(session.root);
        if (!fs.statSync(folder).isDirectory()) return result;
        let redirected = !path.relative(primary, folder);
        const original = fs.realpathSync;
        const redirect = new Proxy(original, {
          apply(target, context, params) {
            if (typeof params[0] === 'string' && params.length === 1 && !path.relative(defaultFolder, params[0]) &&
                stackMatches(new Error().stack, file, ['at ni (', 'at Hi (', '.setupPanel ('])) {
              redirected = true;
              fs.realpathSync = original;
              return folder;
            }
            return Reflect.apply(target, context, params);
          }
        });
        if (!redirected) fs.realpathSync = redirect;
        queueMicrotask(() => {
          if (fs.realpathSync === redirect) fs.realpathSync = original;
          if (redirected && !disposed) bind(session, panel);
        });
      } catch (error) { onError(error); }
      return result;
    }
  });
  WeakMap.prototype.set = capture;
  return { dispose() {
    disposed = true;
    if (WeakMap.prototype.set === capture) WeakMap.prototype.set = weakSet;
  } };
}

async function openOfficialClaude(extension, { defaultFolder, folder, sessionId, observePanel }, open) {
  const file = await verifiedEntry(extension);
  if (!file) {
    if (defaultFolder) throw unavailable();
    await open();
    return { redirected: true };
  }
  // Observe only the verified native constructor during this command.
  // Trust, permissions and unrelated operations use the original methods.
  const scope = new AsyncLocalStorage();
  const token = {};
  const framesMatch = (stack, names) => stackMatches(stack, file, names);
  const original = fs.realpathSync;
  let redirected = !defaultFolder;
  let existingPanel;
  let capturedPanel;
  const redirect = new Proxy(original, {
    apply(fn, receiver, args) {
      if (scope.getStore() === token && typeof args[0] === 'string' && args.length === 1 &&
          !path.relative(defaultFolder, args[0]) &&
          framesMatch(new Error().stack, ['at ni (', 'at Hi (', '.setupPanel (', '.createPanel ('])) {
        redirected = true;
        fs.realpathSync = original;
        return folder;
      }
      return Reflect.apply(fn, receiver, args);
    }
  });

  const weakSet = WeakMap.prototype.set;
  const capture = new Proxy(weakSet, {
    apply(fn, receiver, args) {
      const result = Reflect.apply(fn, receiver, args);
      if (scope.getStore() === token && typeof args[1] === 'boolean' &&
          framesMatch(new Error().stack, ['.setupPanel (', '.createPanel (']) && isPanel(args[0])) {
        capturedPanel = args[0];
        WeakMap.prototype.set = weakSet;
        observePanel(capturedPanel);
      }
      return result;
    }
  });
  const mapGet = Map.prototype.get;
  const findExistingPanel = new Proxy(mapGet, {
    apply(fn, receiver, args) {
      const result = Reflect.apply(fn, receiver, args);
      if (scope.getStore() === token && args[0] === sessionId &&
          framesMatch(new Error().stack, ['.createPanel (']) && isPanel(result)) {
        existingPanel = result;
        Map.prototype.get = mapGet;
      }
      return result;
    }
  });
  if (defaultFolder) fs.realpathSync = redirect;
  WeakMap.prototype.set = capture;
  if (sessionId) Map.prototype.get = findExistingPanel;
  try {
    await scope.run(token, open);
    return { redirected, existingPanel, capturedPanel };
  } finally {
    if (fs.realpathSync === redirect) fs.realpathSync = original;
    if (WeakMap.prototype.set === capture) WeakMap.prototype.set = weakSet;
    if (Map.prototype.get === findExistingPanel) Map.prototype.get = mapGet;
    scope.disable();
  }
}

module.exports = { openOfficialClaude, unavailable, watchOfficialClaudeRestores };
