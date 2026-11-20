'use strict';

const composerT = ChatI18n.translator(document.documentElement.lang);

function safeComposerLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

const composerTags = new Set('a b blockquote br code del div em font h1 h2 h3 h4 h5 h6 hr i li ol p pre s span strike strong table tbody td th thead tr u ul'.split(' '));

function composerFragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll('*')) {
    if (!composerTags.has(node.localName) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      node.remove();
      continue;
    }
    const styles = Object.fromEntries(['color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'marginLeft'].map(key => [key, node.style[key]]));
    const href = node.localName === 'a' && safeComposerLink(node.getAttribute('href'));
    const color = node.localName === 'font' && node.getAttribute('color');
    const size = node.localName === 'font' && node.getAttribute('size');
    for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
    if (href) node.setAttribute('href', href);
    if (color && CSS.supports('color', color)) node.setAttribute('color', color);
    if (/^[1-7]$/.test(size)) node.setAttribute('size', size);
    Object.assign(node.style, styles);
    if (!node.style.length) node.removeAttribute('style');
  }
  return template.content;
}

function composerMarkdown(input) {
  function children(node) {
    let result = '';
    for (const child of node.childNodes) {
      if ((child.localName === 'div' || child.localName === 'p') && result && !result.endsWith('\n')) result += '\n';
      result += convert(child);
    }
    return result;
  }
  function convert(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.data.replaceAll('\u00a0', ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.localName;
    const text = children(node);
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'pre') {
      const code = node.innerText.replace(/\n$/, '');
      const fence = '`'.repeat((code.match(/`+/g) || []).reduce((length, run) => Math.max(length, run.length + 1), 3));
      return '\n\n' + fence + '\n' + code + '\n' + fence + '\n\n';
    }
    if (tag === 'table') {
      const rows = [...node.rows].map(row => [...row.cells].map(cell => children(cell).trim().replaceAll('|', '\\|').replace(/\n+/g, ' ')));
      if (!rows.length) return '';
      const line = row => '| ' + row.join(' | ') + ' |';
      return '\n\n' + [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)].join('\n') + '\n\n';
    }
    if (tag === 'ul' || tag === 'ol') {
      const lines = [...node.children].map((item, index) => {
        const marker = tag === 'ul' ? '- ' : (index + 1) + '. ';
        return marker + children(item).trim().replaceAll('\n', '\n' + ' '.repeat(marker.length));
      });
      return '\n' + lines.join('\n') + '\n';
    }
    if (tag === 'blockquote') {
      const indent = node.style.marginLeft;
      return indent ? '\n\n<div style="margin-left:' + indent + '">' + text.trim() + '</div>\n\n'
        : '\n\n' + text.trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    }
    if (tag === 'p' || tag === 'div') {
      const indent = node.style.marginLeft;
      return indent ? '<div style="margin-left:' + indent + '">' + text + '</div>\n' : text + (tag === 'p' ? '\n\n' : '\n');
    }
    if (!text.trim()) return text;
    if (tag === 'a') {
      const url = safeComposerLink(node.getAttribute('href'));
      return url ? '[' + text.replaceAll(']', '\\]') + '](<' + url + '>)' : text;
    }
    if (tag === 'b' || tag === 'strong') return text.replace(/(\S(?:[\s\S]*\S)?)/, '**$1**');
    if (tag === 'i' || tag === 'em') return text.replace(/(\S(?:[\s\S]*\S)?)/, '*$1*');
    if (['s', 'strike', 'del'].includes(tag)) return text.replace(/(\S(?:[\s\S]*\S)?)/, '~~$1~~');
    if (tag === 'u') return '<u>' + text + '</u>';
    if (tag === 'font' || (tag === 'span' && node.style.length)) {
      const clean = composerFragment(node.outerHTML).firstElementChild;
      clean.textContent = '';
      return clean.outerHTML.replace(/<\/\w+>$/, closing => text + closing);
    }
    return text;
  }
  return children(input);
}

function createComposerEditor(input, reportError) {
  const toolbar = document.createElement('div');
  toolbar.className = 'format-toolbar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', composerT('Formato del mensaje'));
  let selection;
  function rememberSelection() {
    const current = document.getSelection();
    if (current.rangeCount && input.contains(current.getRangeAt(0).commonAncestorContainer)) selection = current.getRangeAt(0).cloneRange();
  }
  document.addEventListener('selectionchange', rememberSelection);

  function focusEditor() {
    input.focus();
    const current = document.getSelection();
    if (!selection || !input.contains(selection.commonAncestorContainer)) {
      selection = document.createRange();
      selection.selectNodeContents(input);
      selection.collapse(false);
    }
    current.removeAllRanges();
    current.addRange(selection);
  }

  function command(name, value) {
    focusEditor();
    document.execCommand(name, false, value);
    rememberSelection();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function control(parent, label, icon, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = composerT(label);
    button.setAttribute('aria-label', button.title);
    if (icon) button.append(chatIcon(icon)); else button.textContent = button.title;
    button.addEventListener('mousedown', event => {
      if (document.activeElement === input) rememberSelection();
      event.preventDefault();
    });
    button.addEventListener('click', action);
    parent.append(button);
    return button;
  }

  for (const [label, icon, action] of [
    ['Negrita', 'bold', 'bold'], ['Cursiva', 'italic', 'italic'], ['Subrayado', 'underline', 'underline'],
    ['Tachado', 'strike', 'strikeThrough'], ['Lista con viñetas', 'bullets', 'insertUnorderedList'],
    ['Lista numerada', 'numbers', 'insertOrderedList']
  ]) {
    const button = control(toolbar, label, icon, () => command(action));
    if (['bullets', 'numbers'].includes(icon)) button.classList.add('format-list');
  }

  function iconField(icon, field) {
    const wrapper = document.createElement('span');
    wrapper.className = 'format-field';
    wrapper.append(chatIcon(icon), field);
    toolbar.append(wrapper);
    return wrapper;
  }

  for (const [label, icon, action, color] of [['Resaltado', 'highlight', 'backColor', '#ffdf71'], ['Color de texto', 'textColor', 'foreColor', '#427fd2']]) {
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = color;
    picker.title = composerT(label);
    picker.setAttribute('aria-label', picker.title);
    picker.addEventListener('change', () => command(action, picker.value));
    iconField(icon, picker);
  }

  const size = document.createElement('select');
  size.setAttribute('aria-label', composerT('Tamaño de texto'));
  size.title = composerT('Tamaño de texto');
  for (const [value, label] of [['2', 'Pequeño'], ['3', 'Normal'], ['5', 'Grande']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = composerT(label);
    size.append(option);
  }
  size.value = '3';
  size.addEventListener('change', () => command('fontSize', size.value));
  iconField('textSize', size);
  control(toolbar, 'Cita', 'quote', () => command('formatBlock', 'blockquote'));

  const linkPanel = document.createElement('div');
  linkPanel.className = 'format-link';
  linkPanel.hidden = true;
  const linkField = document.createElement('input');
  linkField.type = 'url';
  linkField.placeholder = 'https://';
  linkField.setAttribute('aria-label', composerT('Dirección del enlace'));
  const linkToggle = control(toolbar, 'Insertar enlace', 'link', () => {
    linkPanel.hidden = !linkPanel.hidden;
    if (!linkPanel.hidden) linkField.focus();
  });
  function addLink() {
    const url = safeComposerLink(linkField.value.trim());
    if (!url) { reportError(composerT('Introduce una dirección HTTP, HTTPS o mailto.')); return; }
    linkPanel.hidden = true;
    focusEditor();
    if (document.getSelection().isCollapsed) {
      const link = document.createElement('a');
      link.href = url;
      link.textContent = url;
      command('insertHTML', link.outerHTML);
    } else command('createLink', url);
    linkField.value = '';
  }
  linkPanel.append(linkField);
  control(linkPanel, 'Aplicar enlace', 'check', addLink);
  linkField.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); addLink(); }
    if (event.key === 'Escape') { linkPanel.hidden = true; linkToggle.focus(); }
  });

  const code = () => command('formatBlock', 'pre');
  const codeButton = control(toolbar, 'Bloque de código', 'code', code);
  codeButton.setAttribute('aria-keyshortcuts', 'Control+Shift+C Meta+Shift+C');
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      rememberSelection();
      code();
    }
  });

  const options = document.createElement('details');
  options.className = 'format-options';
  const toggle = document.createElement('summary');
  toggle.title = composerT('Más opciones de formato');
  toggle.setAttribute('aria-label', toggle.title);
  toggle.append(chatIcon('more'));
  const menu = document.createElement('div');
  menu.className = 'format-menu';
  options.append(toggle, menu);
  toolbar.append(options);
  function sizeMenu() {
    if (options.open) menu.style.maxHeight = `min(38vh, ${Math.max(48, toolbar.getBoundingClientRect().top - 8)}px)`;
  }
  options.addEventListener('toggle', sizeMenu);
  window.addEventListener('resize', sizeMenu);
  toolbar.addEventListener('keydown', event => {
    if (event.key === 'Escape' && options.open) { options.open = false; toggle.focus(); }
  });
  document.addEventListener('pointerdown', event => {
    if (!options.contains(event.target)) options.open = false;
    if (!linkPanel.contains(event.target) && !linkToggle.contains(event.target)) linkPanel.hidden = true;
  });

  function editTable(action) {
    focusEditor();
    const anchor = document.getSelection().anchorNode;
    const cell = (anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement)?.closest('td,th');
    const table = cell?.closest('table');
    if (!table || !input.contains(table)) { reportError(composerT('Coloca el cursor dentro de una tabla.')); return; }
    const row = cell.parentElement.rowIndex;
    const column = cell.cellIndex;
    const replacement = table.cloneNode(true);
    if (action === 'insertRow') {
      const newRow = replacement.insertRow(row + 1);
      for (const unused of replacement.rows[row].cells) newRow.insertCell().append(document.createElement('br'));
    }
    if (action === 'insertColumn') {
      for (const tableRow of replacement.rows) tableRow.insertCell(column + 1).append(document.createElement('br'));
    }
    if (action === 'deleteRow') replacement.deleteRow(row);
    if (action === 'deleteColumn') for (const tableRow of replacement.rows) tableRow.deleteCell(column);
    selection.selectNode(table);
    if (action === 'deleteTable' || !replacement.rows[0]?.cells.length) command('delete');
    else command('insertHTML', replacement.outerHTML);
  }

  const groups = [
    [['Párrafo', () => command('formatBlock', 'p')], ['Bloque de código', code],
      ['Borrar formato', () => { command('removeFormat'); command('unlink'); }]],
    [['Disminuir sangría', () => command('outdent')], ['Aumentar sangría', () => command('indent')]],
    [['Insertar regla horizontal', () => command('insertHorizontalRule')]],
    [['Insertar tabla', () => command('insertHTML', '<table><tbody><tr><th><br></th><th><br></th></tr><tr><td><br></td><td><br></td></tr></tbody></table><div><br></div>')],
      ['Insertar fila', () => editTable('insertRow')], ['Insertar columna', () => editTable('insertColumn')],
      ['Eliminar fila', () => editTable('deleteRow')], ['Eliminar columna', () => editTable('deleteColumn')],
      ['Eliminar tabla', () => editTable('deleteTable')]],
    [['Deshacer', () => command('undo')], ['Rehacer', () => command('redo')]]
  ];
  for (const group of groups) {
    const section = document.createElement('div');
    menu.append(section);
    for (const [label, action] of group) control(section, label, null, () => { options.open = false; action(); });
  }
  control(toolbar, 'Vaciar borrador', 'trash', () => {
    focusEditor();
    selection.selectNodeContents(input);
    command('delete');
  }).classList.add('format-clear');
  toolbar.append(linkPanel);
  return {
    toolbar,
    closePopups() { options.open = false; linkPanel.hidden = true; },
    insertText(text) {
      rememberSelection();
      focusEditor();
      if (!document.execCommand('insertText', false, text)) {
        const current = document.getSelection();
        const range = current.getRangeAt(0);
        const node = document.createTextNode(text.replace(/\r\n?/g, '\n'));
        range.deleteContents();
        range.insertNode(node);
        current.collapse(node, node.length);
      }
      rememberSelection();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
}
