'use strict';
// Renderiza o fixture eco.ps1 como o webhook faria. Uso: node render-eco.js [nome=valor ...]
const fs = require('fs');
const path = require('path');
const { render } = require('../../lib/render');

const item = {
  slug: 'eco', os: 'windows', arquivo: 'tests/fixtures/eco.ps1',
  parametros: [
    { nome: 'texto', tipo: 'string', obrigatorio: false, regex: '^[ -~]{1,80}$', var: 'Texto' },
    { nome: 'lista', tipo: 'lista', obrigatorio: false, var: 'Lista' },
    { nome: 'porta', tipo: 'int', obrigatorio: false, var: 'Porta' },
    { nome: 'flag', tipo: 'bool', obrigatorio: false, var: 'Flag' },
  ],
};
const query = Object.fromEntries(process.argv.slice(2).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
process.stdout.write(render({ item, query, corpo: fs.readFileSync(path.join(__dirname, 'eco.ps1'), 'utf8') }).script);
