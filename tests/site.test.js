'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://onboarding.exemplo.local/webhook/onboarding';

// Gera o site numa copia temporaria do repo (template + catalogo + script),
// para o teste nao depender de dist/ nem sujar a arvore.
function gerar(env, catalogo) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  fs.mkdirSync(path.join(tmp, 'web'));
  fs.mkdirSync(path.join(tmp, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'web/index.html'), path.join(tmp, 'web/index.html'));
  fs.copyFileSync(path.join(ROOT, 'scripts/build-site.js'), path.join(tmp, 'scripts/build-site.js'));
  fs.writeFileSync(path.join(tmp, 'catalog.json'), catalogo || fs.readFileSync(path.join(ROOT, 'catalog.json')));
  const r = { tmp, out: '', status: 0, stderr: '' };
  try {
    r.out = execFileSync('node', [path.join(tmp, 'scripts/build-site.js'), '--strict'], {
      env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) { r.status = e.status; r.stderr = String(e.stderr); }
  return r;
}
const configDe = (html) => JSON.parse(html.match(/<script id="config" type="application\/json">([\s\S]*?)<\/script>/)[1]);

test('gera index.html com catalogo, tag e URL do webhook', () => {
  const r = gerar({ ONBOARDING_BASE_URL: BASE, SITE_TAG: 'v9.9.9', GITHUB_REPOSITORY: 'dono/repo' });
  assert.strictEqual(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(r.tmp, 'dist/site/index.html'), 'utf8');
  const cfg = configDe(html);
  assert.strictEqual(cfg.base, BASE);
  assert.strictEqual(cfg.tag, 'v9.9.9');
  assert.strictEqual(cfg.repo, 'dono/repo');
  assert.strictEqual(cfg.catalogo.itens.length, JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'))).itens.length);
  assert.ok(fs.existsSync(path.join(r.tmp, 'dist/site/.nojekyll')));
});

test('--strict falha sem ONBOARDING_BASE_URL ou com URL invalida', () => {
  assert.strictEqual(gerar({}).status, 1);
  assert.strictEqual(gerar({ ONBOARDING_BASE_URL: 'http://sem-tls/x' }).status, 1);
  assert.strictEqual(gerar({ ONBOARDING_BASE_URL: BASE + '?a=1' }).status, 1);
  assert.strictEqual(gerar({ ONBOARDING_BASE_URL: "https://x/'; alert(1)//" }).status, 1);
});

test('conteudo do catalogo nao consegue fechar a tag <script>', () => {
  const cat = { versao: 1, itens: [{ slug: 'x', os: 'linux', titulo: '</script><script>alert(1)</script>', categoria: 'Baseline', ordem: 1, descricao: '<b>', arquivo: 'tools/x/linux.sh', sha256: '0', parametros: [] }] };
  const r = gerar({ ONBOARDING_BASE_URL: BASE }, JSON.stringify(cat));
  assert.strictEqual(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(r.tmp, 'dist/site/index.html'), 'utf8');
  assert.strictEqual(html.split('</script>').length, 3, 'apenas as 2 tags </script> do template');
  assert.strictEqual(configDe(html).catalogo.itens[0].titulo, cat.itens[0].titulo);
});
