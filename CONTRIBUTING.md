# Como contribuir

## Preparar

```
npm ci
```

## Alterar um script

1. Crie um branch e edite `tools/<slug>/windows.ps1` ou `linux.sh`.
2. Rode localmente:
   ```
   npm run build     # valida tool.json e regenera catalog.json
   npm test          # motor de renderizacao
   shellcheck tools/*/*.sh
   pwsh tests/ps-check.ps1
   ```
3. Veja o que o host receberia:
   ```
   npm run -s render -- wazuh linux manager=wazuh.exemplo.local group=Linux | less
   ```
4. Mudou a pagina (`web/index.html`)? Gere e abra no navegador:
   ```
   npm run site      # grava dist/site/index.html
   ```
5. Abra o pull request. O `catalog.json` regenerado vai no mesmo commit.

## Adicionar uma ferramenta

1. Crie `tools/<slug>/` com `tool.json` e um script por SO.
2. Declare os parametros no bloco de parametros do script (regras abaixo) e em `tool.json`.
3. `npm run build`, teste, pull request.

## Regras dos scripts

- O script roda sozinho, sem o webhook. Nada de `@@placeholders@@`.
- **PowerShell**: `param()` no topo, com defaults nativos. Booleanos sao `[switch]`.
  Nao use `exit`: o script e executado via `[ScriptBlock]::Create()` e `exit`
  fecharia o console de quem chamou. Sinalize por `$global:OnboardingExitCode`.
- **Bash**: cada parametro e uma variavel de ambiente com default,
  `VAR="${VAR:-padrao}"`. Listas chegam em CSV numa variavel `*_CSV`.
  Booleanos sao `true`/`false`.
- O nome da variavel em `tool.json` (`var.windows` / `var.linux`) tem de existir no script; o CI confere.
- Sem interacao (`Read-Host`, `read`): os scripts rodam em automacao.
- Idempotentes: rodar duas vezes nao pode quebrar o host.

## Publicar

```
git tag v1.2.3 && git push origin v1.2.3
```

A release so e criada se o CI passar e a tag estiver na `main`. A partir dai
o webhook passa a servir essa versao e a pagina do GitHub Pages e regerada.
Para regerar so a pagina (ex.: mudou `ONBOARDING_BASE_URL`): Actions → Pages →
Run workflow. Para voltar atras, fixe a release
anterior no n8n ou publique uma nova tag corrigida.

Versao: `MAJOR` quando um parametro e removido ou muda de significado,
`MINOR` para ferramenta ou parametro novo, `PATCH` para correcao.
