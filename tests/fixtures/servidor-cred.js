'use strict';
// Servidor de resgate de mentira, para os testes de credencial temporaria.
// Aceita cada referencia uma unica vez, como o workflow do n8n.
//   node servidor-cred.js <porta> <ref> <nome=valor> [nome=valor ...]
const http = require('http');
const [porta, ref, ...pares] = process.argv.slice(2);
const segredos = Object.fromEntries(pares.map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
let usada = false;
http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => { corpo += c; });
  req.on('end', () => {
    let pedido = {};
    try { pedido = JSON.parse(corpo); } catch (e) { /* pedido invalido */ }
    if (req.method !== 'POST' || pedido.ref !== ref || usada) { res.writeHead(410); res.end('{"ok":false}'); return; }
    usada = true;
    if (pedido.formato === 'linhas') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(Object.entries(segredos).map(([k, v]) => `${k}=${Buffer.from(v, 'utf8').toString('base64')}`).join('\n') + '\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, segredos }));
    }
  });
}).listen(Number(porta), '127.0.0.1', () => console.log('pronto'));
