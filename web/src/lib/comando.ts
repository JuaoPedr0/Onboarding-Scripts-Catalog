import type { Item, Parametro } from './config'
import { validar } from './validar'

// Valor de um campo do formulario: texto digitado, chave ligada ou itens de lista.
export type Valor = string | boolean | string[]
export type Valores = Record<string, Valor | undefined>

export type Estado = 'vazio' | 'ok' | 'invalido' | 'padrao'

export interface Campo {
  def: Parametro
  estado: Estado
  /** Texto que entra na URL (ja validado), quando estado === 'ok'. */
  texto?: string
  /** Mensagem para o usuario, quando estado === 'invalido'. */
  erro?: string
}

export interface Trecho {
  texto: string
  tipo: 'shell' | 'url' | 'chave' | 'valor' | 'falta' | 'invalido'
  parametro?: string
}

const padraoComoTexto = (p: Parametro): string => {
  const d = p.padrao
  if (d === null || d === undefined) return ''
  return Array.isArray(d) ? d.join(',') : String(d)
}

// Mensagens em linguagem de quem preenche, em vez do erro tecnico do motor.
function explicar(p: Parametro): string {
  switch (p.tipo) {
    case 'host':
      return 'Use um IP ou nome de host, sem espaços nem http://'
    case 'int':
      return p.min !== undefined && p.max !== undefined
        ? `Use um número inteiro entre ${p.min} e ${p.max}`
        : 'Use um número inteiro'
    case 'lista':
      return 'Um dos itens tem caracteres não aceitos'
    case 'enum':
      return `Escolha ${(p.valores || []).map((v) => v.valor).join(' ou ')}`
    default:
      return p.exemplo ? `Formato não aceito. Exemplo: ${p.exemplo}` : 'Formato não aceito para este campo'
  }
}

export function avaliar(def: Parametro, valor: Valor | undefined): Campo {
  let bruto: string | string[]
  if (def.tipo === 'bool') {
    if (valor === undefined) return { def, estado: 'vazio' }
    bruto = valor ? 'true' : 'false'
  } else if (Array.isArray(valor)) {
    if (!valor.length) return { def, estado: 'vazio' }
    bruto = valor
  } else {
    const t = typeof valor === 'string' ? valor.trim() : ''
    if (!t) return { def, estado: 'vazio' }
    bruto = t
  }
  const r = validar(def, bruto)
  if ('erro' in r) return { def, estado: 'invalido', erro: explicar(def) }
  const texto = Array.isArray(r.valor) ? r.valor.join(',') : String(r.valor)
  // Igual ao padrao do script: nao precisa ir na URL.
  if (texto === padraoComoTexto(def)) return { def, estado: 'padrao' }
  return { def, estado: 'ok', texto }
}

// encodeURIComponent deixa o apostrofo passar; a URL vai entre aspas simples.
const enc = (s: string) => encodeURIComponent(s).replace(/'/g, '%27')
const encLista = (s: string) => s.split(',').map(enc).join(',')

export interface Comando {
  trechos: Trecho[]
  texto: string
  url: string
  campos: Campo[]
  faltando: Campo[]
  invalidos: Campo[]
  obrigatorios: number
  obrigatoriosOk: number
}

export function montarComando(item: Item, base: string, valores: Valores): Comando {
  const campos = item.parametros.map((p) => avaliar(p, valores[p.nome]))
  const variante = item.padrao ? '' : `&variante=${item.variante}`
  const url: Trecho[] = [{ texto: `${base}?script=${item.slug}&os=${item.os}${variante}`, tipo: 'url' }]

  for (const c of campos) {
    const p = c.def
    if (c.estado === 'ok') {
      url.push({ texto: `&${p.nome}=`, tipo: 'chave', parametro: p.nome })
      url.push({ texto: p.tipo === 'lista' ? encLista(c.texto!) : enc(c.texto!), tipo: 'valor', parametro: p.nome })
    } else if (c.estado === 'invalido') {
      url.push({ texto: `&${p.nome}=`, tipo: 'chave', parametro: p.nome })
      url.push({ texto: `<${p.nome.toUpperCase()}>`, tipo: 'invalido', parametro: p.nome })
    } else if (p.obrigatorio && c.estado === 'vazio') {
      url.push({ texto: `&${p.nome}=`, tipo: 'chave', parametro: p.nome })
      url.push({ texto: `<${p.nome.toUpperCase()}>`, tipo: 'falta', parametro: p.nome })
    }
  }

  const [antes, depois] =
    item.os === 'windows' ? ["$s = irm '", "'; & ([ScriptBlock]::Create($s))"] : ["curl -fsSL '", "' | sudo bash"]
  const trechos: Trecho[] = [{ texto: antes, tipo: 'shell' }, ...url, { texto: depois, tipo: 'shell' }]

  const obrig = campos.filter((c) => c.def.obrigatorio)
  return {
    trechos,
    texto: trechos.map((t) => t.texto).join(''),
    url: url.map((t) => t.texto).join(''),
    campos,
    faltando: obrig.filter((c) => c.estado === 'vazio'),
    invalidos: campos.filter((c) => c.estado === 'invalido'),
    obrigatorios: obrig.length,
    obrigatoriosOk: obrig.filter((c) => c.estado === 'ok' || c.estado === 'padrao').length,
  }
}
