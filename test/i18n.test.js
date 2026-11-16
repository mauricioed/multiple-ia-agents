'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const catalog = require('../media/i18n');
test('Spanish locales use Spanish; English and unsupported locales use English', () => {
  for (const locale of ['es', 'es-ES', 'es-MX', 'ES_es']) {
    assert.equal(catalog.language(locale), 'es');
    assert.equal(catalog.translator(locale)('Enviar mensaje'), 'Enviar mensaje');
  }
  for (const locale of ['en', 'en-US', 'de', 'fr', undefined]) {
    assert.equal(catalog.language(locale), 'en');
    assert.equal(catalog.translator(locale)('Enviar mensaje'), 'Send message');
  }
  assert.equal(catalog.translator('es')('Quitar {0}', 'my-file.md'), 'Quitar my-file.md');
});
test('host translation reads the VS Code language without affecting stored content', () => {
  const source = fs.readFileSync(require.resolve('../src/i18n'), 'utf8');
  for (const locale of ['es', 'en', 'fr']) {
    const context = {module:{exports:{}}, require:name=>name==='vscode'?{env:{language:locale}}:catalog};
    vm.runInNewContext(source, context);
    assert.equal(context.module.exports.language, locale === 'es' ? 'es' : 'en');
    assert.equal(context.module.exports.t('custom-user-title'), 'custom-user-title');
  }
});
test('all manifest translation references exist in both language catalogs', () => {
  const manifest = fs.readFileSync(require.resolve('../package.json'), 'utf8');
  const english = require('../package.nls.json'); const spanish = require('../package.nls.es.json');
  for (const [,key] of manifest.matchAll(/%([^%]+)%/g)) {
    assert.ok(english[key], key); assert.ok(spanish[key], key);
  }
  for (const [key,value] of Object.entries(catalog.en)) {
    const slots = text => [...text.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();
    assert.deepEqual(slots(key), slots(value), key);
  }
});
