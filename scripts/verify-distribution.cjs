'use strict';
  const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
  const root=path.resolve(__dirname,'..');const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  if(pkg.name!=='multiple-ia-agents')throw new Error('Wrong project identity');
  if(JSON.stringify(pkg.dependencies)!==JSON.stringify({'markdown-it':'14.3.3'}))throw new Error('Runtime dependencies changed; review the new licenses before packaging');
  if(!pkg.extensionDependencies.includes('anthropic.claude-code'))throw new Error('Official Claude extension dependency missing');
  const native=/\.(exe|dll|node|so|dylib|bin|zip|gguf|safetensors)$/i;
  function walk(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){
    const target=path.join(directory,item.name);if(item.isDirectory())walk(target);else if(native.test(item.name))throw new Error('Unexpected binary in first-party sources');
  }}
  for(const name of ['src','media','licenses'])walk(path.join(root,name));
  for(const file of fs.readdirSync(path.join(root,'src')).filter(file=>file.endsWith('.js'))){
    const source=fs.readFileSync(path.join(root,'src',file),'utf8');
    if(/usage_EXPERIMENTAL|account\/rateLimits\/read|(?:require\(|import\(|from )['"]@anthropic-ai|claude-login|claude-usage/.test(source))throw new Error('Prohibited native Claude or quota integration: '+file);
  }
  const inventory=JSON.parse(fs.readFileSync(path.join(root,'DEPENDENCY-LICENSES.json'),'utf8'));
  const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
  const runtimeCount=Object.entries(lock.packages).filter(([name,meta])=>name&&name.startsWith('node_modules/')&&!meta.dev).length;
  if(inventory.packages.length!==runtimeCount)throw new Error('Runtime license inventory is stale');
  for(const entry of inventory.packages)for(const license of entry.files){
    const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,license.path))).digest('hex');
    if(hash!==license.sha256)throw new Error('Changed or missing license notice: '+license.path);
  }
  console.log('Distribution checks passed: no native binaries, no custom Claude SDK, no quota readers, complete runtime license inventory.');
