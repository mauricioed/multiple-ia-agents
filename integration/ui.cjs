'use strict';const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');const {chromium}=require('playwright-core');
  (async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
    const page=await browser.newPage({viewport:{width:780,height:820}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const media=path.resolve(__dirname,'..','media');const read=name=>fs.readFile(path.join(media,name),'utf8');
    const css=(await Promise.all(['chat.css','controls.css'].map(read))).join('\n');
    await page.setContent('<html lang="es"><head><style>:root{--vscode-font-family:Segoe UI,Arial,sans-serif;--vscode-font-size:13px;--vscode-foreground:#30333b;--vscode-editor-background:#f9fafc;--vscode-input-background:#ffffff;--vscode-descriptionForeground:#606975;--vscode-panel-border:#dde1e8;--vscode-editorWidget-background:#f0f2f7;--vscode-focusBorder:#546ea1;}'+css+'</style></head><body><div id="app"></div></body></html>');
    await page.evaluate(()=>{window.sent=[];window.acquireVsCodeApi=()=>({getState:()=>({}),setState(){},postMessage(message){window.sent.push(message);if(message.action==='models')window.dispatchEvent(new MessageEvent('message',{data:{type:'reply',requestId:message.requestId,result:[{label:'Modelo de prueba',value:'test'}]}}));}});});
    for(const name of ['i18n.js','icons.js','chat.js'])await page.addScriptTag({content:await read(name)});
    const state={type:'chat',session:{id:'test',provider:'codex',root:'C:/project',name:'Codex',permission:'ask'},running:false,messages:[{id:'one',role:'user',text:'Mensaje de prueba'},{id:'two',role:'assistant',text:'Respuesta de prueba',html:'<p>Respuesta de prueba</p>'}],approvals:[],sessions:[],rateLimits:{primary:{usedPercent:99}}};
    await page.evaluate(state=>window.dispatchEvent(new MessageEvent('message',{data:state})),state);
    assert.equal(await page.getByRole('progressbar').count(),0);assert.equal(await page.locator('.session-usage-row,.token-meter,#usage').count(),0);
    assert.equal(await page.getByRole('button',{name:/API/}).count(),0);assert.equal(await page.locator('.message').count(),2);
    const out=path.resolve('.test-ui');await fs.mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'codex-without-usage.png')});
    await page.setViewportSize({width:360,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'codex-narrow.png')});
    assert.deepEqual(errors,[]);console.log('UI verified: custom Codex chat renders without utilization gauges, API-key controls or horizontal overflow.');
  }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
