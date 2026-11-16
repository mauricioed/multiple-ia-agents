'use strict';
// Curated local text-chat models, verified against https://ollama.com/library on 2026-11-13.
// Sizes describe approximate downloads, not memory requirements. Other tags can be entered manually.
module.exports = [
  { model: 'gemma3:1b', size: '806 MB', category: 'Uso general' },
  { model: 'llama3.2:1b', size: '1.3 GB', category: 'Uso general' },
  { model: 'llama3.2:3b', size: '2.0 GB', category: 'Uso general' },
  { model: 'qwen3.5:2b', size: '2.7–3.1 GB', category: 'Uso general' },
  { model: 'qwen3.5:4b', size: '3.3–4.0 GB', category: 'Uso general' },
  { model: 'gemma3:4b', size: '3.4 GB', category: 'Uso general' },
  { model: 'qwen3.5:9b', size: '6.6–7.6 GB', category: 'Uso general' },
  { model: 'qwen2.5-coder:1.5b', size: '986 MB', category: 'Programación' },
  { model: 'qwen2.5-coder:3b', size: '1.9 GB', category: 'Programación' },
  { model: 'qwen2.5-coder:7b', size: '4.7 GB', category: 'Programación' },
  { model: 'qwen2.5-coder:14b', size: '9.0 GB', category: 'Programación' },
  { model: 'gpt-oss:20b', size: '14 GB', category: 'Razonamiento' }
];
