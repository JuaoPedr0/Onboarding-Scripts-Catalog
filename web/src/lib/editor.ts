// Modelo do editor de ferramentas: rascunho em edicao, conversao de/para
// tool.json e as checagens que o CI do repositorio tambem faz. O CI continua
// sendo a autoridade; aqui e so para a pessoa nao enviar algo que vai falhar.
import type { Sistema, TipoParametro } from './config'

export const CATEGORIAS = ['Monitoramento', 'Segurança', 'Baseline']
export const TIPOS: { valor: TipoParametro; nome: string; ajuda: string }[] = [
  { valor: 'string', nome: 'Texto', ajuda: 'Texto livre, validado por regex' },
  { valor: 'host', nome: 'Host', ajuda: 'IP ou nome de host' },
  { valor: 'int', nome: 'Número', ajuda: 'Inteiro, com mínimo e máximo opcionais' },
  { valor: 'bool', nome: 'Sim/não', ajuda: 'Chave liga/desliga' },
  { valor: 'enum', nome: 'Opções', ajuda: 'Uma entre opções fixas' },
  { valor: 'lista', nome: 'Lista', ajuda: 'Vários valores separados por vírgula' },
]
const EXT: Record<Sistema, string> = { windows: 'ps1', linux: 'sh' }

export interface VarianteRascunho {
  chave: string
  os: Sistema
  id: string
  rotulo: string
  descricao: string
  conteudo: string
}

export interface ParametroRascunho {
  chave: string
  nome: string
  tipo: TipoParametro
  obrigatorio: boolean
  padrao: string
  regex: string
  min: string
  max: string
  /** Uma opcao por linha: "valor | descricao". */
  valores: string
  descricao: string
  exemplo: string
  varWindows: string
  varLinux: string
  /** Campos do tool.json que o formulario nao edita (aliases, porPlataforma). */
  resto: Record<string, unknown>
}

export interface Rascunho {
  modo: 'novo' | 'editar'
  slug: string
  titulo: string
  categoria: string
  ordem: string
  ativo: boolean
  variantes: VarianteRascunho[]
  parametros: ParametroRascunho[]
  autor: string
  resumo: string
}

export interface Arquivo {
  nome: string
  conteudo: string
}

let contador = 0
export const novaChave = () => `${Date.now().toString(36)}-${(contador++).toString(36)}`

export const arquivoDe = (v: { os: Sistema; id: string }) =>
  v.id === 'padrao' ? `${v.os}.${EXT[v.os]}` : `${v.os}.${v.id}.${EXT[v.os]}`

export const slugificar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)

export function novaVariante(os: Sistema, existentes: VarianteRascunho[]): VarianteRascunho {
  const primeira = !existentes.some((v) => v.os === os)
  return {
    chave: novaChave(),
    os,
    id: primeira ? 'padrao' : '',
    rotulo: primeira ? 'Padrão' : '',
    descricao: '',
    conteudo: os === 'linux' ? '#!/usr/bin/env bash\nset -euo pipefail\n\n' : 'param(\n)\n\n',
  }
}

export const novoParametro = (): ParametroRascunho => ({
  chave: novaChave(),
  nome: '',
  tipo: 'string',
  obrigatorio: false,
  padrao: '',
  regex: '',
  min: '',
  max: '',
  valores: '',
  descricao: '',
  exemplo: '',
  varWindows: '',
  varLinux: '',
  resto: {},
})

export const rascunhoVazio = (ordem: number): Rascunho => ({
  modo: 'novo',
  slug: '',
  titulo: '',
  categoria: CATEGORIAS[0],
  ordem: String(ordem),
  ativo: true,
  variantes: [novaVariante('windows', [])],
  parametros: [],
  autor: '',
  resumo: '',
})

// ---------- tool.json -> rascunho ----------

interface ToolJson {
  slug: string
  titulo: string
  categoria: string
  ordem: number
  ativo: boolean
  variantes: { os: Sistema; id: string; rotulo: string; descricao: string }[]
  parametros: Record<string, unknown>[]
}

export function deToolJson(tool: ToolJson, scripts: Record<string, string>): Rascunho {
  return {
    modo: 'editar',
    slug: tool.slug,
    titulo: tool.titulo,
    categoria: tool.categoria,
    ordem: String(tool.ordem),
    ativo: tool.ativo,
    variantes: tool.variantes.map((v) => ({ chave: novaChave(), ...v, conteudo: scripts[arquivoDe(v)] ?? '' })),
    parametros: tool.parametros.map((p) => {
      const { nome, tipo, obrigatorio, padrao, regex, min, max, valores, descricao, exemplo, var: variavel, ...resto } = p as {
        nome: string
        tipo: TipoParametro
        obrigatorio: boolean
        padrao?: unknown
        regex?: string
        min?: number
        max?: number
        valores?: { valor: string; descricao?: string }[]
        descricao?: string
        exemplo?: string
        var: Partial<Record<Sistema, string>>
      }
      return {
        chave: novaChave(),
        nome,
        tipo,
        obrigatorio,
        padrao: padrao === null || padrao === undefined ? '' : Array.isArray(padrao) ? padrao.join(', ') : String(padrao),
        regex: regex ?? '',
        min: min === undefined ? '' : String(min),
        max: max === undefined ? '' : String(max),
        valores: (valores ?? []).map((v) => (v.descricao ? `${v.valor} | ${v.descricao}` : v.valor)).join('\n'),
        descricao: descricao ?? '',
        exemplo: exemplo ?? '',
        varWindows: variavel.windows ?? '',
        varLinux: variavel.linux ?? '',
        resto,
      }
    }),
    autor: '',
    resumo: '',
  }
}

// ---------- rascunho -> arquivos ----------

function padraoTipado(p: ParametroRascunho): unknown {
  const t = p.padrao.trim()
  if (p.tipo === 'lista') return t ? t.split(',').map((x) => x.trim()).filter(Boolean) : []
  if (p.tipo === 'bool') return /^(true|sim|1)$/i.test(t)
  if (!t) return null
  if (p.tipo === 'int') return /^\d+$/.test(t) ? Number(t) : t
  return t
}

const opcoes = (p: ParametroRascunho) =>
  p.valores
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('|')
      return i < 0 ? { valor: l } : { valor: l.slice(0, i).trim(), descricao: l.slice(i + 1).trim() }
    })

export function paraToolJson(r: Rascunho): string {
  const sistemas = new Set(r.variantes.map((v) => v.os))
  const tool = {
    $schema: '../../schema/tool.schema.json',
    slug: r.slug,
    titulo: r.titulo.trim(),
    categoria: r.categoria,
    ordem: Number(r.ordem) || 0,
    ativo: r.ativo,
    variantes: r.variantes.map((v) => ({ os: v.os, id: v.id, rotulo: v.rotulo.trim(), descricao: v.descricao.trim() })),
    parametros: r.parametros.map((p) => {
      const variavel: Partial<Record<Sistema, string>> = {}
      if (sistemas.has('windows') && p.varWindows.trim()) variavel.windows = p.varWindows.trim()
      if (sistemas.has('linux') && p.varLinux.trim()) variavel.linux = p.varLinux.trim()
      const item: Record<string, unknown> = { nome: p.nome, tipo: p.tipo, obrigatorio: p.obrigatorio, padrao: padraoTipado(p) }
      if (p.regex.trim() && (p.tipo === 'string' || p.tipo === 'lista')) item.regex = p.regex.trim()
      if (p.tipo === 'int' && p.min.trim()) item.min = Number(p.min)
      if (p.tipo === 'int' && p.max.trim()) item.max = Number(p.max)
      if (p.tipo === 'enum') item.valores = opcoes(p)
      if (p.descricao.trim()) item.descricao = p.descricao.trim()
      if (p.exemplo.trim()) item.exemplo = p.exemplo.trim()
      item.var = variavel
      return { ...item, ...p.resto }
    }),
  }
  return JSON.stringify(tool, null, 2) + '\n'
}

const normalizar = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\s*$/, '') + '\n'

export function arquivosDoRascunho(r: Rascunho): Arquivo[] {
  return [
    { nome: 'tool.json', conteudo: paraToolJson(r) },
    ...r.variantes.map((v) => ({ nome: arquivoDe(v), conteudo: normalizar(v.conteudo) })),
  ]
}

// ---------- checagens ----------

export interface Checagem {
  ok: boolean
  texto: string
  /** Aba do editor onde o problema se resolve. */
  aba: 'ferramenta' | 'variantes' | 'parametros' | 'envio'
}

const PROIBIDO: [RegExp, string][] = [
  [/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/, 'um IP privado'],
  [/\bconasa\.com/i, 'um domínio interno'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'uma chave privada'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/, 'um token'],
]

// Variaveis declaradas no bloco de parametros do script (mesma regra do CI).
export function variaveisDoScript(os: Sistema, texto: string): Set<string> {
  if (os === 'windows') {
    const m = texto.replace(/\r/g, '').match(/^param\s*\(([\s\S]*?)^\)/m)
    return new Set(m ? [...m[1].matchAll(/\$([A-Za-z][A-Za-z0-9]*)/g)].map((x) => x[1]) : [])
  }
  return new Set([...texto.matchAll(/"\$\{([A-Z][A-Z0-9_]*):-/g)].map((x) => x[1]))
}

export function checar(r: Rascunho, slugsExistentes: string[]): Checagem[] {
  const c: Checagem[] = []
  const add = (aba: Checagem['aba'], ok: boolean, texto: string) => c.push({ aba, ok, texto })
  const nomeV = (v: VarianteRascunho) => `${v.os === 'windows' ? 'Windows' : 'Linux'} “${v.rotulo || v.id || 'sem nome'}”`

  add('ferramenta', /^[a-z][a-z0-9-]{1,31}$/.test(r.slug), 'Identificador com 2 a 32 caracteres: letras minúsculas, números e hífen')
  if (r.modo === 'novo' && r.slug) add('ferramenta', !slugsExistentes.includes(r.slug), `Identificador “${r.slug}” ainda não usado por outra ferramenta`)
  add('ferramenta', r.titulo.trim().length > 0 && r.titulo.trim().length <= 80, 'Título preenchido, com até 80 caracteres')
  add('ferramenta', /^\d+$/.test(r.ordem), 'Ordem é um número inteiro')

  add('variantes', r.variantes.length > 0, 'Pelo menos uma variante')
  const vistas = new Set<string>()
  for (const v of r.variantes) {
    const chave = `${v.os}/${v.id}`
    add('variantes', /^[a-z0-9][a-z0-9-]{0,31}$/.test(v.id) && !vistas.has(chave), `${nomeV(v)}: identificador válido e único no sistema`)
    vistas.add(chave)
    add('variantes', !!v.rotulo.trim() && !!v.descricao.trim(), `${nomeV(v)}: nome e descrição preenchidos`)
    const texto = v.conteudo.replace(/\r/g, '')
    add('variantes', texto.trim().length > 0, `${nomeV(v)}: script preenchido`)
    if (v.os === 'linux') add('variantes', texto.startsWith('#!'), `${nomeV(v)}: script começa com shebang (#!/usr/bin/env bash)`)
    add('variantes', !texto.includes('@@'), `${nomeV(v)}: sem @@placeholders@@`)
    for (const [re, oque] of PROIBIDO) {
      const linha = texto.split('\n').findIndex((l) => re.test(l))
      if (linha >= 0) add('variantes', false, `${nomeV(v)}: a linha ${linha + 1} tem ${oque}; o repositório é público`)
    }
  }

  const sistemas = new Set(r.variantes.map((v) => v.os))
  const nomes = new Set<string>()
  for (const p of r.parametros) {
    const n = p.nome || 'sem nome'
    add('parametros', /^[a-z][a-z0-9_]{0,39}$/.test(p.nome) && !nomes.has(p.nome) && !['script', 'os', 'variante'].includes(p.nome), `Parâmetro “${n}”: nome único, em minúsculas, sem espaços`)
    nomes.add(p.nome)
    if (p.tipo === 'enum') add('parametros', opcoes(p).length > 0, `Parâmetro “${n}”: pelo menos uma opção`)
    if (p.regex.trim()) {
      let valida = true
      try {
        new RegExp(p.regex)
      } catch {
        valida = false
      }
      add('parametros', valida, `Parâmetro “${n}”: regex válida`)
    }
    const usa = { windows: sistemas.has('windows') && !!p.varWindows.trim(), linux: sistemas.has('linux') && !!p.varLinux.trim() }
    add('parametros', usa.windows || usa.linux, `Parâmetro “${n}”: variável informada para pelo menos um sistema`)
    if (usa.windows) add('parametros', /^[A-Za-z][A-Za-z0-9]*$/.test(p.varWindows.trim()), `Parâmetro “${n}”: variável do PowerShell só com letras e números`)
    if (usa.linux) add('parametros', /^[A-Z][A-Z0-9_]*$/.test(p.varLinux.trim()), `Parâmetro “${n}”: variável do Bash em MAIÚSCULAS`)
    for (const v of r.variantes) {
      const variavel = v.os === 'windows' ? p.varWindows.trim() : p.varLinux.trim()
      if (!usa[v.os]) continue
      const como = v.os === 'windows' ? `$${variavel} dentro de param( )` : `${variavel}="\${${variavel}:-}"`
      add('parametros', variaveisDoScript(v.os, v.conteudo).has(variavel), `Parâmetro “${n}”: o script ${nomeV(v)} declara ${como}`)
    }
  }

  add('envio', r.autor.trim().length >= 2, 'Seu nome, para constar no pedido de revisão')
  add('envio', r.resumo.trim().length >= 5, 'Resumo do que foi criado ou alterado')
  return c
}
