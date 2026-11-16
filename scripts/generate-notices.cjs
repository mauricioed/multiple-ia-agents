'use strict';
  const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
  const root=path.resolve(__dirname,'..');const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
  const allowed=new Set(['MIT','BSD-2-Clause','BSD-3-Clause','ISC','Apache-2.0','Python-2.0','0BSD']);
  if(!lock.packages || !lock.packages[''] || !Object.keys(lock.packages).some(name=>name.startsWith('node_modules/'))) throw new Error('Invalid dependency lockfile; refusing to generate incomplete notices');
  const entries=[];fs.mkdirSync(path.join(root,'licenses'),{recursive:true});
  for(const[location,meta]of Object.entries(lock.packages||{})){
    if(!location||meta.dev||!location.startsWith('node_modules/'))continue;
    const directory=path.join(root,location);const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
    if(!allowed.has(pkg.license))throw new Error('Unreviewed runtime license: '+pkg.name+' '+pkg.license);
    const licenseFiles=fs.readdirSync(directory).filter(name=>/^licen[sc]e(?:[.-]|$)/i.test(name));
    if(!licenseFiles.length)throw new Error('Missing license text: '+pkg.name);
    const files=[];
    for(const filename of licenseFiles){
      if(!fs.statSync(path.join(directory,filename)).isFile())continue;
      const output='licenses/'+pkg.name.replaceAll('/','__')+'-'+pkg.version+'-'+filename;
      const text=fs.readFileSync(path.join(directory,filename));fs.writeFileSync(path.join(root,output),text);
      files.push({path:output,sha256:crypto.createHash('sha256').update(text).digest('hex')});
    }
    for(const filename of fs.readdirSync(directory).filter(name=>/^notice(?:\.|$)/i.test(name))){
      if(fs.statSync(path.join(directory,filename)).isFile()){
        const output='licenses/'+pkg.name.replaceAll('/','__')+'-'+pkg.version+'-'+filename;
        fs.copyFileSync(path.join(directory,filename),path.join(root,output));
        files.push({path:output,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,output))).digest('hex')});
      }
    }
    if(!files.length)throw new Error('No usable license text: '+pkg.name);
    entries.push({name:pkg.name,version:pkg.version,license:pkg.license,files});
  }
  entries.sort((a,b)=>a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(root,'DEPENDENCY-LICENSES.json'),JSON.stringify({scope:'runtime dependencies actually redistributed',packages:entries},null,2)+'\n');
  const rows=entries.map(entry=>'| '+entry.name+' | '+entry.version+' | '+entry.license+' |').join('\n');
  fs.writeFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),'# Third-party notices\n\nThe project code is MIT licensed; its original copyright notice is retained in LICENSE.\nThe unmodified runtime dependency license texts and notices are preserved in licenses/.\n\n| Package | Version | Declared license |\n| --- | --- | --- |\n'+rows+'\n\nCodex, Ollama, model weights, Claude Code and the official Anthropic extension are NOT bundled or redistributed. Users install them separately under their own terms. Provider names identify integrations; this project is not endorsed by OpenAI, Anthropic or Ollama.\n\nDevelopment tools are installed separately for building and testing; their code is not shipped in the VSIX. DEPENDENCY-LICENSES.json records the runtime scope and SHA256 hashes of the preserved license texts.\n');
  console.log('Preserved licenses for '+entries.length+' redistributed runtime packages.');
