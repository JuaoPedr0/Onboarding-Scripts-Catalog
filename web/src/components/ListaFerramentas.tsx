import { motion } from 'motion/react'
import { Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NOME_SISTEMA, SISTEMAS, type Ferramenta } from '@/lib/config'
import { cn } from '@/lib/utils'
import { IconeCategoria } from './icones'

interface Props {
  /** Diferencia a lista lateral da lista do drawer nas animacoes. */
  id: string
  ferramentas: Ferramenta[]
  selecionada?: string
  onSelecionar: (slug: string) => void
  onNovo: () => void
  atalho?: boolean
}

export function ListaFerramentas({ id, ferramentas, selecionada, onSelecionar, onNovo, atalho }: Props) {
  const [busca, setBusca] = useState('')
  const campo = useRef<HTMLInputElement>(null)

  // "/" leva o foco para a busca, como em sites de documentacao.
  useEffect(() => {
    if (!atalho) return
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement
      if (e.key !== '/' || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return
      e.preventDefault()
      campo.current?.focus()
    }
    addEventListener('keydown', tecla)
    return () => removeEventListener('keydown', tecla)
  }, [atalho])

  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const visiveis = ferramentas.filter((f) => {
      if (!termo) return true
      const texto = [f.titulo, f.categoria, f.slug, ...SISTEMAS.flatMap((s) => (f.itens[s] ?? []).flatMap((i) => [i.descricao, i.rotulo]))].join(' ')
      return texto.toLowerCase().includes(termo)
    })
    const mapa = new Map<string, Ferramenta[]>()
    for (const f of visiveis) mapa.set(f.categoria, [...(mapa.get(f.categoria) ?? []), f])
    return [...mapa.entries()]
  }, [ferramentas, busca])

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={campo}
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar ferramenta"
          aria-label="Buscar ferramenta"
          className="bg-card/70 pr-9 pl-8.5 [&::-webkit-search-cancel-button]:hidden"
        />
        {busca ? (
          <button
            type="button"
            onClick={() => setBusca('')}
            aria-label="Limpar busca"
            className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : atalho ? (
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">
            /
          </kbd>
        ) : null}
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
          <p>Nenhuma ferramenta com “{busca.trim()}”.</p>
          <Button variant="link" size="sm" className="mt-1 h-auto p-0" onClick={() => setBusca('')}>
            Limpar busca
          </Button>
        </div>
      ) : (
        <nav aria-label="Ferramentas" className="flex flex-col gap-5">
          {grupos.map(([categoria, lista]) => (
            <div key={categoria}>
              <p className="mb-1.5 px-2 text-xs font-medium text-muted-foreground">{categoria}</p>
              <ul className="flex flex-col gap-0.5">
                {lista.map((f) => (
                  <li key={f.slug}>
                    <ItemFerramenta id={id} ferramenta={f} ativa={f.slug === selecionada} onClick={() => onSelecionar(f.slug)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      )}

      <Button variant="outline" onClick={onNovo} className="justify-start gap-2 border-dashed bg-transparent text-muted-foreground hover:text-foreground">
        <Plus />
        Novo script
      </Button>
    </div>
  )
}

function ItemFerramenta({ id, ferramenta: f, ativa, onClick }: { id: string; ferramenta: Ferramenta; ativa: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  const sistemas = SISTEMAS.filter((s) => f.itens[s]?.length).map((s) => NOME_SISTEMA[s])
  const variantes = SISTEMAS.reduce((n, s) => n + (f.itens[s]?.length ?? 0), 0)
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      aria-current={ativa ? 'page' : undefined}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        ativa ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {ativa && (
        <motion.span
          layoutId={`${id}-selecao`}
          className="absolute inset-0 rounded-lg border border-primary/25 bg-primary/10"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      <span
        className={cn(
          'relative grid size-9 shrink-0 place-items-center rounded-md border bg-card transition-colors',
          ativa ? 'border-primary/40 text-primary' : 'group-hover:border-input',
        )}
      >
        <IconeCategoria categoria={f.categoria} ativo={hover || ativa} />
      </span>
      <span className="relative min-w-0">
        <span className="block truncate text-sm font-medium">{f.titulo}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {sistemas.join(' e ')}
          {variantes > sistemas.length && `, ${variantes} variantes`}
        </span>
      </span>
    </button>
  )
}
