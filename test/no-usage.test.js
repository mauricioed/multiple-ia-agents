'use strict';const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {CodexBackend,backend}=require('../src/backends');
  test('Codex has no quota-reading method and unsolicited account limits are not forwarded',()=>{
    const events=[];const agent=new CodexBackend({root:'.',backendId:'thread'},'',event=>events.push(event));
    assert.equal(agent.refreshUsage,undefined);agent.message({method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:99}}}});
    agent.message({method:'thread/tokenUsage/updated',params:{threadId:'thread',tokenUsage:{last:{totalTokens:100}}}});
    assert.deepEqual(events,[]);agent.dispose();
  });
  test('Claude cannot be run through a custom SDK backend',()=>{assert.throws(()=>backend({provider:'claude'},'',()=>{},()=>{},()=>{}),/Agente/);});
  test('own UI contains no progress widget or usage view for provider utilization',()=>{
    const media=path.resolve(__dirname,'..','media');const chat=fs.readFileSync(path.join(media,'chat.js'),'utf8');
    assert.doesNotMatch(chat,/quotaRow|contextMeter|usedPercent|state\.rateLimits/);
    assert.equal(fs.existsSync(path.join(media,'weekly-usage.js')),false);
    const src=path.resolve(__dirname,'..','src');for(const name of fs.readdirSync(src).filter(name=>name.endsWith('.js')))assert.doesNotMatch(fs.readFileSync(path.join(src,name),'utf8'),/usage_EXPERIMENTAL|account\/rateLimits\/read|(?:require\(|import\(|from )['"]@anthropic-ai/);
  });
