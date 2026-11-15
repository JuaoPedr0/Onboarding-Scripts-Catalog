// Metadados de parametros declarados dentro do proprio script.
//
// Cada script descreve os parametros que oferece ao catalogo num bloco de
// comentarios, igual em PowerShell e em Bash:
//
//   # @onboarding:begin
//   # {
//   #   "schemaVersion": 1,
//   #   "parameters": [
//   #     { "name": "manager", "variable": "Manager", "type": "host", "required": true }
//   #   ]
//   # }
//   # @onboarding:end
//
// Este arquivo e a UNICA implementacao de leitura, escrita e validacao do
// bloco: a pagina importa daqui e o gerador do catalogo (scripts/build-catalog.js)
// tambem. Por isso nao importa nada e usa so sintaxe de tipo apagavel, que o
// Node carrega direto.

export type SistemaMeta = 'windows' | 'linux'
export type TipoMeta = 'string' | 'host' | 'int' | 'bool' | 'enum' | 'list' | 'secret'

export const TIPOS_META: TipoMeta[] = ['string', 'host', 'int', 'bool', 'enum', 'list', 'secret']
export const INICIO = '# @onboarding:begin'
export const FIM = '# @onboarding:end'

export interface OpcaoMeta {
  value: string
  description?: string
}

export interface ParametroMeta {
  /** Nome na query string. */
  name: string
  /** Variavel do script que recebe o valor. */
  variable: string
  type?: TipoMeta
  required?: boolean
  default?: unknown
  description?: string
  example?: string
  regex?: string
  min?: number
  max?: number
  options?: (string | OpcaoMeta)[]
  sensitive?: boolean
  aliases?: string[]
}

export interface Bloco {
  schemaVersion: number
  parameters: ParametroMeta[]
}

export interface Leitura {
  /** null quando o script nao tem bloco (ou o bloco nao pode ser lido). */
  bloco: Bloco | null
  /** Preenchido quando ha marcadores mas o conteudo e invalido. */
  erro?: string
  /** Linhas (indice) do marcador de inicio e de fim, quando existem. */
  inicio?: number
  fim?: number
}

export interface Diagnostico {
  nivel: 'erro' | 'aviso' | 'info'
  codigo: string
  texto: string
  parametro?: string
  variavel?: string
}

const CHAVES = ['name', 'variable', 'type', 'required', 'default', 'description', 'example', 'regex', 'min', 'max', 'options', 'sensitive', 'aliases']
const RESERVADOS = ['script', 'os', 'variante', 'cred']
const RE_NOME = /^[a-z][a-z0-9_]{0,39}$/
const RE_VAR: Record<SistemaMeta, RegExp> = { windows: /^[A-Za-z][A-Za-z0-9]*$/, linux: /^[A-Z][A-Z0-9_]*$/ }

// ---------- leitura ----------

export function lerBloco(texto: string): Leitura {
  const linhas = texto.replace(/\r/g, '').split('\n')
  const inicio = linhas.findIndex((l) => /^#\s*@onboarding:begin\s*$/.test(l))
  if (inicio < 0) return { bloco: null }
  const fim = linhas.findIndex((l, i) => i > inicio && /^#\s*@onboarding:end\s*$/.test(l))
  if (fim < 0) return { bloco: null, inicio, erro: 'Bloco de metadados sem a linha "# @onboarding:end"' }
  const corpo = linhas.slice(inicio + 1, fim)
  const fora = corpo.findIndex((l) => !l.startsWith('#'))
  if (fora >= 0) return { bloco: null, inicio, fim, erro: `Linha ${inicio + 2 + fora} do bloco de metadados não começa com #` }
  let dados: unknown
  try {
    dados = JSON.parse(corpo.map((l) => l.replace(/^# ?/, '')).join('\n'))
  } catch (e) {
    return { bloco: null, inicio, fim, erro: `Bloco de metadados não é JSON válido: ${(e as Error).message}` }
  }
  const d = dados as Partial<Bloco> | null
  if (!d || typeof d !== 'object' || !Array.isArray(d.parameters)) {
    return { bloco: null, inicio, fim, erro: 'Bloco de metadados precisa de "parameters": [ ... ]' }
  }
  if (d.parameters.some((p) => !p || typeof p !== 'object' || Array.isArray(p))) {
    return { bloco: null, inicio, fim, erro: 'Cada item de "parameters" precisa ser um objeto { "name": ..., "variable": ... }' }
  }
  return { bloco: { schemaVersion: Number(d.schemaVersion) || 1, parameters: d.parameters }, inicio, fim }
}

// ---------- escrita ----------

/** Texto do bloco: um parametro por linha, para ser facil de ler e editar a mao. */
export function formatarBloco(bloco: Bloco): string {
  const itens = bloco.parameters.map((p) => {
    const ordenado: Record<string, unknown> = {}
    for (const k of CHAVES) if ((p as unknown as Record<string, unknown>)[k] !== undefined) ordenado[k] = (p as unknown as Record<string, unknown>)[k]
    for (const k of Object.keys(p)) if (!(k in ordenado)) ordenado[k] = (p as unknown as Record<string, unknown>)[k]
    const campos = Object.entries(ordenado).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    return `    { ${campos.join(', ')} }`
  })
  const corpo = ['{', `  "schemaVersion": ${bloco.schemaVersion || 1},`, '  "parameters": [' + (itens.length ? '' : ']'), ...(itens.length ? [itens.join(',\n'), '  ]'] : []), '}']
  return [INICIO, ...corpo.join('\n').split('\n').map((l) => `# ${l}`), FIM].join('\n')
}

/** Grava (ou substitui) o bloco no script. No Bash, fica logo depois do shebang. */
export function escreverBloco(texto: string, bloco: Bloco): string {
  const linhas = texto.replace(/\r/g, '').split('\n')
  const novo = formatarBloco(bloco).split('\n')
  const atual = lerBloco(texto)
  if (atual.inicio !== undefined && atual.fim !== undefined) {
    linhas.splice(atual.inicio, atual.fim - atual.inicio + 1, ...novo)
    return linhas.join('\n')
  }
  const depoisDoShebang = linhas[0]?.startsWith('#!') ? 1 : 0
  const resto = linhas.slice(depoisDoShebang)
  while (resto.length && resto[0].trim() === '') resto.shift()
  return [...linhas.slice(0, depoisDoShebang), ...novo, '', ...resto].join('\n')
}

// ---------- variaveis do script ----------

/** Variaveis que o script declara para receber parametros. */
export function variaveisDoScript(os: SistemaMeta, texto: string): string[] {
  const limpo = texto.replace(/\r/g, '')
  if (os === 'windows') {
    const m = limpo.match(/^param\s*\(([\s\S]*?)^\)/m)
    return m ? [...new Set([...m[1].matchAll(/\$([A-Za-z][A-Za-z0-9]*)/g)].map((x) => x[1]))] : []
  }
  // Declaracao = atribuicao sem recuo, no nivel do script: VAR="${VAR:-padrao}".
  return [...new Set([...limpo.matchAll(/^[A-Za-z_][A-Za-z0-9_]*="\$\{([A-Z][A-Z0-9_]*):-/gm)].map((x) => x[1]))]
}

/** Como declarar a variavel no script, para mostrar na mensagem de erro. */
export const comoDeclarar = (os: SistemaMeta, variavel: string) =>
  os === 'windows' ? `$${variavel} dentro de param( )` : `${variavel}="\${${variavel}:-}"`

// ---------- validacao ----------

const opcoesDe = (p: ParametroMeta): OpcaoMeta[] =>
  (Array.isArray(p.options) ? p.options : []).map((o) => (typeof o === 'string' ? { value: o } : o)).filter((o) => o && typeof o.value === 'string')

export const ehSegredo = (p: ParametroMeta) => p.type === 'secret'

export function validarBloco(leitura: Leitura, os: SistemaMeta, texto: string): Diagnostico[] {
  const d: Diagnostico[] = []
  if (leitura.erro) {
    d.push({ nivel: 'erro', codigo: 'bloco-invalido', texto: leitura.erro })
    return d
  }
  const declaradas = variaveisDoScript(os, texto)
  const params = leitura.bloco?.parameters ?? []
  const nomes = new Set<string>()
  const variaveis = new Set<string>()

  for (const p of params) {
    const n = typeof p.name === 'string' && p.name ? p.name : '(sem nome)'
    const erro = (codigo: string, texto: string) => d.push({ nivel: 'erro', codigo, texto, parametro: n, variavel: p.variable })
    const aviso = (codigo: string, texto: string) => d.push({ nivel: 'aviso', codigo, texto, parametro: n, variavel: p.variable })

    if (typeof p.name !== 'string' || !RE_NOME.test(p.name)) erro('nome', `“${n}”: "name" deve ter minúsculas, números e _ (é o nome na URL)`)
    else if (RESERVADOS.includes(p.name)) erro('nome', `“${n}”: nome reservado pelo catálogo`)
    for (const a of [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])]) {
      if (typeof a !== 'string') continue
      if (nomes.has(a)) erro('duplicado', `“${a}” aparece mais de uma vez como nome ou alias`)
      nomes.add(a)
    }

    if (typeof p.variable !== 'string' || !p.variable) erro('variavel', `“${n}”: falta "variable", a variável do script que recebe o valor`)
    else {
      if (!RE_VAR[os].test(p.variable)) erro('variavel', os === 'windows' ? `“${n}”: variável do PowerShell só com letras e números, sem $` : `“${n}”: variável do Bash em MAIÚSCULAS`)
      else if (!declaradas.includes(p.variable)) erro('sem-variavel', `“${n}”: o script não declara ${comoDeclarar(os, p.variable)}`)
      if (variaveis.has(p.variable)) erro('duplicado', `A variável ${p.variable} está ligada a mais de um parâmetro`)
      variaveis.add(p.variable)
    }

    const tipo = p.type ?? 'string'
    if (!TIPOS_META.includes(tipo)) erro('tipo', `“${n}”: tipo “${String(p.type)}” não existe (use ${TIPOS_META.join(', ')})`)
    if (tipo === 'enum' && opcoesDe(p).length === 0) erro('opcoes', `“${n}”: tipo enum precisa de "options"`)
    if (p.regex !== undefined) {
      try {
        new RegExp(String(p.regex))
      } catch {
        erro('regex', `“${n}”: "regex" inválida`)
      }
    }
    for (const k of ['min', 'max'] as const) if (p[k] !== undefined && !Number.isInteger(p[k])) erro('limite', `“${n}”: "${k}" deve ser um número inteiro`)
    if (p.required !== undefined && typeof p.required !== 'boolean') erro('obrigatorio', `“${n}”: "required" deve ser true ou false`)
    if (tipo === 'secret' && p.default !== undefined && p.default !== null && p.default !== '') {
      erro('segredo', `“${n}”: um segredo não pode ter "default"; o valor ficaria público no repositório`)
    }
    if (p.sensitive === true && tipo !== 'secret') erro('segredo', `“${n}”: dado sensível precisa ser "type": "secret" para trafegar por credencial temporária`)
    const estranhas = Object.keys(p).filter((k) => !CHAVES.includes(k))
    if (estranhas.length) aviso('chave', `“${n}”: campo desconhecido ${estranhas.map((k) => `"${k}"`).join(', ')} (erro de digitação?)`)
  }

  for (const v of declaradas) {
    if (!variaveis.has(v)) d.push({ nivel: 'aviso', codigo: 'sem-metadados', texto: `A variável ${v} existe no script mas não está nos metadados; não aparece no catálogo`, variavel: v })
  }
  return d
}

/** Diferencas entre as variantes de uma ferramenta. */
export function compararVariantes(variantes: { rotulo: string; os: SistemaMeta; parametros: ParametroMeta[] }[]): Diagnostico[] {
  const d: Diagnostico[] = []
  const nomes = [...new Set(variantes.flatMap((v) => v.parametros.map((p) => p.name)))].filter((n) => typeof n === 'string' && n)
  for (const nome of nomes) {
    const com = variantes.filter((v) => v.parametros.some((p) => p.name === nome))
    const tipos = [...new Set(com.map((v) => v.parametros.find((p) => p.name === nome)!.type ?? 'string'))]
    if (tipos.length > 1) {
      d.push({ nivel: 'erro', codigo: 'tipo-divergente', parametro: nome, texto: `“${nome}” tem tipos diferentes entre as variantes (${tipos.join(' e ')})` })
    }
    for (const os of ['windows', 'linux'] as SistemaMeta[]) {
      const doSistema = variantes.filter((v) => v.os === os)
      const faltam = doSistema.filter((v) => !com.includes(v))
      if (faltam.length && faltam.length < doSistema.length) {
        d.push({ nivel: 'aviso', codigo: 'so-em-algumas', parametro: nome, texto: `“${nome}” não existe em ${faltam.map((v) => v.rotulo).join(', ')} (${os === 'windows' ? 'Windows' : 'Linux'})` })
      }
    }
    const sistemas = new Set(com.map((v) => v.os))
    if (sistemas.size === 1 && new Set(variantes.map((v) => v.os)).size > 1) {
      d.push({ nivel: 'info', codigo: 'so-em-um-sistema', parametro: nome, texto: `“${nome}” só existe em ${sistemas.has('windows') ? 'Windows' : 'Linux'}` })
    }
  }
  return d
}

// ---------- conversao para o catalogo ----------

/** Parametro no formato do catalog.json, consumido pela pagina e pelo n8n. */
export function paraCatalogo(p: ParametroMeta): Record<string, unknown> {
  const tipo = p.type ?? 'string'
  const saida: Record<string, unknown> = {
    nome: p.name,
    tipo: tipo === 'list' ? 'lista' : tipo,
    obrigatorio: p.required === true,
    padrao: tipo === 'secret' ? null : p.default !== undefined ? p.default : tipo === 'bool' ? false : tipo === 'list' ? [] : null,
  }
  if (p.regex !== undefined) saida.regex = p.regex
  if (p.min !== undefined) saida.min = p.min
  if (p.max !== undefined) saida.max = p.max
  if (Array.isArray(p.aliases) && p.aliases.length) saida.aliases = p.aliases
  if (tipo === 'enum') saida.valores = opcoesDe(p).map((o) => (o.description ? { valor: o.value, descricao: o.description } : { valor: o.value }))
  if (p.description) saida.descricao = p.description
  if (p.example) saida.exemplo = p.example
  if (tipo === 'secret') saida.sensivel = true
  saida.var = p.variable
  return saida
}

/** Parametro do tool.json antigo (campo "parametros") convertido para o bloco de um sistema. */
export function deLegado(p: Record<string, unknown>, os: SistemaMeta): ParametroMeta | null {
  const variavel = (p.var as Record<string, string> | undefined)?.[os]
  if (!variavel) return null
  const por = ((p.porPlataforma as Record<string, Record<string, unknown>> | undefined) ?? {})[os] ?? {}
  const f = { ...p, ...por } as Record<string, unknown>
  const tipo = (f.tipo === 'lista' ? 'list' : f.tipo) as TipoMeta
  const saida: ParametroMeta = { name: String(f.nome), variable: variavel, type: tipo, required: f.obrigatorio === true }
  const padrao = f.padrao
  const vazio = padrao === null || padrao === undefined || (tipo === 'bool' && padrao === false) || (Array.isArray(padrao) && padrao.length === 0)
  if (!vazio) saida.default = padrao
  if (f.descricao) saida.description = String(f.descricao)
  if (f.exemplo) saida.example = String(f.exemplo)
  if (f.regex) saida.regex = String(f.regex)
  if (f.min !== undefined) saida.min = Number(f.min)
  if (f.max !== undefined) saida.max = Number(f.max)
  if (Array.isArray(f.valores)) saida.options = (f.valores as { valor: string; descricao?: string }[]).map((v) => (v.descricao ? { value: v.valor, description: v.descricao } : v.valor))
  if (Array.isArray(f.aliases) && f.aliases.length) saida.aliases = f.aliases as string[]
  return saida
}
