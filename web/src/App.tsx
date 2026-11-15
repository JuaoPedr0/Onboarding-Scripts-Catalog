import { MotionConfig } from 'motion/react'
import { CircleCheck, GitBranch, Info, OctagonX, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Toaster } from 'sonner'
import { Cabecalho } from '@/components/Cabecalho'
import { Fundo } from '@/components/Fundo'
import { ListaFerramentas } from '@/components/ListaFerramentas'
import { PainelFerramenta } from '@/components/PainelFerramenta'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Valores } from '@/lib/comando'
import { agrupar, SISTEMAS, type Config, type Ferramenta, type Sistema } from '@/lib/config'
import { useTema } from '@/lib/tema'

// Sistema de quem esta abrindo a pagina, para ja abrir na aba certa.
const sistemaLocal = (): Sistema => (/Windows/i.test(navigator.userAgent) ? 'windows' : 'linux')

function lerRota(ferramentas: Ferramenta[]): { slug?: string; os: Sistema } {
  const [, slug, os] = location.hash.split('/')
  const f = ferramentas.find((x) => x.slug === slug) ?? ferramentas[0]
  const pedido = SISTEMAS.includes(os as Sistema) ? (os as Sistema) : sistemaLocal()
  return { slug: f?.slug, os: f?.itens[pedido] ? pedido : (SISTEMAS.find((s) => f?.itens[s]) ?? pedido) }
}

export function App({ config }: { config: Config }) {
  const ferramentas = useMemo(() => agrupar(config.catalogo.itens), [config])
  const [rota, setRota] = useState(() => lerRota(ferramentas))
  const [valores, setValores] = useState<Record<string, Valores>>({})
  const [menu, setMenu] = useState(false)
  const [tema, alternarTema] = useTema()
  // Em tela larga o aviso fica no canto, fora do caminho do terminal.
  const [larga, setLarga] = useState(() => matchMedia('(min-width: 1280px)').matches)
  useEffect(() => {
    const mq = matchMedia('(min-width: 1280px)')
    const mudou = () => setLarga(mq.matches)
    mq.addEventListener('change', mudou)
    return () => mq.removeEventListener('change', mudou)
  }, [])

  useEffect(() => {
    const mudou = () => setRota(lerRota(ferramentas))
    addEventListener('hashchange', mudou)
    return () => removeEventListener('hashchange', mudou)
  }, [ferramentas])

  const ir = useCallback(
    (slug: string, os?: Sistema) => {
      const f = ferramentas.find((x) => x.slug === slug)
      if (!f) return
      const pedido = os ?? rota.os
      const destino = f.itens[pedido] ? pedido : SISTEMAS.find((s) => f.itens[s])!
      history.replaceState(null, '', `#/${slug}/${destino}`)
      setRota({ slug, os: destino })
    },
    [ferramentas, rota.os],
  )

  const ferramenta = ferramentas.find((f) => f.slug === rota.slug)
  const chave = `${rota.slug}/${rota.os}`

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <Fundo />
        <div className="relative z-10 flex min-h-dvh flex-col">
          <Cabecalho config={config} tema={tema} onTema={alternarTema} onMenu={() => setMenu(true)} />

          <div className="mx-auto flex w-full max-w-[1440px] flex-1">
            <aside className="hidden w-72 shrink-0 border-r bg-background/50 backdrop-blur-sm lg:block">
              <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto p-4">
                <ListaFerramentas id="lateral" ferramentas={ferramentas} selecionada={rota.slug} onSelecionar={(s) => ir(s)} atalho />
              </div>
            </aside>

            <main className="min-w-0 flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 xl:pb-12">
              {ferramenta ? (
                <PainelFerramenta
                  key={ferramenta.slug}
                  config={config}
                  ferramenta={ferramenta}
                  os={rota.os}
                  onOs={(os) => ir(ferramenta.slug, os)}
                  valores={valores[chave] ?? {}}
                  onValores={(v) => setValores((t) => ({ ...t, [chave]: v }))}
                  onTrocar={() => setMenu(true)}
                />
              ) : (
                <div className="mx-auto mt-16 max-w-md rounded-xl border border-dashed p-8 text-center">
                  <p className="font-medium">Nenhuma ferramenta nesta release</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Adicione uma pasta em <span className="font-mono">tools/</span> no repositório e publique uma nova tag.
                  </p>
                </div>
              )}
            </main>
          </div>
        </div>

        <Drawer open={menu} onOpenChange={setMenu}>
          <DrawerContent className="lg:hidden">
            <DrawerHeader className="pb-2 text-left">
              <DrawerTitle>Ferramentas</DrawerTitle>
              <DrawerDescription>Escolha o que instalar no host.</DrawerDescription>
            </DrawerHeader>
            <div className="overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <ListaFerramentas
                id="gaveta"
                ferramentas={ferramentas}
                selecionada={rota.slug}
                onSelecionar={(s) => {
                  ir(s)
                  setMenu(false)
                }}
              />
              <a
                href={`https://github.com/${config.repo}`}
                target="_blank"
                rel="noopener"
                className="mt-5 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground hover:text-foreground"
              >
                <GitBranch className="size-4" />
                Repositório no GitHub
              </a>
            </div>
          </DrawerContent>
        </Drawer>

        <Toaster
          theme={tema}
          position={larga ? 'bottom-right' : 'top-center'}
          offset={larga ? 24 : 64}
          mobileOffset={64}
          icons={{
            success: <CircleCheck className="size-4 text-primary" />,
            info: <Info className="size-4" />,
            warning: <TriangleAlert className="size-4 text-aviso" />,
            error: <OctagonX className="size-4 text-destructive" />,
          }}
          style={
            {
              '--normal-bg': 'var(--popover)',
              '--normal-text': 'var(--popover-foreground)',
              '--normal-border': 'var(--border)',
              '--border-radius': 'var(--radius)',
            } as React.CSSProperties
          }
          toastOptions={{ classNames: { description: '!text-muted-foreground' } }}
        />
      </TooltipProvider>
    </MotionConfig>
  )
}
