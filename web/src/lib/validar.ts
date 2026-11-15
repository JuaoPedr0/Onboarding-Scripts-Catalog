// Validacao dos parametros no navegador.
//
// Port fiel de `validar` em lib/render.js (o motor que roda no n8n): mesmas
// regras e mesmas mensagens. tests/site.test.js compara as duas implementacoes
// caso a caso; mudou uma, mude a outra.
//
// Este arquivo nao importa nada e usa so sintaxe de tipo apagavel, para o
// teste conseguir carrega-lo direto no Node.

interface Definicao {
  nome: string
  tipo?: string
  regex?: string
  min?: number
  max?: number
  valores?: { valor: string }[]
}

export type Resultado = { valor: string | number | boolean | string[] } | { erro: string }

const RE_PADRAO = /^[A-Za-z0-9._-]{1,128}$/
const RE_HOST = /^[A-Za-z0-9]([A-Za-z0-9._:-]{0,251}[A-Za-z0-9])?$/
const VERDADE = ['1', 'true', 'yes', 'sim', 'on']
const FALSO = ['0', 'false', 'no', 'nao', 'não', 'off']

const curto = (v: unknown) => {
  const s = String(v)
  return s.length > 60 ? s.slice(0, 60) + '...' : s
}

export function validar(def: Definicao, bruto: string | string[]): Resultado {
  const unico = (v: string | string[]) => (Array.isArray(v) ? v[v.length - 1] : v)
  const regexDe = () => (def.regex ? new RegExp(def.regex) : RE_PADRAO)
  switch (def.tipo || 'string') {
    case 'string':
    case 'host': {
      const v = String(unico(bruto)).trim()
      const re = def.tipo === 'host' ? RE_HOST : regexDe()
      return re.test(v) ? { valor: v } : { erro: `'${def.nome}' invalido: ${curto(v)}` }
    }
    case 'enum': {
      const opcoes = (def.valores || []).map((o) => String(o.valor))
      const v = String(unico(bruto)).trim().toLowerCase()
      const achado = opcoes.find((o) => o.toLowerCase() === v)
      return achado !== undefined
        ? { valor: achado }
        : { erro: `'${def.nome}' invalido: ${curto(v)} (use ${opcoes.join(' ou ')})` }
    }
    case 'int': {
      const v = String(unico(bruto)).trim()
      if (!/^\d{1,9}$/.test(v)) return { erro: `'${def.nome}' deve ser numero inteiro: ${curto(v)}` }
      const n = Number.parseInt(v, 10)
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
        return { erro: `'${def.nome}' fora do intervalo ${def.min ?? '-inf'}..${def.max ?? '+inf'}: ${n}` }
      }
      return { valor: n }
    }
    case 'bool': {
      const v = String(unico(bruto)).trim().toLowerCase()
      if (VERDADE.includes(v)) return { valor: true }
      if (FALSO.includes(v)) return { valor: false }
      return { erro: `'${def.nome}' deve ser true ou false: ${curto(v)}` }
    }
    case 'secret': {
      // Nunca devolve o valor na mensagem de erro.
      const v = String(unico(bruto))
      return v.length >= 1 && v.length <= 512 && !/[\u0000-\u001f\u007f]/.test(v)
        ? { valor: v }
        : { erro: `'${def.nome}' invalido: use ate 512 caracteres, sem quebras de linha` }
    }
    case 'lista': {
      const itens = [
        ...new Set(
          (Array.isArray(bruto) ? bruto : [bruto])
            .flatMap((x) => String(x).split(','))
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ]
      const re = regexDe()
      const ruins = itens.filter((x) => !re.test(x))
      return ruins.length
        ? { erro: `'${def.nome}' com item invalido: ${ruins.map(curto).join(', ')}` }
        : { valor: itens }
    }
    default:
      return { erro: `catalogo: tipo desconhecido '${def.tipo}' no parametro '${def.nome}'` }
  }
}
