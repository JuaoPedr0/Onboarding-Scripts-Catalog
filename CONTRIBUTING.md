# Como contribuir

## Preparar

```
npm ci                 # catalogo, motor e testes
npm ci --prefix web    # so para mexer na pagina do catalogo
```

## Alterar um script

1. Crie um branch e edite `tools/<slug>/windows.ps1` ou `linux.sh`.
2. Rode localmente:
   ```
   npm run build     # valida tool.json, os blocos # @onboarding e os scripts (gera catalog.json, nao versionado)
   npm test          # motor de renderizacao, metadados e credencial temporaria
   shellcheck tools/*/*.sh
   pwsh tests/ps-check.ps1
   ```
3. Veja o que o host receberia:
   ```
   npm run -s render -- wazuh linux manager=wazuh.exemplo.local group=Linux | less
   ```
4. Mudou a pagina (`web/`)? Veja ao vivo, com recarga automatica:
   ```
   npm run site:dev   # abre em http://localhost:5173 com o catalog.json local
   npm run site       # gera a versao final em dist/site
   ```
   Os componentes em `web/src/components/ui/` vem do shadcn/ui; a tela em si
   esta em `web/src/components/`. Se mudar `web/src/lib/validar.ts`, mude
   tambem `validar` em `lib/render.js`: um teste compara os dois. Mudou
   `lib/render.js`? Cole a nova versao no no "Resolver parametros" do n8n.
5. Abra o pull request.

## Adicionar uma ferramenta

1. Crie `tools/<slug>/` com `tool.json` e um script por variante
   (`windows.ps1`, `linux.sh`, `linux.rhel.sh`...). Pelo editor da pagina
   isso sai pronto, como pull request.
2. Declare os parametros no bloco `# @onboarding` de cada script (veja o README). O `tool.json` nao lista parametros.
3. `npm run build`, teste, pull request.

## Regras dos scripts

- O script roda sozinho, sem o webhook. Nada de `@@placeholders@@`.
- **PowerShell**: `param()` no topo, com defaults nativos. Booleanos sao `[switch]`.
  Nao use `exit`: o script e executado via `[ScriptBlock]::Create()` e `exit`
  fecharia o console de quem chamou. Sinalize por `$global:OnboardingExitCode`.
- **Bash**: cada parametro e uma variavel de ambiente com default,
  `VAR="${VAR:-padrao}"`. Listas chegam em CSV numa variavel `*_CSV`.
  Booleanos sao `true`/`false`.
- Todo parametro do bloco `# @onboarding` aponta para uma variavel que o script declara (`param( )` ou `VAR="${VAR:-}"`); o CI confere, variante por variante.
- Senhas e tokens sao `"type": "secret"`, sem `default` nem `example`. O script recebe o valor como qualquer outro parametro e nao deve imprimi-lo.
- Toda variante listada em `tool.json` tem seu arquivo, e nao sobra arquivo sem variante.
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
