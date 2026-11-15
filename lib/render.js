'use strict';
// ============================================================
// Motor de renderizacao do onboarding.
//
// Implementacao de referencia do que o n8n faz no no "Resolver
// parametros": valida a query string contra os parametros do
// catalogo e monta o script final, SEM alterar o corpo do script.
//
//   PowerShell: o corpo vira um scriptblock chamado com splatting
//               (so os parametros que vieram na URL) + @args.
//   Bash      : atribuicoes VAR='valor' logo apos o shebang.
//
// Funcao pura, sem dependencias: o Code node do n8n usa este mesmo
// codigo. Mudou aqui, rode `npm test` e atualize o no.
// ============================================================

const RE_PADRAO = /^[A-Za-z0-9._-]{1,128}$/;
const RE_HOST = /^[A-Za-z0-9]([A-Za-z0-9._:-]{0,251}[A-Za-z0-9])?$/;
const VERDADE = ['1', 'true', 'yes', 'sim', 'on'];
const FALSO = ['0', 'false', 'no', 'nao', 'não', 'off'];

const psStr = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const shStr = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
const curto = (v) => { const s = String(v); return s.length > 60 ? s.slice(0, 60) + '...' : s; };

// Valida um parametro. Retorna { valor } (JS nativo) ou { erro }.
function validar(def, bruto) {
  const unico = (v) => (Array.isArray(v) ? v[v.length - 1] : v);
  const regexDe = () => (def.regex ? new RegExp(def.regex) : RE_PADRAO);
  switch (def.tipo || 'string') {
    case 'string':
    case 'host': {
      const v = String(unico(bruto)).trim();
      const re = def.tipo === 'host' ? RE_HOST : regexDe();
      return re.test(v) ? { valor: v } : { erro: `'${def.nome}' invalido: ${curto(v)}` };
    }
    case 'enum': {
      const opcoes = (def.valores || []).map((o) => String(o.valor));
      const v = String(unico(bruto)).trim().toLowerCase();
      const achado = opcoes.find((o) => o.toLowerCase() === v);
      return achado !== undefined ? { valor: achado }
        : { erro: `'${def.nome}' invalido: ${curto(v)} (use ${opcoes.join(' ou ')})` };
    }
    case 'int': {
      const v = String(unico(bruto)).trim();
      if (!/^\d{1,9}$/.test(v)) return { erro: `'${def.nome}' deve ser numero inteiro: ${curto(v)}` };
      const n = Number.parseInt(v, 10);
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
        return { erro: `'${def.nome}' fora do intervalo ${def.min ?? '-inf'}..${def.max ?? '+inf'}: ${n}` };
      }
      return { valor: n };
    }
    case 'bool': {
      const v = String(unico(bruto)).trim().toLowerCase();
      if (VERDADE.includes(v)) return { valor: true };
      if (FALSO.includes(v)) return { valor: false };
      return { erro: `'${def.nome}' deve ser true ou false: ${curto(v)}` };
    }
    case 'lista': {
      const itens = [...new Set((Array.isArray(bruto) ? bruto : [bruto])
        .flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean))];
      const re = regexDe();
      const ruins = itens.filter((x) => !re.test(x));
      return ruins.length ? { erro: `'${def.nome}' com item invalido: ${ruins.map(curto).join(', ')}` }
        : { valor: itens };
    }
    default:
      return { erro: `catalogo: tipo desconhecido '${def.tipo}' no parametro '${def.nome}'` };
  }
}

const litPs = (v) => (Array.isArray(v) ? '@(' + v.map(psStr).join(', ') + ')'
  : typeof v === 'boolean' ? (v ? '$true' : '$false')
  : typeof v === 'number' ? String(v) : psStr(v));

const litSh = (v) => shStr(Array.isArray(v) ? v.join(',') : String(v));

function scriptDeErro(os, linhas) {
  return os === 'windows'
    ? linhas.map((l) => `Write-Host ${psStr(l)} -ForegroundColor Red`).join('\n') + '\n$global:OnboardingExitCode = 1\n'
    : linhas.map((l) => `echo ${shStr(l)} >&2`).join('\n') + '\nexit 1\n';
}

/**
 * @param {object} a
 * @param {object} a.item    entrada do catalogo (slug, os, variante, arquivo, parametros[])
 * @param {object} a.query   query string do webhook
 * @param {string} a.corpo   conteudo do script, como esta no repositorio
 * @param {string} [a.release] tag da release servida (vai no cabecalho)
 * @param {string} [a.catalogoUrl] URL do catalogo (vai na mensagem de erro)
 * @param {string} [a.agora] ISO timestamp (injetavel para teste)
 */
function render({ item, query = {}, corpo, release = '', catalogoUrl = '', agora }) {
  const os = String(item.os || '').toLowerCase();
  const isWin = os === 'windows';
  const defs = Array.isArray(item.parametros) ? item.parametros : [];
  const erros = [];
  const avisos = [];
  const valores = []; // [{ def, valor }]

  for (const def of defs) {
    let bruto;
    for (const chave of [def.nome, ...(def.aliases || [])]) {
      const v = query[chave];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) ? v.length === 0 : String(v).trim() === '') continue;
      bruto = v;
      break;
    }
    if (bruto === undefined) {
      if (def.obrigatorio && (def.padrao === null || def.padrao === undefined)) {
        avisos.push(`parametro obrigatorio '${def.nome}' nao veio na URL; informe na chamada`);
      }
      continue; // ausente: vale o default nativo do script
    }
    let r;
    try { r = validar(def, bruto); } catch (e) { r = { erro: `catalogo: regex invalida no parametro '${def.nome}'` }; }
    if (r.erro) erros.push(r.erro); else valores.push({ def, valor: r.valor });
  }

  const conhecidas = new Set(['script', 'os', 'variante']);
  defs.forEach((d) => [d.nome, ...(d.aliases || [])].forEach((n) => conhecidas.add(n)));
  Object.keys(query).filter((k) => !conhecidas.has(k)).forEach((k) => avisos.push(
    `parametro '${k.replace(/[^A-Za-z0-9_.-]/g, '?').slice(0, 40)}' nao existe para este script e foi ignorado`));

  if (!String(corpo || '').trim()) erros.push('script vazio no repositorio');

  if (erros.length) {
    const linhas = [
      `[ERRO] Onboarding: nao foi possivel montar o script '${item.slug}' (${os}).`,
      ...erros.map((e) => '  - ' + e),
      ...(catalogoUrl ? [`  Veja os parametros aceitos em ${catalogoUrl}`] : []),
    ];
    return { ok: false, script: '', resposta_erro: scriptDeErro(os, linhas), erros, avisos };
  }

  const cab = [
    '# ------------------------------------------------------------',
    `# Onboarding - script=${item.slug} os=${os}` + (item.variante && !item.padrao ? ` variante=${item.variante}` : '') + (release ? ` release=${release}` : ''),
    `# Fonte: ${item.arquivo}  sha256=${item.sha256 || '-'}`,
    `# Gerado em ${agora || new Date().toISOString()}. Nao editar no host.`,
    ...(avisos.length ? ['#', '# AVISOS:', ...avisos.map((a) => '#   - ' + a.replace(/[\r\n]/g, ' '))] : []),
    '# ------------------------------------------------------------',
  ];

  let script;
  if (isWin) {
    const pares = valores.map(({ def, valor }) => `    ${def.var} = ${litPs(valor)}`);
    script = [
      ...cab,
      '$__onboarding = @{', ...pares, '}',
      '& {',
      String(corpo).replace(/\s+$/, ''),
      '} @__onboarding @args',
      '',
    ].join('\n');
  } else {
    const atrib = valores.map(({ def, valor }) => `${def.var}=${litSh(valor)}`);
    const bloco = [...cab, ...atrib, ''].join('\n');
    const c = String(corpo);
    if (c.startsWith('#!')) {
      const i = c.indexOf('\n');
      script = c.slice(0, i + 1) + bloco + c.slice(i + 1);
    } else {
      script = bloco + c;
    }
  }
  return { ok: true, script, resposta_erro: '', erros, avisos };
}

module.exports = { render, validar };
