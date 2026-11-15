# Seguranca

Estes scripts sao executados como Administrador/root nos hosts. Trate cada
mudanca como mudanca de producao.

## O que nunca entra neste repositorio

- Senhas, tokens, chaves, certificados.
- IPs privados, hostnames e dominios internos. Em exemplos use
  `<PLACEHOLDER>`, `*.exemplo.local` ou a faixa de documentacao `192.0.2.0/24`.
- Qualquer valor especifico do ambiente: ele chega por parametro na hora da execucao.

A pagina do catalogo no GitHub Pages e publica. A URL do webhook entra nela
so na hora do deploy, pela variavel `ONBOARDING_BASE_URL`; o webhook deve
continuar acessivel apenas pela rede interna.

A pagina e compilada com dependencias de npm (React, Radix, Tailwind). Elas
ficam travadas em `web/package-lock.json` e sao instaladas com `npm ci`;
atualize-as por pull request, olhando o diff do lockfile.

O CI (`npm run build`) recusa IPs privados, dominios internos e formatos comuns de token.

## Cadeia de entrega

1. Mudanca so entra na `main` por pull request, com CI verde.
2. So uma tag `vX.Y.Z` vira release, e so se a tag estiver na `main`.
3. O servidor de onboarding serve a ultima release e confere o SHA-256 de
   cada script contra o `catalog.json` da mesma tag.

## Envios pelo catalogo

O editor da pagina envia para um webhook interno, que abre o pull request com
uma conta-robo. O robo so escreve no proprio fork, e so dentro de
`tools/<slug>/`; nao faz merge, nao cria tag e nao altera workflows. O CI de
pull requests vindos de fork so roda depois da aprovacao do administrador.

## Reportar um problema

Abra um Security Advisory privado no GitHub (aba Security) em vez de uma issue publica.
