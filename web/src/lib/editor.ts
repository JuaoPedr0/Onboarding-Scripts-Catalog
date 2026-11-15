// Modelo do editor de ferramentas: rascunho em edicao, conversao de/para
// tool.json e as checagens que o CI do repositorio tambem faz. O CI continua
// sendo a autoridade; aqui e so para a pessoa nao enviar algo que vai falhar.
import type { Sistema } from './config'
import { compararVariantes, deLegado, escreverBloco, lerBloco, validarBloco, type Diagnostico, type ParametroMeta, type TipoMeta } from './metadados'

export const CATEGORIAS = ['Monitoramento', 'Segurança', 'Baseline']
export const TIPOS: { valor: TipoMeta; nome: string; ajuda: string }[] = [
  { valor: 'string', nome: 'Texto', ajuda: 'Texto livre, validado por regex' },
  { valor: 'host', nome: 'Host', ajuda: 'IP ou nome de host' },
  { valor: 'int', nome: 'Número', ajuda: 'Inteiro, com mínimo e máximo opcionais' },
  { valor: 'bool', nome: 'Sim/não', ajuda: 'Chave liga/desliga' },
  { valor: 'enum', nome: 'Opções', ajuda: 'Uma entre opções fixas' },
  { valor: 'list', nome: 'Lista', ajuda: 'Vários valores separados por vírgula' },
  { valor: 'secret', nome: 'Segredo', ajuda: 'Senha, token ou chave: campo mascarado, entregue por credencial temporária' },
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

export interface Rascunho {
  modo: 'novo' | 'editar'
  slug: string
  titulo: string
  categoria: string
  ordem: string
  ativo: boolean
  variantes: VarianteRascunho[]
  /** Os parametros vieram do formato antigo (tool.json) e foram passados para os scripts. */
  migrado?: boolean
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

export const rascunhoVazio = (ordem: number): Rascunho => ({
  modo: 'novo',
  slug: '',
  titulo: '',
  categoria: CATEGORIAS[0],
  ordem: String(ordem),
  ativo: true,
  variantes: [novaVariante('windows', [])],
  autor: '',
  resumo: '',
})

// ---------- parametros de uma variante (bloco @onboarding do script) ----------

export const parametrosDe = (v: VarianteRascunho): ParametroMeta[] => lerBloco(v.conteudo).bloco?.parameters ?? []

/** Regrava o bloco de metadados do script com a lista dada. */
export const comParametros = (v: VarianteRascunho, parametros: ParametroMeta[]): string =>
  escreverBloco(v.conteudo, { schemaVersion: 1, parameters: parametros })

/** Sugestao de nome de URL para uma variavel: RegistrationPassword -> registration_password. */
export const nomeDeVariavel = (variavel: string) =>
  variavel
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 40)

export interface DiagnosticoVariante {
  variante: VarianteRascunho
  parametros: ParametroMeta[]
  itens: Diagnostico[]
}

/** Diagnostico de cada variante e das diferencas entre elas. */
export function diagnosticar(r: Rascunho): { variantes: DiagnosticoVariante[]; entre: Diagnostico[] } {
  const variantes = r.variantes.map((v) => {
    const leitura = lerBloco(v.conteudo)
    return { variante: v, parametros: leitura.bloco?.parameters ?? [], itens: validarBloco(leitura, v.os, v.conteudo) }
  })
  const entre = compararVariantes(variantes.map((d) => ({ rotulo: d.variante.rotulo || d.variante.id || 'sem nome', os: d.variante.os, parametros: d.parametros })))
  return { variantes, entre }
}

// ---------- tool.json -> rascunho ----------

interface ToolJson {
  slug: string
  titulo: string
  categoria: string
  ordem: number
  ativo: boolean
  variantes: { os: Sistema; id: string; rotulo: string; descricao: string }[]
  /** Formato anterior: parametros fora dos scripts. */
  parametros?: Record<string, unknown>[]
}

export function deToolJson(tool: ToolJson, scripts: Record<string, string>): Rascunho {
  let migrado = false
  const variantes = tool.variantes.map((v) => {
    let conteudo = scripts[arquivoDe(v)] ?? ''
    // Script ainda sem bloco: leva para dentro dele os parametros do tool.json.
    if (lerBloco(conteudo).inicio === undefined && tool.parametros?.length) {
      const legados = tool.parametros.map((p) => deLegado(p, v.os)).filter((p): p is ParametroMeta => p !== null)
      conteudo = escreverBloco(conteudo, { schemaVersion: 1, parameters: legados })
      migrado = true
    }
    return { chave: novaChave(), ...v, conteudo }
  })
  return { modo: 'editar', slug: tool.slug, titulo: tool.titulo, categoria: tool.categoria, ordem: String(tool.ordem), ativo: tool.ativo, variantes, migrado, autor: '', resumo: '' }
}

// ---------- rascunho -> arquivos ----------

export function paraToolJson(r: Rascunho): string {
  const tool = {
    $schema: '../../schema/tool.schema.json',
    slug: r.slug,
    titulo: r.titulo.trim(),
    categoria: r.categoria,
    ordem: Number(r.ordem) || 0,
    ativo: r.ativo,
    variantes: r.variantes.map((v) => ({ os: v.os, id: v.id, rotulo: v.rotulo.trim(), descricao: v.descricao.trim() })),
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

  // Parametros: a mesma validacao dos metadados que o CI faz em cada script.
  const diag = diagnosticar(r)
  for (const dv of diag.variantes) {
    for (const g of dv.itens) if (g.nivel === 'erro') add('parametros', false, `${nomeV(dv.variante)}: ${g.texto}`)
  }
  for (const g of diag.entre) if (g.nivel === 'erro') add('parametros', false, g.texto)
  if (!c.some((x) => x.aba === 'parametros')) {
    const total = diag.variantes.reduce((n, dv) => n + dv.parametros.length, 0)
    add('parametros', true, total ? 'Metadados dos parâmetros conferem com as variáveis dos scripts' : 'Nenhum parâmetro declarado nos scripts')
  }

  add('envio', r.autor.trim().length >= 2, 'Seu nome, para constar no pedido de revisão')
  add('envio', r.resumo.trim().length >= 5, 'Resumo do que foi criado ou alterado')
  return c
}
