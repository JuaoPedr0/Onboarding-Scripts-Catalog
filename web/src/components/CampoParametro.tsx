import { AnimatePresence, motion } from 'motion/react'
import { Eye, EyeOff, X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type Campo, type Valor } from '@/lib/comando'
import type { Parametro } from '@/lib/config'
import { validar } from '@/lib/validar'
import { cn } from '@/lib/utils'
import { Visto } from './icones'

interface Props {
  campo: Campo
  valor: Valor | undefined
  onValor: (v: Valor | undefined) => void
}

const padraoLegivel = (p: Parametro): string => {
  const d = p.padrao
  if (d === null || d === undefined || d === '') return ''
  return Array.isArray(d) ? d.join(', ') : String(d)
}

export function CampoParametro({ campo, valor, onValor }: Props) {
  const p = campo.def
  const id = `campo-${p.nome}`
  // O erro so aparece depois que a pessoa sai do campo pela primeira vez.
  const [tocado, setTocado] = useState(false)
  const erro = tocado && campo.estado === 'invalido' ? campo.erro : undefined
  const padrao = padraoLegivel(p)

  if (p.tipo === 'bool') {
    const ligado = typeof valor === 'boolean' ? valor : p.padrao === true
    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border bg-background/40 px-3.5 py-3">
        <div className="min-w-0">
          <Label htmlFor={id} className="font-mono text-[13px]">
            {p.nome}
          </Label>
          {p.descricao && <p className="mt-1 text-sm text-muted-foreground">{p.descricao}</p>}
        </div>
        <Switch id={id} checked={ligado} onCheckedChange={(v) => onValor(v)} className="mt-0.5" />
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1.5', erro && 'animate-tremor')}>
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="font-mono text-[13px]">
          {p.nome}
        </Label>
        {p.obrigatorio && <span className="text-xs text-aviso">obrigatório</span>}
        <AnimatePresence>{campo.estado === 'ok' && <Visto key="ok" />}</AnimatePresence>
      </div>
      {p.descricao && <p className="text-sm text-muted-foreground">{p.descricao}</p>}

      {p.tipo === 'enum' ? (
        <Opcoes id={id} p={p} valor={typeof valor === 'string' ? valor : ''} onValor={onValor} />
      ) : p.tipo === 'lista' ? (
        <Lista
          id={id}
          p={p}
          itens={Array.isArray(valor) ? valor : []}
          onItens={(v) => onValor(v.length ? v : undefined)}
          onSair={() => setTocado(true)}
          invalido={!!erro}
        />
      ) : p.tipo === 'secret' ? (
        <Segredo id={id} valor={typeof valor === 'string' ? valor : ''} onValor={onValor} onSair={() => setTocado(true)} invalido={!!erro} />
      ) : (
        <Input
          id={id}
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => onValor(e.target.value || undefined)}
          onBlur={() => setTocado(true)}
          placeholder={p.exemplo ? `ex.: ${p.exemplo}` : padrao || undefined}
          inputMode={p.tipo === 'int' ? 'numeric' : undefined}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!erro}
          aria-describedby={`${id}-ajuda`}
          className="bg-background/60 font-mono text-[13px]"
        />
      )}

      <div id={`${id}-ajuda`} className="text-xs empty:hidden">
        <AnimatePresence initial={false} mode="wait">
          {erro ? (
            <motion.p
              key="erro"
              role="alert"
              className="text-destructive"
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {erro}
            </motion.p>
          ) : p.tipo === 'secret' ? (
            <motion.p key="segredo" className="text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Não vai para a URL: o host busca por uma referência de uso único. O campo é limpo depois de copiar.
            </motion.p>
          ) : padrao && p.tipo !== 'enum' ? (
            <motion.p key="padrao" className="text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Em branco, o script usa <span className="font-mono text-foreground/80">{padrao}</span>
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

// Campo de segredo: mascarado, com botao para ver por um instante.
// O valor fica so na memoria da pagina; nunca em localStorage nem na URL.
function Segredo({ id, valor, onValor, onSair, invalido }: { id: string; valor: string; onValor: (v: Valor | undefined) => void; onSair: () => void; invalido: boolean }) {
  const [visivel, setVisivel] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={visivel ? 'text' : 'password'}
        value={valor}
        onChange={(e) => onValor(e.target.value || undefined)}
        onBlur={() => {
          setVisivel(false)
          onSair()
        }}
        autoComplete="new-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        aria-invalid={invalido}
        aria-describedby={`${id}-ajuda`}
        className="bg-background/60 pr-10 font-mono text-[13px]"
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisivel((v) => !v)}
        aria-label={visivel ? 'Ocultar' : 'Mostrar por um instante'}
        aria-pressed={visivel}
        className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {visivel ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

function Opcoes({ id, p, valor, onValor }: { id: string; p: Parametro; valor: string; onValor: (v: Valor | undefined) => void }) {
  const atual = valor || (typeof p.padrao === 'string' ? p.padrao : '')
  const descricao = p.valores?.find((v) => v.valor === atual)?.descricao
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <ToggleGroup
        id={id}
        type="single"
        variant="outline"
        size="sm"
        value={atual}
        onValueChange={(v) => v && onValor(v)}
        aria-label={p.nome}
      >
        {(p.valores ?? []).map((o) => (
          <ToggleGroupItem key={o.valor} value={o.valor} className="font-mono text-[13px] data-[state=on]:bg-primary/15 data-[state=on]:text-primary">
            {o.valor}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {descricao && <span className="text-sm text-muted-foreground">{descricao}</span>}
    </div>
  )
}

interface ListaProps {
  id: string
  p: Parametro
  itens: string[]
  onItens: (v: string[]) => void
  onSair: () => void
  invalido: boolean
}

// Campo de lista: cada item vira uma etiqueta. Enter, virgula ou espaco
// confirmam o item; Backspace no campo vazio apaga o ultimo.
function Lista({ id, p, itens, onItens, onSair, invalido }: ListaProps) {
  const [texto, setTexto] = useState('')
  const itemValido = (item: string) => !('erro' in validar({ ...p, tipo: 'lista' }, item))

  const confirmar = (bruto: string) => {
    const novos = bruto.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    if (novos.length) onItens([...new Set([...itens, ...novos])])
    setTexto('')
  }
  const tecla = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      confirmar(texto)
    } else if (e.key === 'Backspace' && !texto && itens.length) {
      onItens(itens.slice(0, -1))
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background/60 px-2 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30',
        invalido && 'border-destructive ring-destructive/20',
      )}
      onClick={() => document.getElementById(id)?.focus()}
    >
      <AnimatePresence initial={false}>
        {itens.map((item) => (
          <motion.span
            key={item}
            layout
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border py-0.5 pr-1 pl-2 font-mono text-xs',
              itemValido(item) ? 'border-primary/30 bg-primary/10 text-primary' : 'border-destructive/50 bg-destructive/10 text-destructive',
            )}
          >
            {item}
            <button
              type="button"
              aria-label={`Remover ${item}`}
              onClick={(e) => {
                e.stopPropagation()
                onItens(itens.filter((i) => i !== item))
              }}
              className="grid size-4 place-items-center rounded-sm opacity-70 hover:bg-foreground/10 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input
        id={id}
        value={texto}
        onChange={(e) => (/[,\s]/.test(e.target.value) ? confirmar(e.target.value) : setTexto(e.target.value))}
        onKeyDown={tecla}
        onBlur={() => {
          confirmar(texto)
          onSair()
        }}
        placeholder={itens.length ? '' : p.exemplo ? `ex.: ${p.exemplo}` : 'Digite e tecle Enter'}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={`${id}-ajuda`}
        className="min-w-24 flex-1 bg-transparent py-0.5 font-mono text-[13px] outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
