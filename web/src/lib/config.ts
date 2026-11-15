// Dados que a pagina recebe no bloco <script id="config">: o catalog.json
// da release, a tag e a URL do webhook de onboarding.

export type TipoParametro = 'string' | 'host' | 'int' | 'bool' | 'enum' | 'lista'
export type Sistema = 'windows' | 'linux'

export interface Parametro {
  nome: string
  tipo: TipoParametro
  obrigatorio: boolean
  padrao?: string | number | boolean | string[] | null
  regex?: string
  min?: number
  max?: number
  aliases?: string[]
  valores?: { valor: string; descricao?: string }[]
  descricao?: string
  exemplo?: string
  var: string
}

export interface Item {
  slug: string
  os: Sistema
  titulo: string
  categoria: string
  ordem: number
  descricao: string
  arquivo: string
  sha256: string
  parametros: Parametro[]
}

export interface Config {
  repo: string
  tag: string
  publicado: string
  base: string
  catalogo: { versao: number; itens: Item[] }
}

export interface Ferramenta {
  slug: string
  titulo: string
  categoria: string
  ordem: number
  itens: Partial<Record<Sistema, Item>>
}

export function lerConfig(): Config {
  const el = document.getElementById('config')
  return JSON.parse(el?.textContent ?? '{}') as Config
}

// Uma ferramenta por slug, com um item por sistema operacional.
export function agrupar(itens: Item[]): Ferramenta[] {
  const mapa = new Map<string, Ferramenta>()
  for (const i of itens) {
    let f = mapa.get(i.slug)
    if (!f) {
      f = { slug: i.slug, titulo: i.titulo, categoria: i.categoria, ordem: i.ordem, itens: {} }
      mapa.set(i.slug, f)
    }
    f.itens[i.os] = i
  }
  return [...mapa.values()].sort((a, b) => a.ordem - b.ordem || a.titulo.localeCompare(b.titulo))
}

export const SISTEMAS: Sistema[] = ['windows', 'linux']
export const NOME_SISTEMA: Record<Sistema, string> = { windows: 'Windows', linux: 'Linux' }
export const SHELL: Record<Sistema, string> = { windows: 'PowerShell como Administrador', linux: 'Bash com sudo' }
