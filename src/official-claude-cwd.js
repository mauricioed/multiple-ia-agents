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

async function openOfficialClaudeInFolder(extension, defaultFolder, folder, open) {
  if (process.platform !== 'win32' || process.arch !== 'x64' ||
      extension.packageJSON?.version !== supportedVersion || extension.packageJSON.main !== './extension.js') {
    throw unavailable();
  }
  const file = await fs.promises.realpath(path.join(extension.extensionPath, extension.packageJSON.main));
  const source = await fs.promises.readFile(file);
  if (createHash('sha256').update(source).digest('hex') !== supportedEntryHash) throw unavailable();

  // Limit the redirect to the verified Claude panel constructor in this one
  // command. Trust, permissions and all other path lookups use the original fs.
  const scope = new AsyncLocalStorage();
  const token = {};
  const original = fs.realpathSync;
  const normalize = value => value.replace(/\\/gu, '/').toLowerCase();
  const location = normalize(file) + ':';
  let redirected = false;
  const redirect = new Proxy(original, {
    apply(fn, receiver, args) {
      if (scope.getStore() === token && typeof args[0] === 'string' && args.length === 1 &&
          !path.relative(defaultFolder, args[0])) {
        const frames = String(new Error().stack).split('\n').slice(2, 6);
        const expected = ['at ni (', 'at Hi (', '.setupPanel (', '.createPanel ('];
        if (frames.length === expected.length && frames.every((frame, index) =>
          frame.includes(expected[index]) && normalize(frame).includes(location))) {
          redirected = true;
          fs.realpathSync = original;
          return folder;
        }
      }
      return Reflect.apply(fn, receiver, args);
    }
  });
  fs.realpathSync = redirect;
  try {
    await scope.run(token, open);
    return redirected;
  } finally {
    if (fs.realpathSync === redirect) fs.realpathSync = original;
    scope.disable();
  }
}

module.exports = { openOfficialClaudeInFolder, unavailable };
