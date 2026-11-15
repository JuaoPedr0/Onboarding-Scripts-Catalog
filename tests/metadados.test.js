'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync, spawnSync } = require('child_process');
const meta = require('../web/src/lib/metadados.ts');
const { render } = require('../lib/render');
const { gerar } = require('../scripts/build-catalog');

const PS = "param(\n    [string]$Manager = '',\n    [string]$Senha = '',\n    [switch]$Force\n)\nWrite-Host ok\n";
const SH = '#!/usr/bin/env bash\nset -euo pipefail\nECO_TEXTO="${ECO_TEXTO:-padrao}"\nECO_SENHA="${ECO_SENHA:-}"\nprintf \'%s|%s\\n\' "$ECO_TEXTO" "$ECO_SENHA"\n';
const comBloco = (script, parameters) => meta.escreverBloco(script, { schemaVersion: 1, parameters });
const erros = (script, os) => meta.validarBloco(meta.lerBloco(script), os, script).filter((d) => d.nivel === 'erro');

test('bloco: escrever e ler devolvem os mesmos parametros, em PowerShell e em Bash', () => {
  const params = [
    { name: 'manager', variable: 'Manager', type: 'host', required: true, description: 'Com "aspas" e acentuação' },
    { name: 'modo', variable: 'Modo', type: 'enum', options: ['a', { value: 'b', description: 'B' }, 'c'] },
  ];
  for (const base of [PS, SH]) {
    const s = comBloco(base, params);
    assert.deepStrictEqual(meta.lerBloco(s).bloco.parameters, params);
    assert.strictEqual(comBloco(s, params), s, 'regravar nao muda o arquivo');
    assert.ok(s.endsWith(base.replace(/^#!.*\n/, '')), 'o corpo do script fica intacto');
  }
  assert.ok(comBloco(SH, params).startsWith('#!/usr/bin/env bash\n# @onboarding:begin\n'), 'no Bash o bloco vem depois do shebang');
  assert.strictEqual(meta.lerBloco(PS).bloco, null);
});

test('bloco invalido e apontado: JSON quebrado, sem fim, sem parameters', () => {
  assert.match(meta.lerBloco('# @onboarding:begin\n# { "parameters": [ }\n# @onboarding:end\n').erro, /JSON/);
  assert.match(meta.lerBloco('# @onboarding:begin\n# {}\n').erro, /@onboarding:end/);
  assert.match(meta.lerBloco('# @onboarding:begin\n# {}\n# @onboarding:end\n').erro, /parameters/);
});

test('cenario A: variavel nova + metadados aparece no catalogo sem tocar no tool.json', () => {
  const s = comBloco(PS, [{ name: 'manager', variable: 'Manager', type: 'host', required: true }, { name: 'force', variable: 'Force', type: 'bool' }]);
  assert.deepStrictEqual(erros(s, 'windows'), []);
  const cat = meta.lerBloco(s).bloco.parameters.map(meta.paraCatalogo);
  assert.deepStrictEqual(cat.map((p) => [p.nome, p.tipo, p.obrigatorio, p.padrao, p.var]), [['manager', 'host', true, null, 'Manager'], ['force', 'bool', false, false, 'Force']]);
  // cenario D: bool vira chave liga/desliga (tipo bool, padrao false)
});

test('cenario B: parametro nos metadados sem variavel no script e erro', () => {
  const e = erros(comBloco(PS, [{ name: 'porta', variable: 'Porta', type: 'int' }]), 'windows');
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0].codigo, 'sem-variavel');
  const sh = erros(comBloco(SH, [{ name: 'x', variable: 'NAO_EXISTE' }]), 'linux');
  assert.strictEqual(sh[0].codigo, 'sem-variavel');
});

test('variavel sem metadados e aviso, nao erro; nada e inventado', () => {
  const s = comBloco(PS, [{ name: 'manager', variable: 'Manager' }]);
  const d = meta.validarBloco(meta.lerBloco(s), 'windows', s);
  assert.deepStrictEqual(d.filter((x) => x.nivel === 'erro'), []);
  assert.deepStrictEqual(d.filter((x) => x.codigo === 'sem-metadados').map((x) => x.variavel), ['Senha', 'Force']);
});

test('cenario C: enum com tres opcoes chega ao catalogo com as tres', () => {
  const [p] = [{ name: 'modo', variable: 'Modo', type: 'enum', options: ['um', 'dois', { value: 'tres', description: 'Terceiro' }] }].map(meta.paraCatalogo);
  assert.deepStrictEqual(p.valores, [{ valor: 'um' }, { valor: 'dois' }, { valor: 'tres', descricao: 'Terceiro' }]);
  assert.match(erros(comBloco(PS, [{ name: 'manager', variable: 'Manager', type: 'enum' }]), 'windows')[0].texto, /options/);
});

test('duplicados, tipo desconhecido, nome reservado e segredo com default sao erros', () => {
  const cod = (params) => erros(comBloco(PS, params), 'windows').map((e) => e.codigo);
  assert.deepStrictEqual(cod([{ name: 'a', variable: 'Manager' }, { name: 'a', variable: 'Senha' }]), ['duplicado']);
  assert.deepStrictEqual(cod([{ name: 'a', variable: 'Manager' }, { name: 'b', variable: 'Manager' }]), ['duplicado']);
  assert.deepStrictEqual(cod([{ name: 'a', variable: 'Manager', type: 'uuid' }]), ['tipo']);
  assert.deepStrictEqual(cod([{ name: 'cred', variable: 'Manager' }]), ['nome']);
  assert.deepStrictEqual(cod([{ name: 'senha', variable: 'Senha', type: 'secret', default: 'abc' }]), ['segredo']);
  assert.deepStrictEqual(cod([{ name: 'senha', variable: 'Senha', sensitive: true }]), ['segredo']);
});

test('variantes: tipo divergente e erro; parametro so em algumas e aviso', () => {
  const d = meta.compararVariantes([
    { rotulo: 'A', os: 'windows', parametros: [{ name: 'x', variable: 'X', type: 'int' }, { name: 'y', variable: 'Y' }] },
    { rotulo: 'B', os: 'windows', parametros: [{ name: 'x', variable: 'X', type: 'string' }] },
  ]);
  assert.deepStrictEqual(d.map((g) => [g.nivel, g.codigo, g.parametro]), [['erro', 'tipo-divergente', 'x'], ['aviso', 'so-em-algumas', 'y']]);
});

test('cenario F: script sem bloco continua usando "parametros" do tool.json', () => {
  const legado = { nome: 'version', tipo: 'string', obrigatorio: false, padrao: '7.4', var: { windows: 'VersionAgent', linux: 'ZABBIX_VERSION' }, porPlataforma: { linux: { regex: '^\\d+\\.\\d+$' } } };
  assert.deepStrictEqual(meta.deLegado(legado, 'linux'), { name: 'version', variable: 'ZABBIX_VERSION', type: 'string', required: false, default: '7.4', regex: '^\\d+\\.\\d+$' });
  assert.strictEqual(meta.deLegado({ nome: 'x', tipo: 'bool', var: { windows: 'X' } }, 'linux'), null);
});

test('repositorio: catalogo valido, e a senha do Wazuh no Windows e um segredo', () => {
  const { catalogo, erros: e } = gerar();
  assert.deepStrictEqual(e, []);
  const w = catalogo.itens.find((i) => i.slug === 'wazuh' && i.os === 'windows');
  const senha = w.parametros.find((p) => p.nome === 'password');
  assert.deepStrictEqual([senha.tipo, senha.sensivel, senha.var, senha.padrao], ['secret', true, 'RegistrationPassword', null]);
  for (const f of ['tools/wazuh/tool.json', 'tools/zabbix/tool.json']) {
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).parametros, undefined, `${f} nao repete os parametros`);
  }
});

const ITEM_SH = { slug: 'eco', os: 'linux', variante: 'padrao', padrao: true, arquivo: 'x.sh', parametros: [
  { nome: 'texto', tipo: 'string', obrigatorio: false, regex: '^[ -~]{1,80}$', var: 'ECO_TEXTO' },
  { nome: 'senha', tipo: 'secret', obrigatorio: false, sensivel: true, var: 'ECO_SENHA' },
] };
const REF = 'a'.repeat(48);

test('cenario G: segredo na URL e recusado e nao aparece na resposta', () => {
  const r = render({ item: ITEM_SH, query: { senha: 'S3gredo!' }, corpo: SH, resgateUrl: 'https://x/resgatar' });
  assert.strictEqual(r.ok, false);
  assert.ok(!JSON.stringify(r).includes('S3gredo!'));
  assert.strictEqual(render({ item: ITEM_SH, query: { cred: 'nao-e-hex' }, corpo: SH, resgateUrl: 'https://x' }).ok, false);
});

test('cenario E (Bash): o script troca a referencia pela senha, uma unica vez, sem a senha passar pela URL', async () => {
  const porta = 39000 + (process.pid % 900);
  const senha = "S3nh@ com 'aspas' $(id) e espaço";
  const servidor = spawn('node', [path.join(__dirname, 'fixtures/servidor-cred.js'), String(porta), REF, `senha=${senha}`]);
  await new Promise((ok) => servidor.stdout.once('data', ok));
  try {
    const r = render({ item: ITEM_SH, query: { texto: 'ola', cred: REF }, corpo: SH, resgateUrl: `http://127.0.0.1:${porta}/resgatar` });
    assert.ok(r.ok, r.erros.join('; '));
    assert.ok(!r.script.includes('S3nh@'), 'o script entregue nao contem a senha');
    assert.strictEqual(execFileSync('bash', ['-s'], { input: r.script, encoding: 'utf8' }), `ola|${senha}\n`);
    const de_novo = spawnSync('bash', ['-s'], { input: r.script, encoding: 'utf8' });
    assert.strictEqual(de_novo.status, 1, 'segunda execucao com a mesma referencia falha');
    assert.match(de_novo.stderr, /expirada ou ja utilizada/);
  } finally {
    servidor.kill();
  }
});

test('cenario E (PowerShell): o resgate entra no splat pela variavel declarada', () => {
  const item = { slug: 'wazuh', os: 'windows', variante: 'padrao', padrao: true, arquivo: 'x.ps1', parametros: [
    { nome: 'manager', tipo: 'host', obrigatorio: true, var: 'Manager' },
    { nome: 'password', tipo: 'secret', obrigatorio: false, sensivel: true, var: 'RegistrationPassword' },
  ] };
  const r = render({ item, query: { manager: 'a.b', cred: REF }, corpo: PS, resgateUrl: 'https://n8n.exemplo.local/webhook/onboarding/credencial/resgatar' });
  assert.ok(r.ok);
  assert.ok(r.script.includes(`Invoke-RestMethod -Method Post -Uri 'https://n8n.exemplo.local/webhook/onboarding/credencial/resgatar'`));
  assert.ok(r.script.includes(`"ref":"${REF}","script":"wazuh","os":"windows","variante":"padrao","formato":"json"`));
  assert.ok(r.script.includes("$__onboarding['RegistrationPassword'] = [string]$__cred.segredos.'password'"));
  assert.ok(r.script.indexOf('Invoke-RestMethod') < r.script.indexOf('& {'), 'o resgate vem antes do corpo');
  const sem = render({ item, query: { manager: 'a.b' }, corpo: PS });
  assert.ok(sem.ok && !sem.script.includes('Invoke-RestMethod'), 'sem cred, nada muda');
});
