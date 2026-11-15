// Dados que a pagina recebe no bloco <script id="config">: o catalog.json
// da release, a tag e a URL do webhook de onboarding.

export type TipoParametro = 'string' | 'host' | 'int' | 'bool' | 'enum' | 'lista' | 'secret'
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
  /** Segredo: nunca vai para a URL nem fica guardado no navegador. */
  sensivel?: boolean
  var: string
}

export interface Item {
  slug: string
  os: Sistema
  /** Id da variante (valor de ?variante=). */
  variante: string
  /** Nome da variante mostrado na tela, ex.: Windows Server 2025. */
  rotulo: string
  /** Entregue quando a URL nao traz variante=. */
  padrao: boolean
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
  /** Webhook que recebe os envios do editor; vazio = envio desligado. */
  envio: string
  /** Webhook que guarda segredos por alguns minutos e devolve uma referencia de uso unico. */
  credencial: string
  catalogo: { versao: number; itens: Item[] }
}

export interface Ferramenta {
  slug: string
  titulo: string
  categoria: string
  ordem: number
  /** Variantes por sistema; a padrao vem primeiro. */
  itens: Partial<Record<Sistema, Item[]>>
}

export function lerConfig(): Config {
  const el = document.getElementById('config')
  return JSON.parse(el?.textContent ?? '{}') as Config
}

// Uma ferramenta por slug, com as variantes de cada sistema operacional.
export function agrupar(itens: Item[]): Ferramenta[] {
  const mapa = new Map<string, Ferramenta>()
  for (const i of itens) {
    let f = mapa.get(i.slug)
    if (!f) {
      f = { slug: i.slug, titulo: i.titulo, categoria: i.categoria, ordem: i.ordem, itens: {} }
      mapa.set(i.slug, f)
    }
    const lista = (f.itens[i.os] ??= [])
    if (i.padrao) lista.unshift(i)
    else lista.push(i)
  }
  return [...mapa.values()].sort((a, b) => a.ordem - b.ordem || a.titulo.localeCompare(b.titulo))
}

export const SISTEMAS: Sistema[] = ['windows', 'linux']
export const NOME_SISTEMA: Record<Sistema, string> = { windows: 'Windows', linux: 'Linux' }
export const SHELL: Record<Sistema, string> = { windows: 'PowerShell como Administrador', linux: 'Bash com sudo' }
