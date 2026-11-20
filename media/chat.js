'use strict';
const t = ChatI18n.translator(document.documentElement.lang);
const api = acquireVsCodeApi();
const root = document.getElementById('app');
let state; let sequence = 0; let loadedModels = false; let loadingModels = false; let submitting = false;
const pending = new Map();
const previous = api.getState() || {};
let attachments = Array.isArray(previous.attachments) ? previous.attachments : [];
let pastedImages = [];
let readingClipboard = false;
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function rpc(action, data = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++sequence;
    // Sending can legitimately wait for user approvals; no arbitrary turn timeout.
    pending.set(requestId, { resolve, reject }); api.postMessage({ action, requestId, ...data });
  });
}
function error(error) { notice.textContent = error.message || String(error); }
function button(text, title, action, className) {
  const node = el('button', text, className); node.type = 'button'; node.title = title; node.setAttribute('aria-label', title);
  const iconName = className === 'terminal-button' ? 'terminal' : className === 'send' ? 'send' : className === 'attach' ? 'add' : title.startsWith(t('Mostrar u ocultar')) ? 'history' : title.startsWith(t('Abrir terminal')) ? 'terminal' : title.startsWith(t('Nuevo chat')) ? 'add' : title.startsWith(t('Cerrar sesi')) ? 'close' : undefined;
  if (iconName) node.replaceChildren(chatIcon(iconName));
  node.addEventListener('click', () => Promise.resolve().then(action).catch(error)); return node;
}
function option(label, value) { const node = el('option', label); node.value = value; return node; }
function agentName(provider) { return provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude' : 'Ollama'; }
function copyButton(title, getText, className) {
  let timer;
  const node = button('', title, async () => {
    if (node.disabled) return;
    node.disabled = true;
    try {
      await rpc('copy', { text: getText() });
      clearTimeout(timer);
      node.replaceChildren(chatIcon('check'));
      node.title = t('Copiado'); node.setAttribute('aria-label', t('Copiado'));
      timer = setTimeout(() => {
        node.replaceChildren(chatIcon('copy'));
        node.title = title; node.setAttribute('aria-label', title);
      }, 1800);
    } finally { node.disabled = false; }
  }, className);
  node.replaceChildren(chatIcon('copy'));
  return node;
}
const header = el('header', undefined, 'topbar');
const brand = el('div', undefined, 'brand'); brand.append(chatIcon('brand'), el('span', 'Chat'));
const agent = el('select'); agent.title = t('Agente: cambiar crea otra conversación en esta carpeta'); agent.setAttribute('aria-label', t('Agente'));
for (const name of ['Codex', 'Claude', 'Ollama']) agent.append(option(name, name.toLowerCase()));
brand.append(agent);
const controls = el('div', undefined, 'controls');
const newChatControl = el('div', undefined, 'split-button');
const newChatButton = button('', t('Nuevo chat y seleccionar carpeta'), () => rpc('new'));
const agentMenu = el('div', undefined, 'new-agent-menu');
agentMenu.id = 'new-chat-agents'; agentMenu.hidden = true; agentMenu.setAttribute('role', 'menu'); agentMenu.setAttribute('aria-label', t('Agente del nuevo chat'));
const agentMenuToggle = button('', t('Elegir agente para nuevo chat'), () => setAgentMenu(agentMenu.hidden), 'new-chat-toggle');
agentMenuToggle.replaceChildren(chatIcon('chevron'));
agentMenuToggle.setAttribute('aria-haspopup', 'menu'); agentMenuToggle.setAttribute('aria-expanded', 'false'); agentMenuToggle.setAttribute('aria-controls', agentMenu.id);
function setAgentMenu(open, restoreFocus = true) {
  agentMenu.hidden = !open; agentMenuToggle.setAttribute('aria-expanded', String(open));
  if (open) agentMenu.querySelector('button')?.focus(); else if (restoreFocus) agentMenuToggle.focus();
}
for (const name of ['Codex', 'Claude', 'Ollama']) {
  const item = button(name, t('Nuevo chat con ') + name, async () => { setAgentMenu(false); await rpc('new', { provider: name.toLowerCase() }); });
  item.replaceChildren(document.createTextNode(name)); item.setAttribute('role', 'menuitem'); item.tabIndex = -1;
  agentMenu.append(item);
}
agentMenuToggle.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setAgentMenu(true); if (event.key === 'ArrowUp') agentMenu.lastElementChild.focus(); }
});
agentMenu.addEventListener('keydown', event => {
  const items = [...agentMenu.querySelectorAll('button')];
  const index = items.indexOf(document.activeElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setAgentMenu(false); }
  else if (event.key === 'Tab') setAgentMenu(false, false);
});
document.addEventListener('pointerdown', event => { if (!newChatControl.contains(event.target)) setAgentMenu(false, false); });
window.addEventListener('blur', () => setAgentMenu(false, false));
newChatControl.append(newChatButton, agentMenuToggle, agentMenu);
controls.append(button('▣', t('Abrir terminal del agente'), () => rpc('terminal'), 'terminal-button'), newChatControl, button('×', t('Cerrar sesión'), () => rpc('close')));
const chatHistory = el('div', undefined, 'chat-history');
const historyEntries = el('nav', undefined, 'history-entries'); historyEntries.setAttribute('aria-label', t('Historial de mensajes'));
historyEntries.id = 'chat-message-history'; historyEntries.hidden = true;
const historyToggle = button('', t('Mostrar u ocultar historial del chat'), () => setHistory(historyEntries.hidden));
historyToggle.setAttribute('aria-controls', historyEntries.id); historyToggle.setAttribute('aria-expanded', 'false');
function setHistory(open, restoreFocus = false) {
  historyEntries.hidden = !open; historyToggle.setAttribute('aria-expanded', String(open));
  if (restoreFocus) historyToggle.focus();
}
chatHistory.append(historyToggle, historyEntries);
document.addEventListener('pointerdown', event => { if (!chatHistory.contains(event.target)) setHistory(false); });
chatHistory.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); setHistory(false, true); } });
window.addEventListener('blur', () => setHistory(false));
controls.prepend(chatHistory);
header.append(brand, controls);
const pathLabel = el('div', undefined, 'chat-path');
const conversation = el('main', undefined, 'conversation'); conversation.setAttribute('aria-label', t('Mensajes'));
const welcome = el('div', undefined, 'welcome'); welcome.append(chatIcon('welcome'), el('h1', t('¿En qué trabajamos?')), el('p', t('Un chat independiente, con la carpeta que tú eliges.')));
const messages = el('div', undefined, 'messages');
conversation.append(welcome, messages);
const footer = el('footer');
const approvals = el('section', undefined, 'approvals'); approvals.setAttribute('aria-label', t('Solicitudes del agente'));
const notice = el('p', '', 'notice'); notice.setAttribute('role', 'status');
const composer = el('form', undefined, 'composer');
const attachmentList = el('div', undefined, 'attachments');
const input = el('div', undefined, 'composer-input');
input.contentEditable = 'true';
input.setAttribute('role', 'textbox');
input.setAttribute('aria-multiline', 'true');
input.setAttribute('aria-label', t('Mensaje para el agente'));
input.dataset.placeholder = t('Describe lo que quieres hacer…');
if (typeof previous.draftHtml === 'string') input.append(composerFragment(previous.draftHtml));
else input.textContent = previous.draft || '';
const editor = createComposerEditor(input, message => error(message));
const resizeHandle = el('button', undefined, 'composer-resize');
resizeHandle.type = 'button';
resizeHandle.title = t('Ajustar altura del campo de escritura');
resizeHandle.setAttribute('aria-label', resizeHandle.title);
let composerHeight = Number.isFinite(previous.composerHeight) ? previous.composerHeight : 96;
let resizeDrag;
function resizeComposer(height) {
  composerHeight = Math.max(96, Math.min(height, Math.max(96, Math.floor(window.innerHeight * 0.65))));
  input.style.height = `${composerHeight}px`;
}
resizeComposer(composerHeight);
resizeHandle.addEventListener('pointerdown', event => {
  if (event.button !== 0 || resizeDrag) return;
  resizeHandle.setPointerCapture(event.pointerId);
  resizeDrag = { id: event.pointerId, top: event.clientY, height: input.offsetHeight };
});
resizeHandle.addEventListener('pointermove', event => {
  if (resizeDrag?.id === event.pointerId) resizeComposer(resizeDrag.height + resizeDrag.top - event.clientY);
});
resizeHandle.addEventListener('lostpointercapture', event => {
  if (resizeDrag?.id !== event.pointerId) return;
  resizeDrag = undefined;
  remember();
});
resizeHandle.addEventListener('keydown', event => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  resizeComposer(input.offsetHeight + (event.key === 'ArrowUp' ? 24 : -24));
  remember();
});
const toolbar = el('div', undefined, 'composer-toolbar');
const left = el('div', undefined, 'toolbar-left');
editor.toolbar.id = 'chat-format-toolbar';
let formatVisible = previous.formatVisible !== false;
const formatToggle = button('', '', () => { setFormatVisible(!formatVisible); remember(); }, 'format-toggle');
formatToggle.replaceChildren(chatIcon('formatting'));
formatToggle.setAttribute('aria-controls', editor.toolbar.id);
function setFormatVisible(visible) {
  formatVisible = visible;
  editor.toolbar.hidden = !visible;
  if (!visible) editor.closePopups();
  formatToggle.title = t(visible ? 'Ocultar barra de edición' : 'Mostrar barra de edición');
  formatToggle.setAttribute('aria-label', formatToggle.title);
  formatToggle.setAttribute('aria-expanded', String(visible));
}
setFormatVisible(formatVisible);
left.append(button('＋', t('Adjuntar texto e imágenes de la carpeta'), async () => {
  const chosen = await rpc('attach', { attachments });
  for (const segments of chosen || []) if (!attachments.some(a => JSON.stringify(a) === JSON.stringify(segments))) attachments.push(segments);
  renderAttachments(); remember();
}, 'attach'), formatToggle);
const downloadModel = button(t('Descargar modelo'), t('Descargar modelo de Ollama'), async () => {
  downloadModel.disabled = true;
  try { if (await rpc('pullModel')) { loadedModels = false; await loadModels(); } }
  finally { downloadModel.disabled = false; }
}, 'download-model');
downloadModel.replaceChildren(chatIcon('download'), chatIcon('chevron'));
downloadModel.hidden = true; left.append(downloadModel);
const permission = el('select'); permission.setAttribute('aria-label', t('Permisos del agente'));
permission.className = 'permission-picker';
permission.append(option(t('\u270b Solicitar aprobaci\u00f3n'), 'ask'), option(t('\uD83E\uDD16 Aprobar por m\u00ed'), 'auto'));
permission.append(option(t('\uD83D\uDD13 Acceso completo'), 'full'), option(t('\u2699\uFE0F Personalizado'), 'custom'));
permission.addEventListener('change', () => rpc('permission', { value: permission.value }).catch(error));
left.append(permission);
const right = el('div', undefined, 'toolbar-right');
const model = el('select'); model.setAttribute('aria-label', t('Modelo')); model.title = t('Seleccionar modelo disponible');
model.append(option(t('Modelo predeterminado'), ''));
const ollamaPicker = el('div', undefined, 'ollama-model-picker'); ollamaPicker.hidden = true;
const ollamaMenu = el('div', undefined, 'ollama-model-menu'); ollamaMenu.id = 'ollama-models'; ollamaMenu.hidden = true; ollamaMenu.setAttribute('role', 'listbox'); ollamaMenu.setAttribute('aria-label', t('Modelo'));
const ollamaModelName = el('span', t('Modelo'), 'model-name');
const ollamaToggle = button('', t('Seleccionar modelo disponible'), async () => {
  if (!ollamaMenu.hidden) { setOllamaMenu(false); return; }
  ollamaToggle.disabled = true;
  try { await loadModels(); renderOllamaMenu(); if (!state?.running) setOllamaMenu(true); }
  finally { ollamaToggle.disabled = !!state?.running; }
}, 'ollama-model-toggle');
ollamaToggle.replaceChildren(chatIcon('model'), ollamaModelName, chatIcon('chevron'));
ollamaToggle.setAttribute('aria-haspopup', 'listbox'); ollamaToggle.setAttribute('aria-expanded', 'false'); ollamaToggle.setAttribute('aria-controls', ollamaMenu.id);
ollamaPicker.append(ollamaToggle, ollamaMenu);
function setOllamaMenu(open, restoreFocus = true) {
  ollamaMenu.hidden = !open; ollamaToggle.setAttribute('aria-expanded', String(open));
  if (open) (ollamaMenu.querySelector('[aria-selected="true"]') || ollamaMenu.querySelector('button'))?.focus();
  else if (restoreFocus) ollamaToggle.focus();
}
function renderOllamaMenu() {
  ollamaMenu.replaceChildren();
  const values = [...model.options].filter(value => value.value);
  if (!values.length) ollamaMenu.append(el('p', t('No hay modelos instalados'), 'model-empty'));
  for (const value of values) {
    const selected = value.value === state?.session.model;
    const item = button('', value.textContent, async () => { setOllamaMenu(false); await rpc('model', { value: value.value }); }, 'ollama-model-option');
    item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(selected)); item.tabIndex = -1;
    item.append(chatIcon('model'), el('span', value.textContent, 'model-name'));
    if (selected) item.append(chatIcon('check'));
    ollamaMenu.append(item);
  }
  const download = button('', t('Descargar modelo de Ollama'), () => { setOllamaMenu(false); downloadModel.click(); }, 'ollama-model-download');
  download.append(chatIcon('download'), el('span', t('Descargar modelo'))); download.tabIndex = -1;
  ollamaMenu.append(download);
}
ollamaPicker.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); setOllamaMenu(false); return; }
  if (event.key === 'Tab') { setOllamaMenu(false, false); return; }
  if (ollamaMenu.hidden || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = [...ollamaMenu.querySelectorAll('button')]; const index = items.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
});
document.addEventListener('pointerdown', event => { if (!ollamaPicker.contains(event.target)) setOllamaMenu(false, false); });
window.addEventListener('blur', () => setOllamaMenu(false, false));
async function loadModels() {
  if (loadedModels || loadingModels) return;
  loadingModels = true; notice.textContent = t('Consultando modelos…');
  try {
    const values = await rpc('models');
    const selected = state?.session.model || '';
    model.replaceChildren(...values.map(value => option(value.label, value.value)));
    if (!values.some(value => value.value === selected)) model.prepend(option(selected || t('Predeterminado'), selected));
    model.value = selected; loadedModels = true; notice.textContent = '';
    renderOllamaMenu();
  } catch (err) { error(err); } finally { loadingModels = false; }
}
model.addEventListener('focus', loadModels); model.addEventListener('pointerdown', loadModels);
model.addEventListener('change', () => rpc('model', { value: model.value }).catch(error));
const send = button('↑', t('Enviar mensaje'), () => submit(), 'send');
right.append(model, ollamaPicker, send); toolbar.append(left, right);
composer.append(resizeHandle, attachmentList, input, editor.toolbar, toolbar); footer.append(approvals, notice, composer);
const footnote = el('p', t('Enter envía · Mayús+Enter añade una línea'), 'footnote'); footer.append(footnote);
root.replaceChildren(header, pathLabel, conversation, footer);
function remember() { api.setState({ sessionId: state?.session.id || previous.sessionId, draftHtml: input.innerHTML, attachments, composerHeight, formatVisible }); }
input.addEventListener('input', remember);
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit().catch(error); } });
input.addEventListener('dragover', event => event.preventDefault());
input.addEventListener('drop', event => event.preventDefault());
input.addEventListener('paste', event => {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  event.preventDefault();
  const text = clipboard.getData('text/plain');
  if (text) editor.insertText(text);
  const files = [...clipboard.files].filter(file => file.type.startsWith('image/'));
  if (!files.length) {
    for (const item of clipboard.items) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length) pasteImages(files).catch(error);
});
async function pasteImages(files) {
  if (readingClipboard) { error(composerT('No se pudo leer la imagen del portapapeles.')); return; }
  if (pastedImages.length + attachments.length + files.length > 10) throw new Error(composerT('Adjunta como máximo 10 archivos.'));
  const maxImage = 5 * 1024 * 1024;
  if (files.some(file => !/^image\/(png|jpeg|webp)$/.test(file.type) || !file.size || file.size > maxImage)) {
    throw new Error(composerT('Pega imágenes PNG, JPEG o WebP de hasta 5 MB.'));
  }
  if ([...pastedImages, ...files].reduce((total, item) => total + item.size, 0) > 2 * maxImage) {
    throw new Error(composerT('Las imágenes adjuntas superan los 10 MB en total.'));
  }
  readingClipboard = true;
  try {
    const images = await Promise.all(files.map(file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ mime: file.type, data: reader.result.split(',')[1], size: file.size });
      reader.onerror = () => reject(new Error(composerT('No se pudo leer la imagen del portapapeles.')));
      reader.readAsDataURL(file);
    })));
    if (pastedImages.length + attachments.length + images.length > 10) throw new Error(composerT('Adjunta como máximo 10 archivos.'));
    pastedImages.push(...images);
    renderAttachments();
  } finally { readingClipboard = false; }
}
composer.addEventListener('submit', event => { event.preventDefault(); submit().catch(error); });
function renderAttachments() {
  attachmentList.replaceChildren();
  attachments.forEach((segments, index) => attachmentList.append(button(`◇ ${segments.join('/')} ×`, t('Quitar {0}', segments.join('/')), () => { attachments.splice(index, 1); renderAttachments(); remember(); }, 'chip')));
  pastedImages.forEach((image, index) => {
    const label = composerT('Imagen pegada {0}', index + 1);
    const chip = button(label + ' ×', t('Quitar {0}', label), () => {
      pastedImages.splice(index, 1); renderAttachments();
    }, 'chip');
    const thumbnail = el('img');
    thumbnail.src = 'data:' + image.mime + ';base64,' + image.data;
    thumbnail.alt = '';
    chip.prepend(thumbnail);
    attachmentList.append(chip);
  });
}
async function submit() {
  if (state?.running) { await rpc('stop'); return; }
  if (submitting || readingClipboard) return;
  const text = composerMarkdown(input).trim();
  if (!text && !pastedImages.length && !attachments.length) return;
  if (state?.session.provider === 'ollama' && !state.session.model) { notice.textContent = t('Descarga o selecciona un modelo de Ollama antes de enviar.'); return; }
  const draftHtml = input.innerHTML;
  const formatted = input.querySelector('a,b,blockquote,em,font,hr,i,ol,pre,s,span[style],strike,strong,table,u,ul,div[style],p[style]') ? draftHtml : undefined;
  const chosen = attachments;
  const clipboard = pastedImages;
  submitting = true; send.disabled = true;
  input.replaceChildren(); attachments = []; pastedImages = []; renderAttachments(); remember();
  try { await rpc('send', { text, attachments: chosen, pastedImages: clipboard.map(({ mime, data }) => ({ mime, data })), formatted }); }
  catch (err) {
    if (!input.hasChildNodes() && !attachments.length && !pastedImages.length && !readingClipboard) {
      input.append(composerFragment(draftHtml)); attachments = chosen; pastedImages = clipboard; renderAttachments(); remember();
    }
    error(err);
  }
  finally { submitting = false; send.disabled = false; input.focus(); }
}
agent.addEventListener('change', () => { const selected = agent.value; agent.value = state.session.provider; rpc('agent', { value: selected }).catch(error); });
let lastContent = ''; let lastApprovals = ''; let lastContext = '';
function renderContext() {
  const signature = JSON.stringify(state.messages.filter(entry => entry.role === 'user').map(entry => [entry.id, entry.text]));
  if (signature === lastContext) return;
  lastContext = signature;
  historyEntries.replaceChildren();
  for (const entry of state.messages.filter(entry => entry.role === 'user')) {
    historyEntries.append(button(entry.text.slice(0, 100), entry.text, () => {
      document.getElementById('message-' + entry.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setHistory(false, true);
    }, 'history-link'));
  }
  if (!historyEntries.childElementCount) historyEntries.append(el('p', t('Los mensajes de este chat aparecer\u00e1n aqu\u00ed.')));
}

function render() {
  const session = state.session;
  renderContext();
  remember();
  agent.value = session.provider; pathLabel.textContent = session.root; pathLabel.title = session.root;
  permission.options[3].textContent = session.provider === 'codex' ? t('\u2699\uFE0F Personalizado (config.toml)') : t('\u2699\uFE0F Personalizado (configuraci\u00f3n)');
  const legacyPermission = permission.querySelector('option[value="read"]');
  if (session.permission === 'read' && !legacyPermission) permission.append(option(session.provider === 'claude' ? t('\uD83D\uDCCB Modo de planificaci\u00f3n') : t('\uD83D\uDC41\uFE0F Solo lectura'), 'read'));
  else if (session.permission !== 'read') legacyPermission?.remove();
  permission.title = session.provider === 'ollama' ? t('Ollama no utiliza herramientas de ejecuci\u00f3n en esta extensi\u00f3n.') : ({
    ask: t('Solicita aprobaci\u00f3n cuando una acci\u00f3n lo requiere.'),
    auto: t('El revisor nativo aprueba o rechaza las acciones y consulta cuando es necesario.'),
    full: t('Permite acceder fuera de la carpeta y a Internet sin pedir aprobaci\u00f3n, sujeto a las pol\u00edticas del proveedor.'),
    custom: t('Utiliza los permisos de la configuraci\u00f3n nativa del agente.')
  }[session.permission || 'ask'] || t('Permisos para las acciones del agente'));
  permission.value = session.permission || 'ask';
  permission.disabled = session.provider === 'ollama' || (state.running && !state.approvals.some(prompt => !prompt.question));
  if (state.running && !permission.disabled) permission.title = t('Cambiar el modo interrumpe la solicitud pendiente y continúa con los permisos nuevos.');
  model.disabled = state.running;
  if (![...model.options].some(o => o.value === (session.model || ''))) model.append(option(session.model || t('Predeterminado'), session.model || ''));
  model.value = session.model || '';
  model.hidden = session.provider === 'ollama'; ollamaPicker.hidden = session.provider !== 'ollama';
  ollamaModelName.textContent = session.model || t('Modelo'); ollamaToggle.disabled = !!state.running;
  if (state.running || session.provider !== 'ollama') setOllamaMenu(false, false);
  send.replaceChildren(chatIcon(state.running ? 'stop' : 'send')); send.title = state.running ? t('Detener respuesta') : t('Enviar mensaje'); send.setAttribute('aria-label', send.title); send.disabled = submitting && !state.running;
  const transcript = JSON.stringify(state.messages);
  if (lastContent !== transcript) {
    const atBottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 100;
    messages.replaceChildren();
    for (const entry of state.messages) {
      if (entry.role === 'activity') {
        const detail = el('details', undefined, 'activity');
        const summary = el('summary');
        summary.append(chatIcon('terminal'), el('span', entry.text.split('\n')[0].slice(0, 130)));
        detail.setAttribute('aria-busy', String(entry.status === 'inProgress'));
        detail.append(summary, el('pre', entry.text)); messages.append(detail); continue;
      }
      const row = el('article', undefined, `message ${entry.role}`); row.id = 'message-' + entry.id;
      if (entry.role === 'assistant') {
        const sender = el('div', undefined, 'sender');
        sender.append(chatIcon('chatGradient'), el('span', agentName(session.provider))); row.append(sender);
        const body = el('div', undefined, 'markdown'); body.innerHTML = entry.html || ''; row.append(body);
        body.querySelectorAll('a').forEach(link => link.addEventListener('click', event => { event.preventDefault(); rpc('link', { url: link.getAttribute('href') }).catch(error); }));
        body.querySelectorAll('pre').forEach(pre => pre.append(copyButton(t('Copiar código'), () => pre.querySelector('code')?.textContent || '', 'copy-code')));
        row.append(copyButton(t('Copiar respuesta'), () => entry.text, 'copy-answer'));
      } else {
        if (entry.role === 'user' && typeof entry.formatted === 'string') {
          const body = el('div', undefined, 'markdown formatted-message');
          body.append(composerFragment(entry.formatted));
          body.querySelectorAll('a').forEach(link => link.addEventListener('click', event => {
            event.preventDefault(); rpc('link', { url: link.getAttribute('href') }).catch(error);
          }));
          row.append(body);
        } else row.append(el('div', entry.text, 'message-text'));
        const labels = (entry.attachments || []).map(a => a.join('/'));
        for (let index = 0; index < Math.min(10, entry.pastedImageCount); index++) labels.push(composerT('Imagen pegada {0}', index + 1));
        if (labels.length) row.append(el('div', labels.join(' · '), 'attachment-caption'));
      }
      messages.append(row);
    }
    lastContent = transcript;
    if (atBottom || state.messages.at(-1)?.role === 'user') conversation.scrollTop = conversation.scrollHeight;
  }
  downloadModel.hidden = session.provider !== 'ollama';
  if (session.provider === 'ollama' && !session.model && !state.running) send.disabled = true;
  welcome.hidden = state.messages.length > 0;
  if (state.notice) notice.textContent = state.notice;
  else if (state.running) notice.replaceChildren(chatIcon('chatGradient'), el('span', t('{0} está escribiendo…', agentName(session.provider))));
  else notice.textContent = session.provider === 'ollama' ? (session.model ? t('Los modelos con herramientas pueden leer archivos de texto de la carpeta del chat.') : t('Inicia Ollama y pulsa Descargar modelo para instalar tu primer modelo local.')) : '';
  const prompts = JSON.stringify(state.approvals);
  if (prompts !== lastApprovals) {
    approvals.replaceChildren(); lastApprovals = prompts;
    for (const prompt of state.approvals) {
      const card = el('div', undefined, 'approval-card'); card.append(el('strong', prompt.title), el('pre', prompt.detail));
      if (session.permission === 'auto' && !prompt.question) {
        card.append(el('p', t('El agente requiere confirmación manual para esta acción aunque la revisión automática esté seleccionada.')));
      }
      if (prompt.question) {
        const answer = el('input'); answer.placeholder = t('Escribe tu respuesta'); answer.setAttribute('aria-label', prompt.title); card.append(answer);
        for (const choice of prompt.options || []) card.append(button(choice.label, choice.description || choice.label, () => rpc('approval', { id: prompt.id, answer: choice.label })));
        card.append(button(t('Responder'), t('Enviar respuesta al agente'), () => rpc('approval', { id: prompt.id, answer: answer.value })));
      } else card.append(button(t('Rechazar'), t('Rechazar esta acción'), () => rpc('approval', { id: prompt.id, accept: false })), button(t('Permitir una vez'), t('Aprobar solamente esta acción'), () => rpc('approval', { id: prompt.id, accept: true }), 'primary'));
      approvals.append(card);
    }
  }
}
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'reply') { const call = pending.get(message.requestId); if (!call) return; pending.delete(message.requestId); message.error ? call.reject(new Error(message.error)) : call.resolve(message.result); }
  if (message.type === 'chat') { state = message; render(); }
});
renderAttachments(); api.postMessage({ action: 'ready' });
