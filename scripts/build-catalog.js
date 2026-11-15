#!/usr/bin/env node
'use strict';
// Valida tools/*/tool.json e gera catalog.json (o indice que o n8n le).
//   node scripts/build-catalog.js           gera/atualiza catalog.json
//   node scripts/build-catalog.js --check   falha se catalog.json estiver desatualizado
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const OUT = path.join(ROOT, 'catalog.json');
const erros = [];
const err = (onde, msg) => erros.push(`${onde}: ${msg}`);

let validarSchema = () => true;
try {
  const Ajv = require('ajv');
  const ajv = new Ajv({ allErrors: true, strict: false });
  validarSchema = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/tool.schema.json'), 'utf8')));
} catch (e) {
  console.error('[aviso] ajv indisponivel (rode `npm ci`); pulando o JSON Schema, mantendo as checagens proprias.');
}

// Segredos e enderecos internos nao entram em repositorio publico.
const PROIBIDO = [
  [/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/, 'IP privado (use <PLACEHOLDER> ou 192.0.2.x)'],
  [/\bconasa\.com/i, 'dominio interno'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/, 'token'],
];

// Variaveis declaradas no script, para conferir com "var" do tool.json.
function varsDoScript(os, texto) {
  if (os === 'windows') {
    const m = texto.match(/^param\s*\(([\s\S]*?)^\)/m);
    return new Set(m ? [...m[1].matchAll(/\$([A-Za-z][A-Za-z0-9]*)/g)].map((x) => x[1]) : []);
  }
  return new Set([...texto.matchAll(/"\$\{([A-Z][A-Z0-9_]*):-/g)].map((x) => x[1]));
}

const itens = [];
const slugs = fs.readdirSync(TOOLS).filter((d) => fs.statSync(path.join(TOOLS, d)).isDirectory()).sort();
for (const dir of slugs) {
  const onde = `tools/${dir}`;
  let tool;
  try { tool = JSON.parse(fs.readFileSync(path.join(TOOLS, dir, 'tool.json'), 'utf8')); }
  catch (e) { err(onde, `tool.json ausente ou invalido (${e.message})`); continue; }
  if (!validarSchema(tool)) {
    for (const e of validarSchema.errors) err(`${onde}/tool.json`, `${e.instancePath || '/'} ${e.message}`);
    continue;
  }
  if (tool.slug !== dir) err(onde, `slug '${tool.slug}' difere do nome da pasta`);
  const nomes = new Set();
  for (const p of tool.parametros) {
    for (const n of [p.nome, ...(p.aliases || [])]) {
      if (nomes.has(n) || n === 'script' || n === 'os') err(onde, `nome/alias de parametro repetido ou reservado: ${n}`);
      nomes.add(n);
    }
    if (p.tipo === 'enum' && !(p.valores || []).length) err(onde, `parametro enum '${p.nome}' sem valores`);
    for (const so of Object.keys(p.var)) if (!tool.plataformas[so]) err(onde, `parametro '${p.nome}' cita SO sem plataforma: ${so}`);
  }
  for (const [os, plat] of Object.entries(tool.plataformas)) {
    const rel = `tools/${dir}/${plat.arquivo}`;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { err(onde, `arquivo nao encontrado: ${plat.arquivo}`); continue; }
    const buf = fs.readFileSync(abs);
    const texto = buf.toString('utf8');
    if (texto.includes('\r')) err(rel, 'contem CRLF; os scripts usam LF');
    if (texto.includes('@@')) err(rel, 'contem @@placeholder@@; use parametros nativos');
    if (os === 'linux' && !texto.startsWith('#!')) err(rel, 'sem shebang');
    texto.split('\n').forEach((l, i) => PROIBIDO.forEach(([re, oque]) => { if (re.test(l)) err(`${rel}:${i + 1}`, oque); }));
    const declaradas = varsDoScript(os, texto);
    const parametros = [];
    for (const p of tool.parametros) {
      if (!p.var[os]) continue;
      if (!declaradas.has(p.var[os])) err(rel, `variavel '${p.var[os]}' (parametro '${p.nome}') nao declarada no bloco de parametros`);
      const { var: v, porPlataforma, ...resto } = p;
      const final = { ...resto, ...((porPlataforma || {})[os] || {}), var: v[os] };
      if (final.regex) { try { new RegExp(final.regex); } catch (e) { err(onde, `regex invalida em '${p.nome}'`); } }
      parametros.push(final);
    }
    if (tool.ativo) {
      itens.push({
        slug: tool.slug, os, titulo: tool.titulo, categoria: tool.categoria, ordem: tool.ordem,
        descricao: plat.descricao, arquivo: rel,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        parametros,
      });
    }
  }
}
JSON.stringify(slugs.map((s) => fs.readFileSync(path.join(TOOLS, s, 'tool.json'), 'utf8'))).split('\\n')
  .forEach((l) => PROIBIDO.forEach(([re, oque]) => { if (re.test(l)) err('tool.json', `${oque}: ${l.trim().slice(0, 60)}`); }));

// A pagina do catalogo e publica: o mesmo filtro vale para web/.
for (const f of fs.existsSync(path.join(ROOT, 'web')) ? fs.readdirSync(path.join(ROOT, 'web')) : []) {
  fs.readFileSync(path.join(ROOT, 'web', f), 'utf8').split('\n')
    .forEach((l, i) => PROIBIDO.forEach(([re, oque]) => { if (re.test(l)) err(`web/${f}:${i + 1}`, oque); }));
}

if (erros.length) {
  console.error(`${erros.length} problema(s):\n` + erros.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}

itens.sort((a, b) => a.ordem - b.ordem || a.slug.localeCompare(b.slug) || a.os.localeCompare(b.os));
const saida = JSON.stringify({ versao: 1, itens }, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const atual = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (atual !== saida) {
    console.error('catalog.json desatualizado. Rode `npm run build` e inclua o arquivo no commit.');
    process.exit(1);
  }
  console.log(`ok: ${itens.length} itens, catalog.json em dia.`);
} else {
  fs.writeFileSync(OUT, saida);
  console.log(`catalog.json gerado: ${itens.length} itens.`);
}
