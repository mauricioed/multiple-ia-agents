'use strict';
const catalog = require('../media/i18n');
let locale = 'es'; // Headless tests and CLI helpers have no VS Code language service.
try { locale = require('vscode').env?.language || 'es'; } catch {}
const language = catalog.language(locale);
module.exports = { t: catalog.translator(language), language };
