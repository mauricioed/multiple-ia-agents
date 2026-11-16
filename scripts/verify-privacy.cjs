'use strict';const fs=require('node:fs');const path=require('node:path');
  const root=path.resolve(__dirname,'..');const ignored=new Set(['.git','node_modules','artifacts','dist']);
  const forbiddenNames=/^(?:\.env(?:\..*)?|\.aws|\.codex|\.claude|\.npmrc\.private|credentials(?:\.json)?|auth\.json|sessions\.json)$/i;
  const binaries=/\.(?:exe|dll|node|so|dylib|vsix|gguf|safetensors|pem|key|pfx|p12|db|sqlite)$/i;
  const patterns=[/sk-ant-api\d+-[A-Za-z0-9_-]{20,}/,/sk-proj-[A-Za-z0-9_-]{20,}/,/\bsk-[A-Za-z0-9]{32,}/,/\bgh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{30,}/,/\bAKIA[0-9A-Z]{16}\b/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/];
  let files=0;const failures=[];
  function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(ignored.has(entry.name)||entry.name.startsWith('.test-')||entry.name==='.project-created.json')continue;
    const target=path.join(directory,entry.name);const relative=path.relative(root,target).split(path.sep).join('/');
    if(forbiddenNames.test(entry.name)||binaries.test(entry.name)){failures.push(relative+': unexpected private or binary path');continue;}
    if(entry.isSymbolicLink()){failures.push(relative+': unexpected symlink');continue;}
    if(entry.isDirectory()){walk(target);continue;}
    const bytes=fs.readFileSync(target);if(bytes.includes(0)){failures.push(relative+': unexpected binary content');continue;}
    const text=bytes.toString('utf8');if(patterns.some(pattern=>pattern.test(text)))failures.push(relative+': possible credential pattern');
    if (/C:[\\/]+Users[\\/]+[A-Za-z0-9_.-]+/i.test(text)) failures.push(relative+": private machine path");
    if (!relative.startsWith("licenses/") && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) failures.push(relative+": personal contact data in source");
    if(entry.name==='package-lock.json'&&/file:|localhost:|127\.0\.0\.1:/.test(text))failures.push(relative+': non-public dependency source');
    files++;
  }}
  walk(root);if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Privacy scan passed for '+files+' source/notice files: no recognized credentials, profiles, histories, private-machine data or binaries. Pattern scans are not a guarantee against every possible secret.');
