'use strict';
const api = acquireVsCodeApi();
const sidebarT = ChatI18n.translator(document.documentElement.lang);
const sidebarCalls = new Map(); let sidebarSequence = 0; let filesSignature; let chatSignature;
const chatsNode = document.getElementById('chats'); const filesNode = document.getElementById('files');
const vaultSection = document.getElementById('vault-section');
const vaultFiles = document.getElementById('vault-files'); let vaultSignature;
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
    const label = sidebarElement('span', undefined, 'chat-label');
    const heading = sidebarElement('span', undefined, 'chat-heading');
    heading.append(sidebarElement('span', session.name, 'chat-name'));
    if (selected) heading.append(sidebarElement('small', sidebarT('Activo'), 'chat-status'));
    label.append(heading);
    button.append(chatIcon(session.mode === 'terminal' ? 'terminal' : 'chat'), label);
    button.addEventListener('click', () => sidebarRequest('select', {sessionId: session.id}).catch(sidebarError));
    const close = sidebarElement('button', undefined, 'chat-close'); close.type = 'button'; close.title = sidebarT('Cerrar sesión'); close.setAttribute('aria-label', sidebarT('Cerrar sesión') + ': ' + session.name); close.append(chatIcon('close'));
    close.addEventListener('click', () => sidebarRequest('close', {sessionId: session.id}).catch(sidebarError));
    row.append(button, close); chatsNode.append(row);
  }
  if (!state.sessions.length) chatsNode.append(sidebarElement('p', sidebarT('Selecciona o crea un chat para explorar sus archivos.'), 'empty'));
  if (focusedId) [...chatsNode.querySelectorAll('[data-chat-id]')].find(node => node.dataset.chatId === focusedId)?.focus();
}
function fileGlyph(entry) {
  if (entry.iconUrl) { const image = sidebarElement('img', undefined, 'ui-icon'); image.src = entry.iconUrl; image.alt = ''; return image; }
  const glyph = chatIcon(entry.directory ? 'folder' : 'file'); glyph.classList.add(entry.directory ? 'folder-icon' : entry.markdown ? 'markdown-icon' : 'file-icon'); return glyph;
}
const vaultStatusIcon = document.getElementById('vault-sync');
let vaultRoot; let vaultChatId; let vaultStatusRequest;

function showVaultStatus(status) {
  const labels = {
    synced: sidebarT('Sin cambios locales desde la última sincronización confirmada'),
    pending: sidebarT('Cambios locales pendientes de sincronizar'),
    unknown: sidebarT('Sin sincronización confirmada')
  };
  vaultStatusIcon.dataset.status = status;
  vaultStatusIcon.replaceChildren(status === 'synced' ? chatIcon('check') : status === 'pending' ? '↻' : '?');
  const label = `${sidebarT('Sincronizar')} · ${labels[status]}`;
  vaultStatusIcon.title = label;
  vaultStatusIcon.setAttribute('aria-label', label);
}
vaultStatusIcon.addEventListener('click', async event => {
  event.preventDefault();
  event.stopPropagation();
  if (!vaultRoot || vaultStatusIcon.disabled) return;
  vaultStatusIcon.disabled = true;
  try {
    document.getElementById('sidebar-notice').textContent = '';
    await sidebarRequest('vaultSync', { vaultRoot });
  } catch (error) { sidebarError(error); }
  finally { vaultStatusIcon.disabled = false; void refreshVaultStatus(); }
});
async function refreshVaultStatus() {
  const root = vaultRoot;
  if (!root || document.hidden || vaultStatusRequest === root) return;
  vaultStatusRequest = root;
  try {
    const status = await sidebarRequest('vaultStatus', { vaultRoot: root });
    if (vaultRoot === root) showVaultStatus(status);
  } catch {
    if (vaultRoot === root) showVaultStatus('unknown');
  } finally {
    if (vaultStatusRequest === root) vaultStatusRequest = undefined;
  }
}
document.addEventListener('visibilitychange', () => { void refreshVaultStatus(); });
setInterval(() => { void refreshVaultStatus(); }, 5000);
function renderFile(entry, restoreFolder = []) {
  if (entry.directory) {
    const branch = sidebarElement('details', undefined, 'folder');
    const summary = sidebarElement('summary'); summary.title = [entry.rootPath, ...entry.segments].join('/');
    const icon = fileGlyph(entry); summary.append(icon, sidebarElement('span', entry.name || entry.rootPath.split(/[\\/]/u).filter(Boolean).at(-1)));
    const children = sidebarElement('div', undefined, 'children'); branch.append(summary, children);
    let loaded = false; let loading; let openedByUser = false;
    async function loadChildren(rememberFolder = false) {
      if (loading) await loading;
      if (loaded && !rememberFolder) return;
      loading = (async () => {
        const values = await sidebarRequest('list', { parent: entry, rememberFolder });
        children.replaceChildren(...values.map(child => renderFile(child, rememberFolder ? [] : restoreFolder)));
        loaded = true;
      })();
      try { await loading; } finally { loading = undefined; }
    }
    folderLoaders.set(branch, loadChildren);
    if (entry.vault) summary.addEventListener('click', () => { openedByUser = !branch.open; });
    branch.addEventListener('toggle', () => {
      if (entry.iconUrl) icon.src = branch.open ? entry.expandedIconUrl || entry.iconUrl : entry.iconUrl;
      if (branch.open) loadChildren(openedByUser).catch(sidebarError);
      openedByUser = false;
    });
    if (entry.root || (entry.vault && entry.segments.every((segment, index) => restoreFolder[index] === segment))) branch.open = true;
    return branch;
  }
  const button = sidebarElement('button', undefined, 'file-row'); button.type = 'button'; button.title = entry.name;
  button.append(fileGlyph(entry), sidebarElement('span', entry.name));
  const open = () => sidebarRequest('open', {entry, preview: !!entry.markdown}).catch(sidebarError);
  button.addEventListener('click', () => { if (!entry.markdown) open(); });
  button.addEventListener('dblclick', () => { if (entry.markdown) open(); });
  button.addEventListener('keydown', event => { if (event.key === 'Enter' && entry.markdown) { event.preventDefault(); open(); } });
  if (!entry.vault || !entry.markdown) return button;
  const label = sidebarT('Insertar Markdown en el chat activo');
  const insert = sidebarElement('button', undefined, 'vault-insert');
  insert.type = 'button';
  insert.title = label;
  insert.setAttribute('aria-label', label);
  insert.append(chatIcon('copy'));
  insert.disabled = !vaultChatId;
  insert.addEventListener('click', () => sidebarRequest('vaultInsert', { entry, sessionId: vaultChatId }).catch(sidebarError));
  const row = sidebarElement('div', undefined, 'vault-file');
  const trash = sidebarElement('button', undefined, 'vault-trash');
  trash.type = 'button';
  trash.title = sidebarT('Mover a la papelera');
  trash.setAttribute('aria-label', sidebarT('Mover «{0}» a la papelera', entry.name));
  trash.append(chatIcon('trash'));
  trash.addEventListener('click', async () => {
    trash.disabled = true;
    try { await sidebarRequest('vaultTrash', { entry }); }
    catch (failure) { sidebarError(failure); }
    finally { trash.disabled = false; }
  });
  row.append(button, insert, trash);
  return row;
}
async function renderVault(state) {
  const nextRoot = state.vault?.root;
  if (vaultRoot !== nextRoot) showVaultStatus('unknown');
  vaultRoot = nextRoot;
  vaultChatId = state.vaultChatId;
  for (const insert of vaultFiles.querySelectorAll('.vault-insert')) insert.disabled = !vaultChatId;
  const signature = JSON.stringify([state.vault?.root, state.vaultRevision]);
  if (signature === vaultSignature) return;
  vaultSignature = signature;
  vaultSection.hidden = !state.vault;
  vaultFiles.replaceChildren();
  if (!state.vault) return;
  void refreshVaultStatus();
  try {
    const entries = await sidebarRequest('list', { vaultRoot: state.vault.root });
    if (signature === vaultSignature) vaultFiles.replaceChildren(...entries.map(entry => renderFile(entry, state.vaultFolder)));
  } catch (failure) {
    if (signature === vaultSignature) { vaultSignature = undefined; sidebarError(failure); }
  }
}
async function renderSidebar(state) {
  if (vaultSection) void renderVault(state);
  renderChats(state); filesTitleText.textContent = state.activeName || sidebarT('Archivos del chat');
  const signature = JSON.stringify([state.activeId, state.activeRoot, state.revision]); if (filesSignature === signature) return; filesSignature = signature;
  treeOperation++; expandTree.disabled = !state.activeId; collapseTree.disabled = !state.activeId;
  filesNode.replaceChildren();
  if (!state.activeId) { filesNode.append(sidebarElement('p', sidebarT('Selecciona o crea un chat para explorar sus archivos.'), 'empty')); return; }
  const entries = await sidebarRequest('list'); if (filesSignature !== signature) return;
  filesNode.replaceChildren(...entries.map(entry => renderFile(entry)));
}
window.addEventListener('message', event => {
  const message = event.data;
  if (message?.type === 'sidebar') renderSidebar(message).catch(sidebarError);
  if (message?.type === 'sidebarReply') { const call = sidebarCalls.get(message.requestId); if (!call) return; sidebarCalls.delete(message.requestId); message.error ? call.reject(new Error(message.error)) : call.resolve(message.result); }
});

api.postMessage({type: 'ready'});
