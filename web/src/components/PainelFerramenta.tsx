import { AnimatePresence, motion } from 'motion/react'
import { AppWindow, ChevronDown, ChevronsUpDown, ChevronUp, ExternalLink, History, Pencil, RotateCcw, SquareTerminal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { montarComando, type Valor, type Valores } from '@/lib/comando'
import { NOME_SISTEMA, SISTEMAS, type Config, type Ferramenta, type Sistema } from '@/lib/config'
import { cn } from '@/lib/utils'
import { CampoParametro } from './CampoParametro'
import { IconeCategoria, IconeCopiar } from './icones'
import { Situacao, Terminal, useCopiar } from './Terminal'

const ICONE_SO = { windows: AppWindow, linux: SquareTerminal }

interface Props {
  config: Config
  ferramenta: Ferramenta
  os: Sistema
  variante: string
  onOs: (os: Sistema) => void
  onVariante: (id: string) => void
  onEditar: () => void
  valores: Valores
  onValores: (v: Valores) => void
  onTrocar: () => void
}

export function PainelFerramenta({ config, ferramenta, os, variante, onOs, onVariante, onEditar, valores, onValores, onTrocar }: Props) {
  const variantes = ferramenta.itens[os] ?? []
  const item = variantes.find((v) => v.variante === variante) ?? variantes[0]
  const comando = useMemo(() => montarComando(item, config.base, valores), [item, config.base, valores])
  const { copiado, copiar } = useCopiar(comando, os)

  const obrigatorios = comando.campos.filter((c) => c.def.obrigatorio)
  const opcionais = comando.campos.filter((c) => !c.def.obrigatorio)
  const [abertos, setAbertos] = useState(obrigatorios.length === 0)
  const [previa, setPrevia] = useState(false)
  const alterados = comando.campos.filter((c) => c.estado === 'ok' || c.estado === 'invalido').length
  const opcionaisEmUso = opcionais.filter((c) => c.estado === 'ok' || c.estado === 'invalido').length

  const definir = (nome: string, v: Valor | undefined) => onValores({ ...valores, [nome]: v })
  const gh = `https://github.com/${config.repo}`
  const host = new URL(config.base).host

  return (
    <div className="mx-auto max-w-[1080px]">
      {/* Troca de ferramenta em telas sem a lista lateral */}
      <Button variant="outline" onClick={onTrocar} className="mb-5 h-11 w-full justify-between bg-card/70 px-3 lg:hidden">
        <span className="flex min-w-0 items-center gap-2.5">
          <IconeCategoria categoria={ferramenta.categoria} ativo={false} className="text-primary" />
          <span className="truncate">{ferramenta.titulo}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Trocar ferramenta
          <ChevronsUpDown className="size-4" />
        </span>
      </Button>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{ferramenta.titulo}</h1>
        <Badge variant="secondary">{ferramenta.categoria}</Badge>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Tabs value={os} onValueChange={(v) => onOs(v as Sistema)}>
          <TabsList aria-label="Sistema operacional">
            {SISTEMAS.filter((s) => ferramenta.itens[s]?.length).map((s) => {
              const Icone = ICONE_SO[s]
              return (
                <TabsTrigger key={s} value={s} className="gap-1.5 px-3.5">
                  <Icone className={cn('size-4', s === os && (s === 'windows' ? 'text-win' : 'text-lnx'))} />
                  {NOME_SISTEMA[s]}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1 text-sm">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
            <a href={`${gh}/blob/${config.tag}/${item.arquivo}`} target="_blank" rel="noopener">
              <ExternalLink />
              Ver código
            </a>
          </Button>
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
            <a href={`${gh}/commits/main/${item.arquivo}`} target="_blank" rel="noopener">
              <History />
              Histórico
            </a>
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onEditar}>
            <Pencil />
            Editar
          </Button>
        </div>
      </div>

      {variantes.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-muted-foreground">Variante</span>
          <ToggleGroup type="single" variant="outline" size="sm" value={item.variante} onValueChange={(v) => v && onVariante(v)} aria-label="Variante do sistema" className="flex-wrap">
            {variantes.map((v) => (
              <ToggleGroupItem key={v.variante} value={v.variante} className="px-3 data-[state=on]:bg-primary/15 data-[state=on]:text-primary">
                {v.rotulo}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={`${item.slug}/${item.os}/${item.variante}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-muted-foreground">{item.descricao}</p>

          <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <section aria-label="Parâmetros" className="rounded-xl border bg-card/80 p-4 backdrop-blur-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Parâmetros</h2>
                <AnimatePresence>
                  {alterados > 0 && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                      <Button variant="ghost" size="sm" className="-my-1 text-muted-foreground" onClick={() => onValores({})}>
                        <RotateCcw />
                        Limpar
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {comando.campos.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Este script não tem parâmetros. É só copiar o comando.</p>
              ) : (
                <>
                  {obrigatorios.length > 0 && (
                    <>
                      <Progresso feitos={comando.obrigatoriosOk} total={comando.obrigatorios} />
                      <div className="mt-4 flex flex-col gap-5">
                        {obrigatorios.map((c) => (
                          <CampoParametro key={c.def.nome} campo={c} valor={valores[c.def.nome]} onValor={(v) => definir(c.def.nome, v)} />
                        ))}
                      </div>
                    </>
                  )}

                  {opcionais.length > 0 && (
                    <Collapsible open={abertos} onOpenChange={setAbertos} className={cn(obrigatorios.length > 0 && 'mt-3 border-t pt-3')}>
                      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-md py-1.5 text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                        <span>
                          Opcionais
                          <span className="ml-1.5 font-normal text-muted-foreground">
                            {opcionaisEmUso > 0 ? `${opcionaisEmUso} de ${opcionais.length} em uso` : `${opcionais.length} disponíveis`}
                          </span>
                        </span>
                        <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                        <div className="flex flex-col gap-5 pt-3">
                          {opcionais.map((c) => (
                            <CampoParametro key={c.def.nome} campo={c} valor={valores[c.def.nome]} onValor={(v) => definir(c.def.nome, v)} />
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </>
              )}
            </section>

            <div className="xl:sticky xl:top-20">
              <Terminal comando={comando} os={os} host={host} copiado={copiado} onCopiar={copiar} />
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Barra fixa em telas de uma coluna: a acao principal fica sempre a mao,
          e o comando pode ser conferido sem rolar ate o fim do formulario. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md xl:hidden">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 lg:pl-72">
          <button
            type="button"
            onClick={() => setPrevia(true)}
            aria-label="Ver o comando gerado"
            className="-mx-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span aria-live="polite" className="min-w-0 truncate">
              <Situacao comando={comando} curta />
            </span>
            <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
          </button>
          <Button onClick={copiar} size="lg" className="shrink-0 px-4">
            <IconeCopiar feito={copiado} />
            {copiado ? 'Copiado' : 'Copiar comando'}
          </Button>
        </div>
      </div>

      <Drawer open={previa} onOpenChange={setPrevia}>
        <DrawerContent className="xl:hidden">
          <DrawerHeader className="pb-3 text-left">
            <DrawerTitle>Comando para {NOME_SISTEMA[os]}</DrawerTitle>
            <DrawerDescription>Toque num campo destacado para ir até ele.</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={(e) => (e.target as HTMLElement).closest('pre button') && setPrevia(false)}>
            <Terminal comando={comando} os={os} host={host} copiado={copiado} onCopiar={copiar} />
            <Button onClick={copiar} size="lg" className="mt-4 w-full">
              <IconeCopiar feito={copiado} />
              {copiado ? 'Copiado' : 'Copiar comando'}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function Progresso({ feitos, total }: { feitos: number; total: number }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Obrigatórios</span>
        <span className="font-mono">
          {feitos}/{total}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={feitos}>
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={false}
          animate={{ width: `${(feitos / total) * 100}%` }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        />
      </div>
    </div>
  )
}
