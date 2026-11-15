#!/usr/bin/env node
'use strict';
// Mostra o script exatamente como o webhook entregaria.
//   node scripts/render.js <slug> <os> [variante=<id>] [nome=valor ...]
//   node scripts/render.js wazuh linux manager=wazuh.exemplo.local group=Linux,Web | less
const fs = require('fs');
const path = require('path');
const { render } = require('../lib/render');
const { gerar } = require('./build-catalog');

const [slug, os, ...pares] = process.argv.slice(2);
if (!slug || !os) { console.error('uso: render.js <slug> <os> [nome=valor ...]'); process.exit(2); }
const ROOT = path.resolve(__dirname, '..');
const query = Object.fromEntries(pares.map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
const { catalogo } = gerar();
const item = catalogo.itens.find((i) => i.slug === slug && i.os === os && (query.variante ? i.variante === query.variante : i.padrao));
if (!item) { console.error(`nao ha '${slug}' para '${os}'${query.variante ? ` na variante '${query.variante}'` : ''}`); process.exit(2); }
const r = render({ item, query, corpo: fs.readFileSync(path.join(ROOT, item.arquivo), 'utf8'), release: 'local' });
if (!process.env.RENDER_QUIET) r.avisos.forEach((a) => console.error('[aviso] ' + a));
process.stdout.write(r.ok ? r.script : r.resposta_erro);
process.exit(r.ok ? 0 : 1);
