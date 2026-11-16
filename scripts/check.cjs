const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
for (const dir of ['src', 'media', 'scripts']) for (const file of fs.readdirSync(dir)) if (/\.[cm]?js$/.test(file)) execFileSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
