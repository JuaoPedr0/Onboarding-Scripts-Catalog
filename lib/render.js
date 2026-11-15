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
    case 'secret': {
      // Nunca devolve o valor na mensagem de erro.
      const v = String(unico(bruto));
      return v.length >= 1 && v.length <= 512 && !/[\u0000-\u001f\u007f]/.test(v)
        ? { valor: v } : { erro: `'${def.nome}' invalido: use ate 512 caracteres, sem quebras de linha` };
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
 * @param {string} [a.resgateUrl] endpoint que troca ?cred= pelos segredos (uso unico)
 * @param {string} [a.agora] ISO timestamp (injetavel para teste)
 */
function render({ item, query = {}, corpo, release = '', catalogoUrl = '', resgateUrl = '', agora }) {
  const os = String(item.os || '').toLowerCase();
  const isWin = os === 'windows';
  const defs = Array.isArray(item.parametros) ? item.parametros : [];
  const erros = [];
  const avisos = [];
  const valores = []; // [{ def, valor }]

  const segredos = defs.filter((d) => d.tipo === 'secret');
  for (const def of defs) {
    if (def.tipo === 'secret') {
      // Segredo nunca viaja na URL: chega por credencial temporaria (?cred=).
      if ([def.nome, ...(def.aliases || [])].some((k) => query[k] !== undefined)) {
        erros.push(`'${def.nome}' e um dado sensivel e nao pode vir na URL; preencha o campo no catalogo`);
      }
      continue;
    }
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

  // Credencial temporaria: referencia de uso unico emitida pelo catalogo.
  const cred = query.cred === undefined || query.cred === null ? '' : String(query.cred).trim();
  if (cred && !/^[a-f0-9]{32,96}$/.test(cred)) erros.push("'cred' invalida; gere um novo comando no catalogo");
  if (cred && segredos.length && !resgateUrl) erros.push('resgate de credenciais nao configurado no servidor');
  const resgatar = !!cred && segredos.length > 0;
  for (const def of segredos) {
    if (def.obrigatorio && !resgatar) avisos.push(`parametro sensivel '${def.nome}' nao veio; preencha no catalogo ou informe na chamada`);
  }

  const conhecidas = new Set(['script', 'os', 'variante', 'cred']);
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

  // Pedido de resgate: o host troca a referencia pelos segredos numa chamada
  // HTTPS propria. O segredo nao passa por este script nem pela URL.
  const pedido = (formato) => JSON.stringify({
    ref: cred, script: item.slug, os, variante: item.variante || 'padrao', formato,
  });
  const falhaCred = '[ERRO] Onboarding: credencial temporaria expirada ou ja utilizada. Gere um novo comando no catalogo.';

  let script;
  if (isWin) {
    const pares = valores.map(({ def, valor }) => `    ${def.var} = ${litPs(valor)}`);
    const resgate = !resgatar ? [] : [
      'try {',
      `    $__cred = Invoke-RestMethod -Method Post -Uri ${psStr(resgateUrl)} -ContentType 'application/json' -Body ${psStr(pedido('json'))}`,
      '} catch {',
      `    Write-Host ${psStr(falhaCred)} -ForegroundColor Red`,
      '    $global:OnboardingExitCode = 1',
      '    return',
      '}',
      ...segredos.map((d) => `if ($__cred.segredos.${psStr(d.nome)}) { $__onboarding[${psStr(d.var)}] = [string]$__cred.segredos.${psStr(d.nome)} }`),
      'Remove-Variable __cred',
    ];
    script = [
      ...cab,
      '$__onboarding = @{', ...pares, '}',
      ...resgate,
      '& {',
      String(corpo).replace(/\s+$/, ''),
      '} @__onboarding @args',
      '',
    ].join('\n');
  } else {
    const atrib = valores.map(({ def, valor }) => `${def.var}=${litSh(valor)}`);
    const resgate = !resgatar ? [] : [
      `__ob_cred="$(curl -fsS -X POST -H 'Content-Type: application/json' --data ${shStr(pedido('linhas'))} ${shStr(resgateUrl)})" || { echo ${shStr(falhaCred)} >&2; exit 1; }`,
      "while IFS='=' read -r __ob_k __ob_v; do",
      '  case "$__ob_k" in',
      ...segredos.map((d) => `    ${d.nome}) ${d.var}="$(printf '%s' "$__ob_v" | base64 -d)" ;;`),
      '  esac',
      'done <<< "$__ob_cred"',
      'unset __ob_cred __ob_k __ob_v',
    ];
    const bloco = [...cab, ...atrib, ...resgate, ''].join('\n');
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
