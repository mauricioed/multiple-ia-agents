'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const { t } = require('./i18n');

const supportedVersion = '2.1.331';
const supportedEntryHash = '9dead0c8f6970cb4120bd002ee1eb2b10d025677941e4fc19c7162c67f3f25fa';

function unavailable() {
  return new Error(t('Esta versión de Claude Code no admite abrir otra carpeta en una pestaña nativa de esta ventana.'));
}

async function verifiedEntry(extension) {
  if (process.platform !== 'win32' || process.arch !== 'x64' ||
      extension.packageJSON?.version !== supportedVersion || extension.packageJSON.main !== './extension.js') {
    return undefined;
  }
  const file = await fs.promises.realpath(path.join(extension.extensionPath, extension.packageJSON.main));
  const source = await fs.promises.readFile(file);
  return createHash('sha256').update(source).digest('hex') === supportedEntryHash ? file : undefined;
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
  const normalize = value => value.replace(/\\/gu, '/').toLowerCase();
  const location = normalize(file) + ':';
  const framesMatch = (stack, names) => {
    const frames = String(stack).split('\n').slice(2, 2 + names.length);
    return frames.length === names.length && frames.every((frame, index) =>
      frame.includes(names[index]) && normalize(frame).includes(location));
  };
  const isPanel = value => typeof value?.webview?.onDidReceiveMessage === 'function' &&
    typeof value.onDidDispose === 'function';
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

module.exports = { openOfficialClaude, unavailable };
