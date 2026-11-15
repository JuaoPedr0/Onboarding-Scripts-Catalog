#!/usr/bin/env node
'use strict';
// Gera a página do catálogo (dist/site/index.html) a partir de
// web/index.html + catalog.json. Usado pelo deploy do GitHub Pages.
//
// Variáveis de ambiente:
//   ONBOARDING_BASE_URL  URL do webhook de onboarding (obrigatória com --strict)
//   SITE_TAG             tag da release publicada (padrão: "local")
//   SITE_PUBLICADO       data ISO da release (opcional)
//   GITHUB_REPOSITORY    owner/repo (o Actions define sozinho)
//
//   node scripts/build-site.js            pré-visualização local
//   node scripts/build-site.js --strict   falha se faltar a URL do webhook
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'site');
const strict = process.argv.includes('--strict');

const base = (process.env.ONBOARDING_BASE_URL || '').trim();
if (strict && !base) {
  console.error('ONBOARDING_BASE_URL vazia. Defina a variável do repositório em Settings → Secrets and variables → Actions → Variables.');
  process.exit(1);
}
if (base && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~/-]*$/.test(base)) {
  console.error(`ONBOARDING_BASE_URL inválida: ${base} (esperado https://host/caminho, sem query string)`);
  process.exit(1);
}

const config = {
  repo: process.env.GITHUB_REPOSITORY || 'JuaoPedr0/Onboarding-Scripts-Catalog',
  tag: process.env.SITE_TAG || 'local',
  publicado: process.env.SITE_PUBLICADO || '',
  base: base || 'https://SEU-N8N/webhook/onboarding',
  catalogo: JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8')),
};

const template = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const re = /(<script id="config" type="application\/json">)[\s\S]*?(<\/script>)/;
if (!re.test(template)) {
  console.error('web/index.html sem o bloco <script id="config" type="application/json">.');
  process.exit(1);
}
// "<" escapado: nenhum valor do catálogo consegue fechar a tag <script>.
const json = JSON.stringify(config).replace(/</g, '\\u003c');
const html = template.replace(re, (_, abre, fecha) => abre + json + fecha);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(config.catalogo, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`site gerado em dist/site (tag ${config.tag}, ${config.catalogo.itens.length} itens).`);
