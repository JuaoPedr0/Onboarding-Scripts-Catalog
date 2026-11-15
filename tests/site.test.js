'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { montarConfig, injetar } = require('../scripts/site-config');
const { validar } = require('../lib/render');
const { gerar } = require('../scripts/build-catalog');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://onboarding.exemplo.local/webhook/onboarding';
const template = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
const { catalogo } = gerar();
const configDe = (html) => JSON.parse(html.match(/<script id="config" type="application\/json">([\s\S]*?)<\/script>/)[1]);

test('config leva catalogo, tag, repositorio e URL do webhook para a pagina', () => {
  const cfg = montarConfig({ ONBOARDING_BASE_URL: BASE, SITE_TAG: 'v9.9.9', GITHUB_REPOSITORY: 'dono/repo' }, { strict: true });
  const lido = configDe(injetar(template, cfg));
  assert.strictEqual(lido.base, BASE);
  assert.strictEqual(lido.tag, 'v9.9.9');
  assert.strictEqual(lido.repo, 'dono/repo');
  assert.strictEqual(lido.catalogo.itens.length, catalogo.itens.length);
});

test('strict recusa URL do webhook ausente; URL invalida e recusada sempre', () => {
  assert.throws(() => montarConfig({}, { strict: true }), /ONBOARDING_BASE_URL vazia/);
  assert.doesNotThrow(() => montarConfig({}, { strict: false }));
  for (const url of ['http://sem-tls/x', BASE + '?a=1', "https://x/'; alert(1)//", 'https://x/<script>']) {
    assert.throws(() => montarConfig({ ONBOARDING_BASE_URL: url }), /invalida/, url);
  }
});

test('conteudo do catalogo nao consegue fechar a tag <script>', () => {
  const cat = { versao: 1, itens: [{ slug: 'x', os: 'linux', titulo: '</script><script>alert(1)</script>', categoria: 'Baseline', ordem: 1, descricao: '<b>', arquivo: 'tools/x/linux.sh', sha256: '0', parametros: [] }] };
  const html = injetar(template, montarConfig({ ONBOARDING_BASE_URL: BASE }, { catalogo: cat }));
  assert.strictEqual(html.split('</script>').length, template.split('</script>').length, 'nenhuma tag </script> a mais');
  assert.strictEqual(configDe(html).catalogo.itens[0].titulo, cat.itens[0].titulo);
});

// A pagina valida os campos com um port em TypeScript do motor do n8n.
// Aqui as duas implementacoes respondem aos mesmos casos e tem de concordar.
test('validacao da pagina e identica a do motor (lib/render.js)', async () => {
  const { validar: validarWeb } = await import('../web/src/lib/validar.ts');
  const amostras = [
    'a', 'a.b', 'srv-01.exemplo.local', '192.0.2.10', 'fe80::1', '-x', 'x-', 'a b', "x'y", 'x;rm -rf /', '$(id)', 'http://x',
    '0', '1', '1514', '65535', '65536', '99999', '-1', '1.5', '1e3', '0007', '9999999999',
    'true', 'TRUE', 'sim', 'nao', 'não', 'on', 'off', 'talvez', '1 ',
    'tcp', 'UDP', 'sctp', 'latest', '4.9.2', '4.9.2-1', '7.4', '7.4.13', 'v7',
    'a,b', 'a, b ,a', 'a,,b', 'ok,nao ok', 'Windows,Hosts_HyperV', '7zip.7zip,Notepad++.Notepad++', 'America/Sao_Paulo',
    'x'.repeat(129), 'x'.repeat(300), ' ', ['a', 'b'], ['a,b', 'c'], ['ok', 'n ok'],
  ];
  const defs = catalogo.itens.flatMap((i) => i.parametros);
  defs.push({ nome: 'sem_regex', tipo: 'string' }, { nome: 'lista_livre', tipo: 'lista' }, { nome: 'tipo_novo', tipo: 'uuid' }, { nome: 'sem_tipo' });
  let casos = 0;
  for (const def of defs) {
    for (const bruto of amostras) {
      assert.deepStrictEqual(validarWeb(def, bruto), validar(def, bruto), `${def.nome} (${def.tipo}) <- ${JSON.stringify(bruto)}`);
      casos++;
    }
  }
  assert.ok(casos > 1000, `casos comparados: ${casos}`);
});
