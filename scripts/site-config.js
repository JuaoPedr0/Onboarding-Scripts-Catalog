'use strict';
// Dados que a pagina do catalogo recebe no bloco <script id="config">.
// Usado por scripts/build-site.js (producao) e por web/vite.config.ts (dev).
const { gerar } = require('./build-catalog');

const RE_BASE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~/-]*$/;
const RE_BLOCO = /(<script id="config" type="application\/json">)[\s\S]*?(<\/script>)/;

function catalogoValido() {
  const { catalogo, erros } = gerar();
  if (erros.length) throw new Error('Catalogo invalido:\n' + erros.map((e) => '  - ' + e).join('\n'));
  return catalogo;
}

/**
 * Monta a configuracao a partir do ambiente. Lanca erro se a URL do webhook
 * for invalida ou, com strict, se estiver ausente.
 *   ONBOARDING_BASE_URL    URL do webhook de onboarding
 *   ONBOARDING_SUBMIT_URL      webhook que recebe envios do editor (padrao: .../onboarding/envio)
 *   ONBOARDING_CREDENTIAL_URL  webhook que guarda segredos temporarios (padrao: .../onboarding/credencial)
 *   SITE_TAG             tag da release publicada (padrao: "local")
 *   SITE_PUBLICADO       data ISO da release (opcional)
 *   GITHUB_REPOSITORY    owner/repo (o Actions define sozinho)
 */
function montarConfig(env, { strict = false, catalogo } = {}) {
  const base = (env.ONBOARDING_BASE_URL || '').trim();
  if (strict && !base) {
    throw new Error('ONBOARDING_BASE_URL vazia. Defina a variavel do repositorio em Settings → Secrets and variables → Actions → Variables.');
  }
  if (base && !RE_BASE.test(base)) {
    throw new Error(`ONBOARDING_BASE_URL invalida: ${base} (esperado https://host/caminho, sem query string)`);
  }
  // Os outros webhooks ficam ao lado do de entrega, em .../onboarding/<nome>,
  // qualquer que seja o caminho do de entrega (onboarding ou onboarding-v2).
  const vizinho = (nome) => (base ? base.replace(/\/[^/]*\/?$/, '') + '/onboarding/' + nome : '');
  const envio = (env.ONBOARDING_SUBMIT_URL || '').trim() || vizinho('envio');
  const credencial = (env.ONBOARDING_CREDENTIAL_URL || '').trim() || vizinho('credencial');
  if (envio && !RE_BASE.test(envio)) throw new Error(`ONBOARDING_SUBMIT_URL invalida: ${envio}`);
  if (credencial && !RE_BASE.test(credencial)) throw new Error(`ONBOARDING_CREDENTIAL_URL invalida: ${credencial}`);
  return {
    repo: env.GITHUB_REPOSITORY || 'JuaoPedr0/Onboarding-Scripts-Catalog',
    tag: env.SITE_TAG || 'local',
    publicado: env.SITE_PUBLICADO || '',
    base: base || 'https://SEU-N8N/webhook/onboarding',
    envio,
    credencial,
    catalogo: catalogo || catalogoValido(),
  };
}

/** Troca o conteudo do bloco #config do HTML pela configuracao. */
function injetar(html, config) {
  if (!RE_BLOCO.test(html)) throw new Error('HTML sem o bloco <script id="config" type="application/json">.');
  // "<" escapado: nenhum valor do catalogo consegue fechar a tag <script>.
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return html.replace(RE_BLOCO, (_, abre, fecha) => abre + json + fecha);
}

module.exports = { montarConfig, injetar };
