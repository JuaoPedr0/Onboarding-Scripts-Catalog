import { GitBranch, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Config } from '@/lib/config'
import type { Tema } from '@/lib/tema'
import { IconeTema, Marca } from './icones'

interface Props {
  config: Config
  tema: Tema
  onTema: () => void
  onMenu: () => void
}

export function Cabecalho({ config, tema, onTema, onMenu }: Props) {
  const gh = `https://github.com/${config.repo}`
  const data = config.publicado ? new Date(config.publicado).toLocaleDateString('pt-BR') : ''
  return (
    <header className="sticky top-0 z-40 border-b bg-background/75 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2.5 px-3 sm:px-4 lg:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Abrir lista de ferramentas">
          <Menu />
        </Button>
        <Marca />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-semibold tracking-tight">Catálogo de Onboarding</p>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">Scripts de provisionamento de hosts</p>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={`${gh}/releases/tag/${config.tag}`}
                target="_blank"
                rel="noopener"
                className="mr-1 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-xs text-primary transition-colors hover:bg-primary/20 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                </span>
                {config.tag}
              </a>
            </TooltipTrigger>
            <TooltipContent>
              Release em produção{data ? `, publicada em ${data}` : ''}. Abrir notas da versão.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild className="hidden sm:inline-flex">
                <a href={gh} target="_blank" rel="noopener" aria-label="Abrir o repositório no GitHub">
                  <GitBranch />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Repositório no GitHub</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onTema} aria-label={tema === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}>
                <IconeTema escuro={tema === 'dark'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tema === 'dark' ? 'Tema claro' : 'Tema escuro'}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
