import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, KeyRound, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { comReferencia, type Comando } from '@/lib/comando'
import { SHELL, type Sistema } from '@/lib/config'
import { cn } from '@/lib/utils'
import { IconeCopiar } from './icones'

const lista = (nomes: string[]) =>
  nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`

interface Deposito {
  /** Webhook que guarda os segredos; vazio = recurso desligado nesta pagina. */
  url: string
  script: string
  variante: string
  /** Chamado depois de copiar, para limpar os campos de segredo. */
  aoUsar: () => void
}

// Copia o comando e avisa o resultado. Com campo invalido nao copia; com
// obrigatorio vazio copia, mas diz o que falta trocar.
//
// Segredos nao entram no comando: sao enviados por POST ao servidor de
// onboarding, que devolve uma referencia de uso unico e vida curta. So a
// referencia vai para a area de transferencia.
export function useCopiar(comando: Comando, os: Sistema, deposito: Deposito) {
  const [copiado, setCopiado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const relogio = useRef<number>(undefined)
  useEffect(() => () => clearTimeout(relogio.current), [])

  const copiar = useCallback(async () => {
    if (comando.invalidos.length) {
      toast.error('Comando não copiado', {
        description: `Corrija ${lista(comando.invalidos.map((c) => c.def.nome))} antes de copiar.`,
      })
      return
    }
    let texto = comando.texto
    let validade = 0
    const nomes = Object.keys(comando.segredos)
    if (nomes.length) {
      if (!deposito.url) {
        toast.error('Envio de segredos não configurado nesta página', { description: 'Informe a senha direto na chamada do script.' })
        return
      }
      setOcupado(true)
      try {
        const resp = await fetch(deposito.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script: deposito.script, os, variante: deposito.variante, segredos: comando.segredos }),
        })
        const dados = await resp.json().catch(() => null)
        if (!resp.ok || !dados?.ok || typeof dados.ref !== 'string') {
          toast.error('O servidor não aceitou a credencial', { description: dados?.erro ?? `Resposta ${resp.status}. Tente de novo em instantes.` })
          return
        }
        texto = comReferencia(comando, dados.ref)
        validade = Math.round((Number(dados.expira_em_segundos) || 0) / 60)
      } catch {
        toast.error('Sem contato com o servidor de onboarding', { description: 'A credencial temporária só pode ser criada de dentro da rede interna.' })
        return
      } finally {
        setOcupado(false)
      }
    }
    try {
      await navigator.clipboard.writeText(texto)
    } catch {
      toast.error('O navegador bloqueou a cópia', { description: 'Selecione o comando e copie com Ctrl+C.' })
      return
    }
    setCopiado(true)
    clearTimeout(relogio.current)
    relogio.current = window.setTimeout(() => setCopiado(false), 1800)
    if (nomes.length) {
      deposito.aoUsar()
      toast.success('Comando copiado com credencial temporária', {
        description: `Vale para uma execução${validade ? `, nos próximos ${validade} minutos` : ''}. ${nomes.length === 1 ? 'O campo de senha foi limpo' : 'Os campos de senha foram limpos'}.`,
        duration: 8000,
      })
    } else if (comando.faltando.length) {
      toast.warning('Comando copiado com campos por preencher', {
        description: `Troque ${lista(comando.faltando.map((c) => `<${c.def.nome.toUpperCase()}>`))} antes de executar.`,
      })
    } else {
      toast.success('Comando copiado', { description: `Cole no ${SHELL[os]}.` })
    }
  }, [comando, os, deposito])

  return { copiado, ocupado, copiar }
}

export function Situacao({ comando, curta }: { comando: Comando; curta?: boolean }) {
  if (comando.invalidos.length) {
    return (
      <span className="flex items-center gap-1.5 text-destructive">
        <CircleAlert className="size-4 shrink-0" />
        {curta ? `${comando.invalidos.length} para corrigir` : `Corrija ${lista(comando.invalidos.map((c) => c.def.nome))} para copiar`}
      </span>
    )
  }
  if (comando.faltando.length) {
    return (
      <span className="flex items-center gap-1.5 text-aviso">
        <TriangleAlert className="size-4 shrink-0" />
        {curta
          ? `${comando.obrigatoriosOk} de ${comando.obrigatorios} obrigatórios`
          : `Falta preencher ${lista(comando.faltando.map((c) => c.def.nome))}`}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-primary">
      <CircleCheck className="size-4 shrink-0" />
      {curta ? 'Pronto para copiar' : 'Pronto para colar e executar'}
    </span>
  )
}

interface Props {
  comando: Comando
  os: Sistema
  host: string
  copiado: boolean
  onCopiar: () => void
}

export function Terminal({ comando, os, host, copiado, onCopiar }: Props) {
  const focar = (nome?: string) => {
    const el = nome ? document.getElementById(`campo-${nome}`) : null
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.focus({ preventScroll: true })
  }

  return (
    <section aria-label="Comando gerado" className="overflow-hidden rounded-xl border border-term-border bg-term text-term-foreground shadow-xl shadow-black/15">
      <div className="flex items-center gap-2 border-b border-term-border px-3.5 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <i className="size-2.5 rounded-full bg-[#ff6b5f]/80" />
          <i className="size-2.5 rounded-full bg-[#f2b84b]/80" />
          <i className="size-2.5 rounded-full bg-[#3ed38b]/80" />
        </span>
        <span className="ml-1.5 truncate text-xs text-term-muted">{SHELL[os]}</span>
      </div>

      <pre className="max-h-[46vh] overflow-y-auto px-4 py-4 font-mono text-[13px] leading-6 break-all whitespace-pre-wrap">
        <span aria-hidden className="text-term-muted select-none">{os === 'windows' ? 'PS> ' : '$ '}</span>
        <code>
          {comando.trechos.map((t, i) => {
            if (t.tipo === 'valor') {
              return (
                <motion.span
                  key={`${t.parametro}=${t.texto}`}
                  className="rounded-sm font-medium text-term-valor"
                  initial={{ backgroundColor: 'rgba(94, 234, 212, 0.38)' }}
                  animate={{ backgroundColor: 'rgba(94, 234, 212, 0)' }}
                  transition={{ duration: 0.9, ease: 'easeOut' }}
                >
                  {t.texto}
                </motion.span>
              )
            }
            if (t.tipo === 'falta' || t.tipo === 'invalido') {
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => focar(t.parametro)}
                  title={t.tipo === 'falta' ? 'Ir para o campo' : 'Ir para o campo com erro'}
                  className={cn(
                    'cursor-pointer rounded-sm underline decoration-dashed underline-offset-4 hover:bg-white/10 focus-visible:ring-2 focus-visible:outline-none',
                    t.tipo === 'falta' ? 'text-term-falta focus-visible:ring-term-falta' : 'text-term-erro focus-visible:ring-term-erro',
                  )}
                >
                  {t.texto}
                </button>
              )
            }
            if (t.tipo === 'segredo') {
              return (
                <span key={i} className="inline-flex items-center gap-1 rounded-sm bg-white/10 px-1 text-term-muted" title="A senha não entra no comando: vira uma referência de uso único na hora de copiar">
                  <KeyRound className="size-3" />
                  referência gerada ao copiar
                </span>
              )
            }
            return (
              <span key={i} className={cn(t.tipo === 'chave' && 'text-term-muted', t.tipo === 'url' && 'text-[#b9c4d8]')}>
                {t.texto}
              </span>
            )
          })}
        </code>
        <span aria-hidden className="ml-0.5 inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] animate-cursor bg-term-valor/80" />
      </pre>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-term-border bg-white/[0.02] px-3.5 py-3">
        <div aria-live="polite" className="min-w-0 flex-1 basis-56 text-sm [&_.text-aviso]:text-term-falta [&_.text-destructive]:text-term-erro [&_.text-primary]:text-term-valor">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={comando.invalidos.length ? 'erro' : comando.faltando.length ? 'falta' : 'ok'}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <Situacao comando={comando} />
            </motion.div>
          </AnimatePresence>
        </div>
        <Button
          onClick={onCopiar}
          className="hidden bg-term-valor text-[#04221e] hover:bg-term-valor/90 xl:inline-flex"
          aria-disabled={comando.invalidos.length > 0}
        >
          <IconeCopiar feito={copiado} />
          {copiado ? 'Copiado' : 'Copiar comando'}
        </Button>
      </div>

      <p className="border-t border-term-border px-3.5 py-2.5 text-xs leading-relaxed text-term-muted">
        O script é baixado de <span className="font-mono text-term-foreground/80">{host}</span>, que só responde na rede interna.
      </p>
    </section>
  )
}
