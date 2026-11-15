# Onboarding-Scripts-Catalog

Scripts de provisionamento de hosts (agentes de monitoramento, seguranca e
baseline), versionados e testados. Sao a fonte do **Catalogo de Onboarding**:
um workflow n8n le a ultima release deste repositorio, valida os parametros
da URL e entrega o script pronto para o host.

| `?script=` | Ferramenta | Categoria | SO |
| --- | --- | --- | --- |
| `zabbix` | Zabbix Agent 2 | Monitoramento | linux, windows |
| `wazuh` | Wazuh Agent | Segurança | linux, windows |
| `essenciais` | Essenciais / Baseline | Baseline | linux, windows |

## Como funciona

```
tools/<slug>/tool.json  --+
tools/<slug>/windows.ps1  +--> npm run build --> catalog.json --> tag vX.Y.Z --> n8n --> host
tools/<slug>/linux.sh   --+   (le o bloco # @onboarding     (release) --> GitHub Pages
                               de cada script; CI valida)
```

- **`tools/<slug>/`**: uma pasta por ferramenta, com `tool.json` (titulo,
  categoria, variantes) e um script por variante. Os parametros sao
  declarados dentro de cada script, no bloco `# @onboarding`. Uma variante e
  um script para um sistema especifico: `windows.ps1` e `linux.sh` sao as
  padrao; as demais seguem `<sistema>.<id>.<ext>`, como
  `windows.server-2025.ps1` ou `linux.rhel.sh`, e sao pedidas com
  `&variante=<id>` na URL.
- **`catalog.json`**: indice gerado (`npm run build`), uma entrada por
  ferramenta + sistema + variante, com os parametros ja resolvidos e o
  SHA-256 de cada script. Nao e versionado: e gerado e anexado a cada
  release, de onde o n8n o le para localizar um script.
- **`web/`**: a pagina do catalogo (React, Tailwind e shadcn/ui). Mostra um
  formulario por ferramenta e monta o comando conforme os campos sao
  preenchidos, validando com as mesmas regras do motor. A cada release o
  workflow `Pages` compila, injeta o `catalog.json`, a tag e a URL do webhook
  (variavel `ONBOARDING_BASE_URL` do repositorio, fora do codigo) e publica
  no GitHub Pages.
- **`lib/render.js`**: o motor que valida a query string e monta o script
  entregue. E o mesmo codigo do no "Resolver parametros" do workflow.
- **`web/src/lib/metadados.ts`**: le, valida e regrava o bloco
  `# @onboarding`. E a mesma implementacao no editor da pagina e no
  `npm run build`.

## Usar

Pelo catalogo (recomendado): abra a pagina publicada no GitHub Pages,
<https://juaopedr0.github.io/Onboarding-Scripts-Catalog/>, copie o comando da
ferramenta, preencha os parametros e copie o comando pronto. Os comandos
chamam o webhook de onboarding, que so responde na rede interna.

Direto do repositorio, sem o webhook:

```powershell
# Windows (como Administrador)
$s = irm 'https://raw.githubusercontent.com/JuaoPedr0/Onboarding-Scripts-Catalog/<TAG>/tools/wazuh/windows.ps1'
& ([ScriptBlock]::Create($s)) -Manager '<HOST_DO_MANAGER>' -AgentGroup 'Windows'
```

```bash
# Linux
curl -fsSL 'https://raw.githubusercontent.com/JuaoPedr0/Onboarding-Scripts-Catalog/<TAG>/tools/wazuh/linux.sh' \
  | sudo WAZUH_MANAGER='<HOST_DO_MANAGER>' WAZUH_AGENT_GROUPS_CSV='Linux' bash
```

Use sempre uma tag (`v1.0.0`), nunca `main`: a tag e imutavel.

## Como os parametros chegam ao script

O corpo do script nunca e alterado. O webhook so acrescenta os valores que
vieram na URL; o resto usa o default do proprio script.

| | Entrega | Exemplo |
| --- | --- | --- |
| PowerShell | corpo dentro de um scriptblock, chamado com splatting | `& { ...script... } @__onboarding @args` |
| Bash | atribuicoes logo apos o shebang | `WAZUH_MANAGER='wazuh.exemplo.local'` |

Valor invalido nao entrega script: a resposta e um script que so imprime o erro e sai com codigo 1.

## Declarar parametros no script

O script e a fonte dos parametros. No inicio do arquivo (no Bash, logo apos o
shebang) fica um bloco de comentarios com JSON, um parametro por linha:

```powershell
# @onboarding:begin
# {
#   "schemaVersion": 1,
#   "parameters": [
#     { "name": "manager", "variable": "Manager", "type": "host", "required": true, "description": "IP ou FQDN do manager" },
#     { "name": "protocol", "variable": "Protocol", "type": "enum", "default": "tcp", "options": ["tcp", "udp"] },
#     { "name": "password", "variable": "RegistrationPassword", "type": "secret", "description": "Senha de enrollment" }
#   ]
# }
# @onboarding:end
param(
    [string] $Manager = '',
    [string] $Protocol = 'tcp',
    [string] $RegistrationPassword = ''
)
```

| Campo | Para que serve |
| --- | --- |
| `name` | nome na URL e no formulario (minusculas, numeros e `_`) |
| `variable` | variavel do script: nome dentro de `param( )` no PowerShell, `VAR="${VAR:-}"` no Bash |
| `type` | `string`, `host`, `int`, `bool`, `enum`, `list` ou `secret` (padrao `string`) |
| `required`, `default`, `description`, `example` | obrigatoriedade, padrao (o mesmo do script), texto e exemplo do campo |
| `regex`, `min`, `max`, `options` | validacao: regex (`string`/`list`), limites (`int`), opcoes (`enum`) |
| `aliases` | outros nomes aceitos na URL |
| `sensitive` | marca dado sensivel; so e aceito junto de `"type": "secret"` |

`npm run build` (e o editor da pagina, na secao Diagnostico) conferem o bloco
contra o script: parametro que aponta para variavel inexistente e erro;
variavel do script sem metadados e aviso (ela nao aparece no catalogo, e o
editor oferece "Declarar" sem inventar tipo nem obrigatoriedade); tipo
diferente entre variantes do mesmo sistema e erro; parametro que so existe
em um sistema e informado. Ferramenta antiga, com `parametros` no
`tool.json` e sem bloco, continua funcionando; ao abri-la no editor os
parametros sao passados para os blocos.

Para acrescentar um parametro: declare a variavel no script, acrescente a
linha no bloco, `npm run build && npm test`, pull request, tag. Nao ha outro
arquivo para editar.

## Segredos

Um parametro `secret` (senha, token) nunca vai na URL do comando. No catalogo:

1. O campo e mascarado; o valor fica so na memoria da pagina (nada de URL,
   `localStorage` ou rascunho) e nao aparece no terminal de pre-visualizacao.
2. Ao copiar o comando, a pagina envia o valor por HTTPS POST (no corpo) ao
   n8n, que o guarda no Redis com validade de 15 minutos e devolve uma
   referencia aleatoria. O comando copiado leva so `&cred=<referencia>`, e o
   campo e limpo.
3. O script entregue ao host troca a referencia pelo valor numa chamada HTTPS
   propria. O n8n entrega uma unica vez e apaga; a referencia so vale para a
   mesma ferramenta, sistema e variante para que foi emitida. No host o valor
   entra direto na variavel do script, sem passar por linha de comando.

Segredo enviado na URL e recusado pelo motor. Para executar sem o catalogo,
passe o valor direto ao script (`-RegistrationPassword`, variavel de ambiente).
Segredo nao tem `default` nem `example`: o build recusa.

## Criar ou editar pelo catalogo

A pagina tem um editor ("Novo script" e "Editar"): preenche-se a ferramenta,
as variantes e os parametros (gravados no bloco de cada script), e o envio vira um pull request aberto por uma
conta-robo, sem acesso de escrita a este repositorio. Nada entra no catalogo
antes de o administrador revisar, fazer o merge e publicar uma tag.

## Desenvolver

Veja [CONTRIBUTING.md](CONTRIBUTING.md). Em resumo: `npm ci`, edite,
`npm run build && npm test`, pull request, tag.

## Seguranca

Repositorio publico: nada de segredos, IPs ou nomes internos. Veja [SECURITY.md](SECURITY.md).
