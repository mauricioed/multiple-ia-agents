'use strict';
  const {t}=require('./i18n');
  const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
  const {permissionArguments}=require('./permissions');
  const AGENTS={codex:{label:'Codex'},claude:{label:'Claude'},ollama:{label:'Ollama'},terminal:{label:t('Terminal libre')}};
  async function isFile(file){try{return(await fs.stat(file)).isFile();}catch{return false;}}
  function directories(env=process.env){
    const entries=(env.PATH||env.Path||'').split(path.delimiter).filter(Boolean);
    entries.push(path.join(os.homedir(),'.local','bin'));
    if(env.APPDATA)entries.push(path.join(env.APPDATA,'npm'));
    if(env.LOCALAPPDATA)entries.push(path.join(env.LOCALAPPDATA,'Programs','Ollama'));
    return[...new Set(entries.map(entry=>entry.replace(/^"|"$/gu,'')))];
  }
  async function executable(name,dirs=directories()){
    for(const directory of dirs)for(const suffix of process.platform==='win32'?['.exe','.com']:['']){
      const file=path.join(directory,name+suffix);if(await isFile(file))return file;
    }
  }
  async function resolveCli(provider,configured='',dirs=directories(),terminalMode=false,fallback){
    if(!['codex','ollama'].includes(provider)&&!(terminalMode&&provider==='claude'))throw new Error(t('Agente no disponible.'));
    if(configured){
      if(!path.isAbsolute(configured)||!await isFile(configured))throw new Error(t('Configura una ruta absoluta a un ejecutable instalado.'));
      if(/\.(cmd|bat|ps1)$/iu.test(configured))throw new Error(t('Selecciona el ejecutable nativo o la entrada JavaScript, no un script de shell.'));
      if(/\.[cm]?js$/iu.test(configured)){
        const node=await executable('node',dirs);if(!node)throw new Error(t('Instala Node.js para ejecutar esta entrada JavaScript.'));
        return{shellPath:node,shellArgs:[configured]};
      }
      return{shellPath:configured,shellArgs:[]};
    }
    const binary=await executable(provider,dirs);if(binary)return{shellPath:binary,shellArgs:[]};
    if(provider==='claude'&&terminalMode)for(const directory of dirs){
      const packageRoot=path.join(directory,'node_modules','@anthropic-ai','claude-code');
      let meta;
      try { meta=JSON.parse(await fs.readFile(path.join(packageRoot,'package.json'),'utf8')); }
      catch(error) { if(error.code==='ENOENT')continue; throw error; }
      const bin=typeof meta.bin==='string'?meta.bin:meta.bin?.claude;
      if(typeof bin!=='string'||path.isAbsolute(bin))continue;
      const entry=path.resolve(packageRoot,bin),relative=path.relative(packageRoot,entry);
      if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!await isFile(entry))continue;
      if(/\.[cm]?js$/iu.test(entry)){
        const node=await executable('node',dirs);if(node)return{shellPath:node,shellArgs:[entry]};
      } else if(process.platform==='win32'?/\.(exe|com)$/iu.test(entry):!path.extname(entry))return{shellPath:entry,shellArgs:[]};
    }
    // Unmodified Claude Code binary shipped by the official VS Code extension.
    if(provider==='claude'&&fallback&&path.isAbsolute(fallback)&&await isFile(fallback))return{shellPath:fallback,shellArgs:[]};
    if(provider==='codex')for(const directory of dirs){
      const entry=path.join(directory,'node_modules','@openai','codex','bin','codex.js');
      const node=await executable('node',dirs);if(node&&await isFile(entry))return{shellPath:node,shellArgs:[entry]};
    }
    throw new Error(t('No se encontro {0}. Instalalo por separado o configura su ruta en Multiple IA Agents.',provider));
  }
async function ollamaEndpoint(configured = '') {
  const invocation = await resolveCli('ollama', configured);
  return require('./ollama-runtime').ensureServer(invocation);
}
async function listOllamaModels(configured) {
  const base = await ollamaEndpoint(configured);
  const response = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(t('Ollama no ha podido listar sus modelos (') + response.status + ').');
  const data = await response.json();
  return (data.models || []).map(model => model.name).filter(name => typeof name === 'string');
}
const MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u;
async function pullOllamaModel(model, configured, signal, progress = () => {}) {
  if (typeof model !== 'string' || !MODEL_NAME.test(model)) throw new Error(t('Nombre de modelo de Ollama no valido.'));
  const base = await ollamaEndpoint(configured);
  const response = await fetch(base + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal });
  if (!response.ok) throw new Error(t('No se pudo descargar el modelo de Ollama (') + response.status + ').');
  let buffer = ''; let complete = false; const decoder = new TextDecoder();
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line); if (event.error) throw new Error(event.error);
    progress(event); if (event.status === 'success') complete = true;
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline; while ((newline = buffer.indexOf('\n')) !== -1) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
    if (buffer.length > 4 * 1024 * 1024) throw new Error(t('Respuesta de descarga de Ollama demasiado grande.'));
  }
  buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
  if (!complete) throw new Error(t('La descarga del modelo de Ollama no ha terminado.'));
}
async function agentInvocation(session, configured = '', fallback) {
  const invocation = await resolveCli(session.provider, configured, directories(), true, fallback);
  invocation.shellArgs.push(...permissionArguments(session.provider, session.permission));
  if (session.provider === 'ollama') {
    const endpoint = await ollamaEndpoint(configured);
    invocation.env = { OLLAMA_HOST: new URL(endpoint).host };
    if (!session.model) {
      invocation.shellPath = process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
      invocation.shellArgs = ['/k'];
      invocation.env.PATH = path.dirname((await resolveCli('ollama', configured)).shellPath) + path.delimiter + (process.env.PATH || process.env.Path || '');
      return invocation;
    }
    if (typeof session.model !== 'string' || !session.model || /[\x00\r\n]/u.test(session.model) || session.model.startsWith('-')) throw new Error(t('Selecciona un modelo local de Ollama.'));
    const installed = await listOllamaModels(configured);
    if (!installed.includes(session.model)) throw new Error(t('El modelo de Ollama ya no está instalado. Selecciona otro modelo; no se descargan modelos automáticamente.'));
    invocation.shellArgs.push('run', session.model);
  }
  return invocation;
}
module.exports = { MODEL_NAME, ollamaEndpoint, pullOllamaModel, AGENTS, directories, resolveCli, agentInvocation, listOllamaModels };
