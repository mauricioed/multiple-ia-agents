'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');

async function testComposer(browser, project, language, provider) {
  const media = path.join(project, 'media');
  const page = await browser.newPage({ viewport: { width: 720, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const css = (await Promise.all(['chat.css', 'controls.css'].map(file => fs.readFile(path.join(media, file), 'utf8')))).join('\n');
    await page.setContent(`<!doctype html><html lang="${language}"><head><style>
      :root { --vscode-font-family: sans-serif; --vscode-font-size: 13px; --vscode-panel-border:#ccc; --vscode-editorWidget-background:white; }
      ${css}</style></head><body><div id="app"></div></body></html>`);
    await page.evaluate(() => {
      window.sent = [];
      window.acquireVsCodeApi = () => ({
        getState: () => ({ draft: 'Saved draft' }),
        setState(state) { window.savedDraft = state; },
        postMessage(message) {
          window.sent.push(message);
          if (message.requestId) window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'reply', requestId: message.requestId, result: true }
          }));
        }
      });
    });
    for (const file of ['i18n.js', 'icons.js', 'composer-editor.js', 'chat.js']) {
      await page.addScriptTag({ content: await fs.readFile(path.join(media, file), 'utf8') });
    }
    await page.evaluate(provider => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'chat', session: { id: 'test', provider, root: 'C:/project', model: 'test-vision' },
        messages: [], approvals: [], sessions: [], contextHistory: [] }
    })), provider);
    const spanish = language === 'es';
    const editor = page.getByRole('textbox', { name: spanish ? 'Mensaje para el agente' : 'Message for the agent' });
    assert.equal(await editor.textContent(), 'Saved draft');
    const formatting = page.getByRole('group', { name: spanish ? 'Formato del mensaje' : 'Message formatting' });
    const toggle = page.locator('footer .format-toggle');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.ok((await formatting.boundingBox()).y < (await page.locator('.conversation').boundingBox()).y);
    assert.ok(await formatting.locator('button svg').count() >= 10);
    await toggle.click();
    assert.equal(await formatting.isVisible(), false);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => window.savedDraft.formatVisible), false);
    await toggle.click();
    assert.equal(await formatting.isVisible(), true);
    assert.equal(await page.evaluate(() => window.savedDraft.formatVisible), true);
    await editor.focus();
    await page.keyboard.press('Control+a');
    await editor.evaluate(async node => {
      const data = new DataTransfer();
      data.setData('text/plain', 'Pasted <text>\nsecond line');
      data.setData('text/html', '<img src="https://invalid.example" onerror="alert(1)">');
      const canvas = document.createElement('canvas');
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      data.items.add(new File([blob], 'clipboard.png', { type: 'image/png' }));
      node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const preview = page.locator('.attachments img');
    await preview.waitFor();
    assert.equal(await editor.locator('img').count(), 0);
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: spanish ? 'Negrita' : 'Bold', exact: true }).click();
    assert.ok(await editor.locator('b,strong').count());
    await page.keyboard.press('Enter');
    const first = await page.evaluate(() => window.sent.filter(message => message.action === 'send').at(-1));
    assert.match(first.text, /\*\*Pasted <text>\*\*\n\*\*second line\*\*/);
    assert.equal(first.pastedImages[0].mime, 'image/png');
    assert.match(first.pastedImages[0].data, /^iVBOR/);
    assert.match(first.formatted, /<b>/);

    const more = page.getByLabel(spanish ? 'Más opciones de formato' : 'More formatting options');
    await more.click();
    assert.ok((await page.locator('.format-menu').boundingBox()).y >= (await formatting.boundingBox()).y);
    await page.getByRole('button', { name: spanish ? 'Insertar tabla' : 'Insert table', exact: true }).click();
    assert.equal(await editor.locator('table tr').count(), 2);
    await editor.locator('td').first().click();
    await page.keyboard.type('cell');
    await more.click();
    await page.getByRole('button', { name: spanish ? 'Insertar columna' : 'Insert column', exact: true }).click();
    assert.equal(await editor.locator('table tr').first().locator('th,td').count(), 3);
    await more.click();
    await page.getByRole('button', { name: spanish ? 'Deshacer' : 'Undo', exact: true }).click();
    assert.equal(await editor.locator('table tr').first().locator('th,td').count(), 2);
    await more.click();
    await page.getByRole('button', { name: spanish ? 'Rehacer' : 'Redo', exact: true }).click();
    assert.equal(await editor.locator('table tr').first().locator('th,td').count(), 3);
    await page.setViewportSize({ width: 360, height: 650 });
    await more.click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`Composer verified in ${language} with ${provider}: clipboard, formatting, tables, undo and redo.`);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const project = path.resolve(process.argv[2] || path.join(__dirname, '..'));
    await testComposer(browser, project, 'es', 'codex');
    await testComposer(browser, project, 'en', process.argv[3] || 'ollama');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
