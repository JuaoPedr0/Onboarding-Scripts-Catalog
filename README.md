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
tools/<slug>/linux.sh   --+        (CI valida tudo)             (release) --> GitHub Pages
```

- **`tools/<slug>/`**: uma pasta por ferramenta, com `tool.json` (titulo,
  categoria, parametros) e um script por sistema operacional.
- **`catalog.json`**: indice gerado, uma entrada por ferramenta + SO, com os
  parametros ja resolvidos e o SHA-256 de cada script. E o unico arquivo que
  o n8n precisa ler para montar a pagina e localizar um script.
- **`web/`**: a pagina do catalogo (React, Tailwind e shadcn/ui). Mostra um
  formulario por ferramenta e monta o comando conforme os campos sao
  preenchidos, validando com as mesmas regras do motor. A cada release o
  workflow `Pages` compila, injeta o `catalog.json`, a tag e a URL do webhook
  (variavel `ONBOARDING_BASE_URL` do repositorio, fora do codigo) e publica
  no GitHub Pages.
- **`lib/render.js`**: o motor que valida a query string e monta o script
  entregue. E o mesmo codigo do no "Resolver parametros" do workflow.

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

## Desenvolver

Veja [CONTRIBUTING.md](CONTRIBUTING.md). Em resumo: `npm ci`, edite,
`npm run build && npm test`, pull request, tag.

## Seguranca

Repositorio publico: nada de segredos, IPs ou nomes internos. Veja [SECURITY.md](SECURITY.md).
