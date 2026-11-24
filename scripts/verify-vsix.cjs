'use strict';const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const yauzl=require('yauzl');
  async function verify(file){
    const root=path.resolve(__dirname,'..');const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));const inventory=JSON.parse(fs.readFileSync(path.join(root,'DEPENDENCY-LICENSES.json'),'utf8'));
    const allowedPackages=new Set(inventory.packages.map(entry=>entry.name));const licenseHashes=new Map(inventory.packages.flatMap(entry=>entry.files).map(entry=>['extension/'+entry.path,entry.sha256]));
    const required=new Set(['extension/package.json','extension/LICENSE.txt','extension/THIRD_PARTY_NOTICES.md','extension/DEPENDENCY-LICENSES.json','extension/LICENSE_REVIEW.md','extension/PRIVACY.md',...licenseHashes.keys()]);
    let total=0;let contentSize=0;
    await new Promise((resolve,reject)=>{yauzl.open(file,{lazyEntries:true},(error,zip)=>{
      if(error)return reject(error);const fail=error=>{zip.close();reject(error);};
      zip.on('error',fail);zip.on('entry',entry=>{(async()=>{
        const name=entry.fileName;total++;contentSize+=entry.uncompressedSize;
        if(/(^|\/)\.test-[^/]*(\/|$)|(^|\/)(\.git|\.aws|\.codex|\.claude|artifacts|test|integration|scripts)(\/|$)|(^|\/)\.env(?:\.|$)|(^|\/)(\.npmrc|\.project-created\.json)$|\.\.(\/|$)/i.test(name))throw new Error('Private, generated or development path in VSIX: '+name);
        if(/\.(exe|dll|node|so|dylib|bin|gguf|safetensors|vsix|pem|key|pfx|p12|db|sqlite)$/i.test(name))throw new Error('Unexpected binary or private file in VSIX: '+name);
        const dependency=name.match(/^extension\/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1];if(dependency&&!allowedPackages.has(dependency))throw new Error('Unreviewed package in VSIX: '+dependency);
        if(entry.uncompressedSize>5*1024*1024)throw new Error('Unexpected large file in VSIX: '+name);
        required.delete(name);if(name.endsWith('/')){zip.readEntry();return;}
        const bytes=await new Promise((res,rej)=>zip.openReadStream(entry,(err,stream)=>{if(err)return rej(err);const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('error',rej);stream.on('end',()=>res(Buffer.concat(chunks)));}));
        const text=bytes.toString('utf8');
        if(/sk-ant-api\d+-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))throw new Error('Possible credential in VSIX entry: '+name);
        if(licenseHashes.has(name)&&crypto.createHash('sha256').update(bytes).digest('hex')!==licenseHashes.get(name))throw new Error('License text mismatch in VSIX: '+name);
        if(name.startsWith('extension/src/')||name.startsWith('extension/media/')){
          const local=fs.readFileSync(path.join(root,name.slice('extension/'.length)));if(!local.equals(bytes))throw new Error('Stale packaged source: '+name);
          if(/C:[\\/]+Users[\\/]+[A-Za-z0-9_.-]+/i.test(text))throw new Error('Private machine path in VSIX source: '+name);
        }
        if(name==='extension/package.json'){const manifest=JSON.parse(text);if(manifest.name!==pkg.name||manifest.version!==pkg.version||!manifest.extensionPack?.includes('anthropic.claude-code'))throw new Error('Wrong packaged identity or missing Claude extension pack entry');}
        zip.readEntry();
      })().catch(fail);});
      zip.on('end',()=>{if(required.size)return reject(new Error('Missing legal or manifest entries: '+[...required].join(', ')));resolve();});zip.readEntry();
    });});
    console.log('VSIX verified: '+total+' entries, '+Math.round(contentSize/1024)+' KB uncompressed; no private/test profiles, native binaries, unreviewed packages or recognized credentials; license hashes and packaged sources match.');
  }
  module.exports={verify};if(require.main===module)verify(path.resolve(process.argv[2])).catch(error=>{console.error(error.message);process.exitCode=1;});
