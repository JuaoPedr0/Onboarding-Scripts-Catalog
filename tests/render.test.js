'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { render } = require('../lib/render');
const { gerar } = require('../scripts/build-catalog');

const ROOT = path.resolve(__dirname, '..');
const { catalogo, erros } = gerar();
const item = (slug, os) => catalogo.itens.find((i) => i.slug === slug && i.os === os && i.padrao);
const corpoDe = (i) => fs.readFileSync(path.join(ROOT, i.arquivo), 'utf8');
const bash = (script, args = []) => execFileSync('bash', ['-s', '--', ...args], { input: script, encoding: 'utf8' });

const ECO = {
  slug: 'eco', os: 'linux', arquivo: 'tests/fixtures/eco.sh',
  parametros: [
    { nome: 'texto', tipo: 'string', obrigatorio: false, regex: "^[ -~]{1,80}$", var: 'ECO_TEXTO' },
    { nome: 'lista', tipo: 'lista', obrigatorio: false, var: 'ECO_LISTA_CSV' },
    { nome: 'flag', tipo: 'bool', obrigatorio: false, var: 'ECO_FLAG', aliases: ['f'] },
  ],
};
const ecoSh = fs.readFileSync(path.join(__dirname, 'fixtures/eco.sh'), 'utf8');

test('o repositorio gera um catalogo valido, com uma variante padrao por sistema', () => {
  assert.deepStrictEqual(erros, []);
  assert.ok(catalogo.itens.length > 0);
  for (const i of catalogo.itens) {
    const padroes = catalogo.itens.filter((x) => x.slug === i.slug && x.os === i.os && x.padrao);
    assert.strictEqual(padroes.length, 1, `${i.slug}/${i.os}`);
  }
});

test('todo item do catalogo renderiza sem parametros e mantem o corpo intacto', () => {
  for (const i of catalogo.itens) {
    const corpo = corpoDe(i);
    const r = render({ item: i, query: { script: i.slug, os: i.os }, corpo });
    assert.ok(r.ok, `${i.slug}/${i.os}: ${r.erros.join('; ')}`);
    assert.ok(r.script.includes(corpo.replace(/^#!.*\n/, '').trimEnd()), `${i.slug}/${i.os}: corpo alterado`);
    if (i.os === 'linux') execFileSync('bash', ['-n'], { input: r.script });
  }
});

test('bash: sem parametros valem os defaults do script', () => {
  const r = render({ item: ECO, query: {}, corpo: ecoSh });
  assert.strictEqual(bash(r.script), 'padrao|0|false\n');
});

test('bash: valores da URL chegam ao script, inclusive lista e alias', () => {
  const r = render({ item: ECO, query: { texto: 'ola mundo', lista: 'a,b,a, c', f: 'sim' }, corpo: ecoSh });
  assert.strictEqual(bash(r.script), 'ola mundo|3|true\n');
});

test('bash: aspas e metacaracteres nao escapam do literal', () => {
  const malicioso = `x'; echo PWNED; '$(id)\`id\``;
  const r = render({ item: ECO, query: { texto: malicioso }, corpo: ecoSh });
  assert.ok(r.ok);
  assert.strictEqual(bash(r.script), `${malicioso}|0|false\n`);
});

test('valor invalido nao entrega script: devolve script de erro com exit 1', () => {
  const i = item('zabbix', 'linux');
  const r = render({ item: i, query: { zabbix_server: 'x;rm -rf /', metadata: 'Linux' }, corpo: corpoDe(i) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.script, '');
  assert.throws(() => bash(r.resposta_erro), (e) => e.status === 1 && /zabbix_server/.test(e.stderr));
});

test('tipos: int fora do intervalo, enum e bool invalidos sao recusados', () => {
  const w = item('wazuh', 'linux');
  for (const q of [{ manager_port: '70000' }, { manager_port: '1e3' }, { protocol: 'sctp' }, { force: 'talvez' }, { group: 'ok,nao ok' }]) {
    const r = render({ item: w, query: { manager: 'a.b', ...q }, corpo: corpoDe(w) });
    assert.strictEqual(r.ok, false, JSON.stringify(q));
  }
});

test('obrigatorio ausente e chave desconhecida viram aviso, nao erro', () => {
  const w = item('wazuh', 'windows');
  const r = render({ item: w, query: { script: 'wazuh', os: 'windows', xpto: '1' }, corpo: corpoDe(w) });
  assert.ok(r.ok);
  assert.strictEqual(r.avisos.length, 2);
});

test('powershell: so entra no splat o que veio na URL, com literais tipados', () => {
  const w = item('wazuh', 'windows');
  const r = render({ item: w, query: { manager: "a'b.c", group: 'Windows,Hosts', manager_port: '1600', force: 'true' }, corpo: corpoDe(w) });
  assert.strictEqual(r.ok, false); // aspa nao passa na regex de host
  const ok = render({ item: w, query: { manager: 'wazuh.exemplo.local', group: 'Windows,Hosts', manager_port: '1600', force: 'true' }, corpo: corpoDe(w) });
  const splat = ok.script.slice(ok.script.indexOf('$__onboarding = @{'), ok.script.indexOf('& {'));
  assert.deepStrictEqual(splat.trim().split('\n').map((l) => l.trim()), [
    '$__onboarding = @{', "Manager = 'wazuh.exemplo.local'", "AgentGroup = @('Windows', 'Hosts')",
    'ManagerPort = 1600', 'Force = $true', '}',
  ]);
  assert.ok(ok.script.trimEnd().endsWith('} @__onboarding @args'));
});
