'use strict';
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
// Reuse the current distribution scanner's credential signatures, so the
// history and working-tree checks cannot silently drift apart.
const source=fs.readFileSync(path.join(__dirname,'verify-privacy.cjs'),'utf8');
const expression=source.match(/const patterns=(\[[\s\S]*?\]);/);
if(!expression)throw Error('Credential signatures not found');
const patterns=vm.runInNewContext(expression[1],{}, {timeout:1000});
const commits=git('rev-list','--all').toString().trim().split(/\s+/).filter(Boolean);
const checked=new Set();const failures=[];let paths=0;
for(const commit of commits){
  const entries=git('ls-tree','-rz','--full-tree',commit).toString().split('\0').filter(Boolean);
  for(const entry of entries){
    const match=entry.match(/^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/);if(!match){failures.push(commit.slice(0,8)+': unexpected tree entry');continue;}
    const [,mode,oid,name]=match;paths++;
    if(mode==='120000'||/(?:^|\/)(?:\.env(?:\..*)?|\.aws|\.codex|\.claude|auth\.json|credentials(?:\.json)?|sessions\.json|node_modules|artifacts|\.test-[^/]*)($|\/)|\.(?:pem|key|pfx|p12|vsix|exe|dll|gguf|safetensors|sqlite)$/i.test(name))failures.push(commit.slice(0,8)+' '+name+': private or distribution-only path');
    const identity=oid+' '+name;if(checked.has(identity))continue;checked.add(identity);
    const bytes=git('cat-file','blob',oid);const text=bytes.toString('utf8');
    if(bytes.includes(0)||patterns.some(pattern=>pattern.test(text)))failures.push(commit.slice(0,8)+' '+name+': binary or recognized credential');
    if(/C:[\\/]+Users[\\/]+[A-Za-z0-9_.-]+/i.test(text))failures.push(commit.slice(0,8)+' '+name+': private machine path');
    if(!name.startsWith('licenses/')&&/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text))failures.push(commit.slice(0,8)+' '+name+': contact data outside attribution');
  }
  const metadata=git('show','-s','--format=%B%n%ae%n%ce',commit).toString();
  if(patterns.some(pattern=>pattern.test(metadata)))failures.push(commit.slice(0,8)+': credential in commit metadata');
  for(const email of metadata.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[])if(!email.endsWith('@users.noreply.github.com'))failures.push(commit.slice(0,8)+': non-noreply contact in metadata');
}
if(failures.length){console.error([...new Set(failures)].join('\n'));process.exitCode=1;}
else console.log(`Git history scan passed: ${commits.length} reachable commits, ${checked.size} unique blob/path pairs, ${paths} tree entries; no recognized secrets or private paths. Pattern scanning is not an absolute guarantee.`);
