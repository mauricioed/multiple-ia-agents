'use strict';const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const cli=require('../src/agent-cli');
  test('executables are resolved from the user installation, never bundled packages',async t=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'external-agents-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const native=path.join(root,process.platform==='win32'?'codex.exe':'codex');await fs.writeFile(native,'test fixture');
    assert.deepEqual(await cli.resolveCli('codex','',[root]),{shellPath:native,shellArgs:[]});
    assert.equal((await cli.resolveCli('ollama',native,[])).shellPath,native);
    await assert.rejects(cli.resolveCli('codex','',[]),/Instalalo por separado/);
    await assert.rejects(cli.resolveCli('claude',native,[root]),/Agente no disponible/);
    assert.equal(cli.bundledInvocation,undefined);
  });
  test('executable settings reject relative paths and shell wrappers',async t=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'agent-settings-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    await assert.rejects(cli.resolveCli('codex','relative.exe',[]),/ruta absoluta/);
    const wrapper=path.join(root,'agent.cmd');await fs.writeFile(wrapper,'echo test');
    await assert.rejects(cli.resolveCli('codex',wrapper,[]),/script de shell/);
  });

test('Claude terminal invocation runs the separately installed executable without changing graphical chat resolution',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'claude-terminal-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const native=path.join(root,process.platform==='win32'?'claude.exe':'claude');await fs.writeFile(native,'test fixture');
  const invocation=await cli.agentInvocation({provider:'claude',mode:'terminal',permission:'ask'},native);
  assert.equal(invocation.shellPath,native);assert.deepEqual(invocation.shellArgs,[]);
  await assert.rejects(cli.resolveCli('claude',native,[root]),/Agente no disponible/);
});

test('Claude terminals detect global npm native and JavaScript entries without running shell wrappers',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'claude-global-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const packageRoot=path.join(root,'node_modules','@anthropic-ai','claude-code');await fs.mkdir(path.join(packageRoot,'bin'),{recursive:true});
  const binary=process.platform==='win32'?'bin/claude.exe':'bin/claude';
  await fs.writeFile(path.join(packageRoot,binary),'test fixture');await fs.writeFile(path.join(packageRoot,'package.json'),JSON.stringify({bin:{claude:binary}}));
  assert.deepEqual(await cli.resolveCli('claude','',[root],true),{shellPath:path.join(packageRoot,binary),shellArgs:[]});
  const node=path.join(root,process.platform==='win32'?'node.exe':'node');await fs.writeFile(node,'test fixture');
  await fs.writeFile(path.join(packageRoot,'cli.js'),'test fixture');await fs.writeFile(path.join(packageRoot,'package.json'),JSON.stringify({bin:{claude:'cli.js'}}));
  assert.deepEqual(await cli.resolveCli('claude','',[root],true),{shellPath:node,shellArgs:[path.join(packageRoot,'cli.js')]});
  for(const entry of ['../outside.exe','bin/claude.cmd']){
    await fs.writeFile(path.join(packageRoot,entry),'test fixture');await fs.writeFile(path.join(packageRoot,'package.json'),JSON.stringify({bin:{claude:entry}}));
    await assert.rejects(cli.resolveCli('claude','',[root],true),/Instalalo por separado/);
  }
  await assert.rejects(cli.resolveCli('claude','',[root]),/Agente no disponible/);
});

test('Claude falls back to the binary shipped by the official extension only when no other installation exists',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'claude-official-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const official=path.join(root,'official',process.platform==='win32'?'claude.exe':'claude');
  await fs.mkdir(path.dirname(official));await fs.writeFile(official,'test fixture');
  assert.deepEqual(await cli.resolveCli('claude','',[root],true,official),{shellPath:official,shellArgs:[]});
  await assert.rejects(cli.resolveCli('claude','',[root],true,'relative/claude.exe'),/Instalalo por separado/);
  const installed=path.join(root,process.platform==='win32'?'claude.exe':'claude');await fs.writeFile(installed,'test fixture');
  assert.equal((await cli.resolveCli('claude','',[root],true,official)).shellPath,installed);
});
