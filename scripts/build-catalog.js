#!/usr/bin/env node
'use strict';
// Valida tools/*/tool.json e os scripts, e gera o catalogo: o indice que o
// n8n e a pagina leem, com uma entrada por ferramenta + sistema + variante.
//
//   node scripts/build-catalog.js    valida e grava catalog.json
//
// catalog.json nao e versionado: e gerado aqui e anexado a cada release.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const EXT = { windows: 'ps1', linux: 'sh' };

// Segredos e enderecos internos nao entram em repositorio publico.
const PROIBIDO = [
  [/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/, 'IP privado (use <PLACEHOLDER> ou 192.0.2.x)'],
  [/\bconasa\.com/i, 'dominio interno'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/, 'token'],
];

/** Nome do arquivo de uma variante: windows.ps1, linux.rhel.sh ... */
const arquivoDe = (v) => (v.id === 'padrao' ? `${v.os}.${EXT[v.os]}` : `${v.os}.${v.id}.${EXT[v.os]}`);

// Variaveis declaradas no script, para conferir com "var" do tool.json.
function varsDoScript(os, texto) {
  if (os === 'windows') {
    const m = texto.match(/^param\s*\(([\s\S]*?)^\)/m);
    return new Set(m ? [...m[1].matchAll(/\$([A-Za-z][A-Za-z0-9]*)/g)].map((x) => x[1]) : []);
  }
  return new Set([...texto.matchAll(/"\$\{([A-Z][A-Z0-9_]*):-/g)].map((x) => x[1]));
}

function arquivosDe(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'package-lock.json') return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? arquivosDe(p) : /\.(html|css|tsx?|jsx?|json|svg)$/.test(e.name) ? [p] : [];
  });
}

/** Valida tudo e devolve { catalogo, erros }. */
function gerar() {
  const erros = [];
  const err = (onde, msg) => erros.push(`${onde}: ${msg}`);
  const proibidos = (rel, texto) => texto.split('\n')
    .forEach((l, i) => PROIBIDO.forEach(([re, oque]) => { if (re.test(l)) err(`${rel}:${i + 1}`, oque); }));

  let validarSchema = () => true;
  try {
    const Ajv = require('ajv');
    validarSchema = new Ajv({ allErrors: true, strict: false })
      .compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/tool.schema.json'), 'utf8')));
  } catch (e) {
    if (!process.env.RENDER_QUIET) console.error('[aviso] ajv indisponivel (rode `npm ci`); pulando o JSON Schema, mantendo as checagens proprias.');
  }

  const itens = [];
  const slugs = fs.existsSync(TOOLS)
    ? fs.readdirSync(TOOLS).filter((d) => fs.statSync(path.join(TOOLS, d)).isDirectory()).sort() : [];
  for (const dir of slugs) {
    const onde = `tools/${dir}`;
    let bruto;
    let tool;
    try {
      bruto = fs.readFileSync(path.join(TOOLS, dir, 'tool.json'), 'utf8');
      tool = JSON.parse(bruto);
    } catch (e) { err(onde, `tool.json ausente ou invalido (${e.message})`); continue; }
    if (!validarSchema(tool)) {
      for (const e of validarSchema.errors) err(`${onde}/tool.json`, `${e.instancePath || '/'} ${e.message}`);
      continue;
    }
    proibidos(`${onde}/tool.json`, bruto);
    if (tool.slug !== dir) err(onde, `slug '${tool.slug}' difere do nome da pasta`);

    const sistemas = new Set(tool.variantes.map((v) => v.os));
    const nomes = new Set();
    for (const p of tool.parametros) {
      for (const n of [p.nome, ...(p.aliases || [])]) {
        if (nomes.has(n) || ['script', 'os', 'variante'].includes(n)) err(onde, `nome/alias de parametro repetido ou reservado: ${n}`);
        nomes.add(n);
      }
      if (p.tipo === 'enum' && !(p.valores || []).length) err(onde, `parametro enum '${p.nome}' sem valores`);
      for (const so of Object.keys(p.var)) if (!sistemas.has(so)) err(onde, `parametro '${p.nome}' cita sistema sem variante: ${so}`);
    }

    const esperados = new Set(['tool.json']);
    const vistos = new Set();
    for (const v of tool.variantes) {
      const chave = `${v.os}/${v.id}`;
      if (vistos.has(chave)) { err(onde, `variante repetida: ${chave}`); continue; }
      const padrao = ![...vistos].some((c) => c.startsWith(v.os + '/'));
      vistos.add(chave);
      const nome = arquivoDe(v);
      esperados.add(nome);
      const rel = `tools/${dir}/${nome}`;
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) { err(onde, `arquivo nao encontrado: ${nome} (variante ${chave})`); continue; }
      const buf = fs.readFileSync(abs);
      const texto = buf.toString('utf8');
      if (texto.includes('\r')) err(rel, 'contem CRLF; os scripts usam LF');
      if (texto.includes('@@')) err(rel, 'contem @@placeholder@@; use parametros nativos');
      if (v.os === 'linux' && !texto.startsWith('#!')) err(rel, 'sem shebang');
      proibidos(rel, texto);
      const declaradas = varsDoScript(v.os, texto);
      const parametros = [];
      for (const p of tool.parametros) {
        if (!p.var[v.os]) continue;
        if (!declaradas.has(p.var[v.os])) err(rel, `variavel '${p.var[v.os]}' (parametro '${p.nome}') nao declarada no bloco de parametros`);
        const { var: variavel, porPlataforma, ...resto } = p;
        const final = { ...resto, ...((porPlataforma || {})[v.os] || {}), var: variavel[v.os] };
        if (final.regex) { try { new RegExp(final.regex); } catch (e) { err(onde, `regex invalida em '${p.nome}'`); } }
        parametros.push(final);
      }
      if (tool.ativo) {
        itens.push({
          slug: tool.slug, os: v.os, variante: v.id, rotulo: v.rotulo, padrao,
          titulo: tool.titulo, categoria: tool.categoria, ordem: tool.ordem,
          descricao: v.descricao, arquivo: rel,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          parametros,
        });
      }
    }
    // Arquivo que nenhuma variante usa e sobra: script esquecido ou nome fora da convencao.
    for (const f of fs.readdirSync(path.join(TOOLS, dir))) {
      if (!esperados.has(f)) err(onde, `arquivo sem variante correspondente: ${f}`);
    }
  }

  // A pagina do catalogo e publica: o mesmo filtro vale para o codigo de web/.
  for (const abs of arquivosDe(path.join(ROOT, 'web'))) {
    proibidos(path.relative(ROOT, abs).split(path.sep).join('/'), fs.readFileSync(abs, 'utf8'));
  }

  const ordemSo = { windows: 0, linux: 1 };
  itens.sort((a, b) => a.ordem - b.ordem || a.slug.localeCompare(b.slug) || ordemSo[a.os] - ordemSo[b.os] || (b.padrao - a.padrao));
  return { catalogo: { versao: 2, itens }, erros };
}

module.exports = { gerar, arquivoDe, PROIBIDO };

if (require.main === module) {
  const { catalogo, erros } = gerar();
  if (erros.length) {
    console.error(`${erros.length} problema(s):\n` + erros.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }
  fs.writeFileSync(path.join(ROOT, 'catalog.json'), JSON.stringify(catalogo, null, 2) + '\n');
  console.log(`ok: ${catalogo.itens.length} itens validos; catalog.json gerado.`);
}
