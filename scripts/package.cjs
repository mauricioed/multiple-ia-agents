'use strict';const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');
  (async()=>{
    const root=path.resolve(__dirname,'..');const pkg=require('../package.json');const args=process.argv.slice(2);const outIndex=args.indexOf('--out');
    const output=path.resolve(root,outIndex>=0?args[outIndex+1]:'artifacts/'+pkg.name+'-'+pkg.version+'.vsix');
    if(!output.startsWith(root+path.sep)||!output.endsWith('.vsix'))throw new Error('Build output must be a VSIX inside this project');
    for(const script of ['generate-notices.cjs','verify-distribution.cjs','verify-privacy.cjs'])cp.execFileSync(process.execPath,[path.join(__dirname,script)],{cwd:root,stdio:'inherit',windowsHide:true});
    fs.mkdirSync(path.dirname(output),{recursive:true});
    cp.execFileSync(process.execPath,[path.join(root,'node_modules','@vscode','vsce','vsce'),'package','--out',output],{cwd:root,stdio:'inherit',windowsHide:true});
    try{await require('./verify-vsix.cjs').verify(output);}catch(error){fs.rmSync(output,{force:true});throw error;}
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
