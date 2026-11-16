'use strict';
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const { chromium } = require(root + '/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html lang="es"><body><nav id="chats"></nav><details open><summary id="files-title">Archivos</summary><nav id="files"></nav></details><p id="sidebar-notice"></p></body></html>');
    await page.evaluate(() => {
      window.sent = [];
      window.acquireVsCodeApi = () => ({ postMessage(message) {
        sent.push(message);
        const deliver = data => setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data })), 0);
        if (message.type === 'ready') deliver({type:'sidebar',activeId:'one',activeName:'Codex',activeRoot:'C:/project',sessions:[{id:'one',name:'Codex',root:'C:/project'}]});
        if (message.action === 'list') {
          const parent = message.parent;
          const result = !parent ? [{root:true,directory:true,rootPath:'C:/project',segments:[],sessionId:'one'}] : parent.segments.length === 0 ? [{name:'src',directory:true,rootPath:'C:/project',segments:['src'],sessionId:'one'}] : [{name:'index.js',rootPath:'C:/project',segments:['src','index.js'],sessionId:'one'}];
          deliver({type:'sidebarReply',requestId:message.requestId,result});
        }
      }});
    });
    for (const file of ['i18n.js','icons.js','sidebar.js']) await page.addScriptTag({content:await fs.readFile(root + '/media/' + file,'utf8')});
    await page.locator('#chats .chat-select').waitFor();
    await page.locator('#files summary').filter({hasText:'src'}).click();
    await page.locator('#files .file-row').filter({hasText:'index.js'}).waitFor();
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => sent.filter(item => item.type === 'ready').length),1);
    console.log('Sidebar browser regression passed: ready handshake, chat, root folder, nested folder and file rendered without JavaScript errors.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
