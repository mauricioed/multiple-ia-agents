'use strict';
// Small code-native action icons; their colors come from the current VS Code theme.
let chatGradientSequence = 0;
function chatIcon(name) {
  const paths = {
    bold: 'M5 13V3h4a2.5 2.5 0 0 1 0 5H5m4 0a2.5 2.5 0 0 1 0 5H5',
    italic: 'M7 3h6M3 13h6M10 3 6 13',
    underline: 'M4 3v5a4 4 0 0 0 8 0V3M3 14h10',
    strike: 'M12 5a4 3 0 0 0-8 0m0 6a4 3 0 0 0 8 0M2 8h12',
    bullets: 'M5 4h9M5 8h9M5 12h9M2 4h.3M2 8h.3M2 12h.3',
    numbers: 'M6 4h8M6 8h8M6 12h8M2 3l1-1v4M2 8a1 1 0 0 1 2 0l-2 2h2M2 12h2l-1 1h1v2H2',
    highlight: 'M3 2v5l2 2v3l6-3 2-3V2M3 6h10M5 12l-2 2',
    textColor: 'm4 10 4-8 4 8M6 7h4M2 12h12v2H2z',
    textSize: 'm1 12 3-6 3 6m-5-2h4m1 2 4-9 4 9m-6-3h4',
    quote: 'M3 8V4h4v4c0 3-2 4-3 4m6-4V4h4v4c0 3-2 4-3 4',
    link: 'M6 11H5a3 3 0 0 1 0-6h2m3 0h1a3 3 0 0 1 0 6H9M5 8h6',
    code: 'M2 2h12v12H2zM6.5 6 5 8l1.5 2m3-4L11 8l-1.5 2',
    more: 'M3 8h.3m4.5 0h.3m4.5 0h.3',
    trash: 'M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 6v5m2-5v5',
    formatting: 'M2 12 5.5 3 9 12M3.2 9h4.6M10 4h4m-4 4h4m-4 4h4',
    model: 'M4 4h8v8H4ZM6 6h4v4H6ZM6 1v3M10 1v3M6 12v3M10 12v3M1 6h3M1 10h3M12 6h3M12 10h3',
    download: 'M8 1v9m-3-3 3 3 3-3M2 10v4h12v-4',
    expandAll: 'M5 2h9v9M2 5h9v9H2ZM4 9.5h5M6.5 7v5',
    collapseAll: 'M5 2h9v9M2 5h9v9H2ZM4 9.5h5',
    copy: 'M6 5h7v9H6ZM10 5V2H3v9h3',
    check: 'm3 8 3 3 7-7',
    chat: 'M2 2h10v7H7l-3 3V9H2ZM8 11h3l2 2v-2h1V5',
    folder: 'M1 4h5l2 2h7v7H1ZM1 4V2h5l2 2h6v2',
    file: 'M3 1h6l4 4v10H3ZM9 1v4h4',
    chevron: 'm4 6 4 4 4-4',
    add: 'M8 2v12M2 8h12', close: 'm4 4 8 8M12 4l-8 8',
    history: 'M2 6a6 6 0 1 1 .4 5M2 2v4h4M8 4.5V8l2.5 1.5',
    terminal: 'M1.5 2.5h13v11h-13Zm2 3 3 2.5-3 2.5M8 11h4',
    send: 'M8 14V2m-5 5 5-5 5 5', stop: 'M4 4h8v8H4Z',
    brand: 'M13 4.5H5.5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3H7v3l4.5-3h4a3 3 0 0 0 3-3V12',
    welcome: 'M2 2h12v9H9l-3 3v-3H2Z'
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ui-icon'); svg.setAttribute('viewBox', name === 'brand' ? '0 0 24 24' : '0 0 16 16');
  svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name === 'chatGradient' ? 'chat' : name] || paths.brand);
  path.setAttribute('fill', ['stop', 'welcome'].includes(name) ? 'currentColor' : 'none');
  path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', name === 'brand' ? '1.6' : '1.2');
  if (name === 'bold' || name === 'more') path.setAttribute('stroke-width', '1.8');
  if (['more', 'bullets', 'link', 'italic'].includes(name)) path.setAttribute('stroke-linecap', 'round');
  if (name === 'chatGradient') {
    const defs = document.createElementNS(svg.namespaceURI, 'defs');
    const gradient = document.createElementNS(svg.namespaceURI, 'linearGradient');
    const id = 'agent-chat-gradient-' + (++chatGradientSequence);
    gradient.setAttribute('id', id); gradient.setAttribute('x1', '0%'); gradient.setAttribute('x2', '100%');
    for (const [offset, color] of [['0%', '#087eb9'], ['100%', '#40bea4']]) {
      const stop = document.createElementNS(svg.namespaceURI, 'stop'); stop.setAttribute('offset', offset); stop.setAttribute('stop-color', color); gradient.append(stop);
    }
    defs.append(gradient); svg.append(defs); path.setAttribute('stroke', 'url(#' + id + ')');
  }
  if (name === 'brand') path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round'); svg.append(path);
  if (name === 'brand') {
    const sparkles = document.createElementNS(svg.namespaceURI, 'path');
    sparkles.setAttribute('d', 'm18.5 1.5 1.15 3.35L23 6l-3.35 1.15-1.15 3.35-1.15-3.35L14 6l3.35-1.15Zm3 9.5.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55Z');
    sparkles.setAttribute('fill', 'currentColor');
    svg.append(sparkles);
  }
  return svg;
}
