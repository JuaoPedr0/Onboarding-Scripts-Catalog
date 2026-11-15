#!/usr/bin/env node
'use strict';
// Gera a pagina do catalogo em dist/site: compila o app de web/ (Vite) e
// injeta o catalog.json, a tag e a URL do webhook. Usado pelo deploy do
// GitHub Pages. As variaveis de ambiente estao em scripts/site-config.js.
//
//   node scripts/build-site.js            pre-visualizacao local
//   node scripts/build-site.js --strict   falha se faltar a URL do webhook
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { montarConfig, injetar } = require('./site-config');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'dist', 'site');

let config;
try {
  config = montarConfig(process.env, { strict: process.argv.includes('--strict') });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

if (!fs.existsSync(path.join(WEB, 'node_modules'))) {
  console.error('Dependencias da pagina ausentes. Rode: npm ci --prefix web');
  process.exit(1);
}
execFileSync('npm', ['run', '-s', 'build'], { cwd: WEB, stdio: 'inherit', shell: process.platform === 'win32' });

const index = path.join(OUT, 'index.html');
fs.writeFileSync(index, injetar(fs.readFileSync(index, 'utf8'), config));
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(config.catalogo, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`site gerado em dist/site (tag ${config.tag}, ${config.catalogo.itens.length} itens).`);
