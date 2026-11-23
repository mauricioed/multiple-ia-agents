'use strict';
const api = acquireVsCodeApi();
const sidebarT = ChatI18n.translator(document.documentElement.lang);
const sidebarCalls = new Map(); let sidebarSequence = 0; let filesSignature; let chatSignature;
const chatsNode = document.getElementById('chats'); const filesNode = document.getElementById('files');
const folderLoaders = new WeakMap(); let treeOperation = 0;
function sidebarElement(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function sidebarRequest(action, data = {}) {
  return new Promise((resolve, reject) => { const requestId = ++sidebarSequence; sidebarCalls.set(requestId, {resolve, reject}); api.postMessage({action, requestId, ...data}); });
}
function sidebarError(error) { document.getElementById('sidebar-notice').textContent = error.message; }
const filesTitle = document.getElementById('files-title');
const filesTitleText = sidebarElement('span', filesTitle.textContent, 'files-title-text');
const treeControls = sidebarElement('span', undefined, 'tree-controls');
function treeButton(icon, title, action) {
  const node = sidebarElement('button'); node.type = 'button'; node.title = title; node.setAttribute('aria-label', title);
  node.append(chatIcon(icon));
  node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); Promise.resolve().then(action).catch(sidebarError); });
  node.addEventListener('keydown', event => event.stopPropagation());
  return node;
}
const collapseTree = treeButton('collapseAll', sidebarT('Contraer todo el árbol'), () => {
  treeOperation++; expandTree.disabled = false;
  for (const branch of filesNode.querySelectorAll('details.folder')) branch.open = false;
});
const expandTree = treeButton('expandAll', sidebarT('Expandir todo el árbol'), async () => {
  const operation = ++treeOperation; expandTree.disabled = true;
  filesNode.closest('details').open = true;
  async function expand(branch) {
    if (operation !== treeOperation || !branch.isConnected) return;
    branch.open = true; await folderLoaders.get(branch)?.();
    if (operation !== treeOperation || !branch.isConnected) return;
    for (const child of branch.querySelector(':scope > .children').children) if (child.matches('details.folder')) await expand(child);
  }
  try { for (const root of filesNode.children) if (root.matches('details.folder')) await expand(root); }
  finally { if (operation === treeOperation) expandTree.disabled = false; }
});
expandTree.disabled = true; collapseTree.disabled = true;
treeControls.append(expandTree, collapseTree); filesTitle.replaceChildren(filesTitleText, treeControls);
function renderChats(state) {
  const signature = JSON.stringify([state.activeId, state.sessions]); if (signature === chatSignature) return; chatSignature = signature;
  const focusedId = chatsNode.contains(document.activeElement) ? document.activeElement.dataset.chatId : undefined;
  chatsNode.replaceChildren();
  for (const session of state.sessions) {
    const selected = session.id === state.activeId;
    const row = sidebarElement('div', undefined, 'chat-row' + (selected ? ' selected' : ''));
    const button = sidebarElement('button', undefined, 'chat-select'); button.type = 'button'; button.title = session.root; button.dataset.chatId = session.id;
    if (selected) button.setAttribute('aria-current', 'true');
    button.append(chatIcon(session.mode === 'terminal' ? 'terminal' : 'chat'), sidebarElement('span', session.name, 'chat-name'));
    if (selected) button.append(sidebarElement('small', sidebarT('Activo'), 'chat-status'));
    else if (session.closed) button.append(sidebarElement('small', sidebarT('cerrado'), 'chat-status'));
    button.addEventListener('click', () => sidebarRequest('select', {sessionId: session.id}).catch(sidebarError));
    row.append(button); chatsNode.append(row);
    if (session.closed) continue;
    const close = sidebarElement('button', undefined, 'chat-close'); close.type = 'button'; close.title = sidebarT('Cerrar sesión'); close.setAttribute('aria-label', sidebarT('Cerrar sesión') + ': ' + session.name); close.append(chatIcon('close'));
    close.addEventListener('click', () => sidebarRequest('close', {sessionId: session.id}).catch(sidebarError));
    row.append(close);
  }
  if (!state.sessions.length) chatsNode.append(sidebarElement('p', sidebarT('Selecciona o crea un chat para explorar sus archivos.'), 'empty'));
  if (focusedId) [...chatsNode.querySelectorAll('[data-chat-id]')].find(node => node.dataset.chatId === focusedId)?.focus();
}
function fileGlyph(entry) {
  if (entry.iconUrl) { const image = sidebarElement('img', undefined, 'ui-icon'); image.src = entry.iconUrl; image.alt = ''; return image; }
  const glyph = chatIcon(entry.directory ? 'folder' : 'file'); glyph.classList.add(entry.directory ? 'folder-icon' : entry.markdown ? 'markdown-icon' : 'file-icon'); return glyph;
}
function renderFile(entry) {
  if (entry.directory) {
    const branch = sidebarElement('details', undefined, 'folder');
    const summary = sidebarElement('summary'); summary.title = [entry.rootPath, ...entry.segments].join('/');
    const icon = fileGlyph(entry); summary.append(icon, sidebarElement('span', entry.name || entry.rootPath.split(/[\\/]/u).filter(Boolean).at(-1)));
    const children = sidebarElement('div', undefined, 'children'); branch.append(summary, children);
    let loaded = false; let loading;
    async function loadChildren() {
      if (loaded) return;
      if (loading) return loading;
      loading = (async () => {
        const values = await sidebarRequest('list', {parent: entry});
        children.replaceChildren(...values.map(renderFile)); loaded = true;
      })();
      try { await loading; } finally { loading = undefined; }
    }
    folderLoaders.set(branch, loadChildren);
    branch.addEventListener('toggle', () => {
      if (entry.iconUrl) icon.src = branch.open ? entry.expandedIconUrl || entry.iconUrl : entry.iconUrl;
      if (branch.open) loadChildren().catch(sidebarError);
    });
    if (entry.root) branch.open = true;
    return branch;
  }
  const button = sidebarElement('button', undefined, 'file-row'); button.type = 'button'; button.title = entry.name;
  button.append(fileGlyph(entry), sidebarElement('span', entry.name));
  const open = () => sidebarRequest('open', {entry, preview: !!entry.markdown}).catch(sidebarError);
  button.addEventListener('click', () => { if (!entry.markdown) open(); });
  button.addEventListener('dblclick', () => { if (entry.markdown) open(); });
  button.addEventListener('keydown', event => { if (event.key === 'Enter' && entry.markdown) { event.preventDefault(); open(); } });
  return button;
}
async function renderSidebar(state) {
  renderChats(state); filesTitleText.textContent = state.activeName || sidebarT('Archivos del chat');
  const signature = JSON.stringify([state.activeId, state.activeRoot, state.revision]); if (filesSignature === signature) return; filesSignature = signature;
  treeOperation++; expandTree.disabled = !state.activeId; collapseTree.disabled = !state.activeId;
  filesNode.replaceChildren();
  if (!state.activeId) { filesNode.append(sidebarElement('p', sidebarT('Selecciona o crea un chat para explorar sus archivos.'), 'empty')); return; }
  const entries = await sidebarRequest('list'); if (filesSignature !== signature) return;
  filesNode.replaceChildren(...entries.map(renderFile));
}
window.addEventListener('message', event => {
  const message = event.data;
  if (message?.type === 'sidebar') renderSidebar(message).catch(sidebarError);
  if (message?.type === 'sidebarReply') { const call = sidebarCalls.get(message.requestId); if (!call) return; sidebarCalls.delete(message.requestId); message.error ? call.reject(new Error(message.error)) : call.resolve(message.result); }
});

api.postMessage({type: 'ready'});
