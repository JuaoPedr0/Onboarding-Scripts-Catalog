import { AnimatePresence, motion } from 'motion/react'
import {
  AppWindow,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  CircleX,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { NOME_SISTEMA, type Config, type Ferramenta, type Sistema } from '@/lib/config'
import {
  arquivoDe,
  arquivosDoRascunho,
  CATEGORIAS,
  checar,
  deToolJson,
  novaChave,
  novaVariante,
  novoParametro,
  paraToolJson,
  rascunhoVazio,
  slugificar,
  TIPOS,
  type Arquivo,
  type Checagem,
  type ParametroRascunho,
  type Rascunho,
  type VarianteRascunho,
} from '@/lib/editor'
import { cn } from '@/lib/utils'
import { Visto } from './icones'

const ICONE_SO = { windows: AppWindow, linux: SquareTerminal }
const ABAS: { id: Checagem['aba']; nome: string }[] = [
  { id: 'ferramenta', nome: 'Ferramenta' },
  { id: 'variantes', nome: 'Variantes' },
  { id: 'parametros', nome: 'Parâmetros' },
  { id: 'envio', nome: 'Revisar e enviar' },
]

interface Props {
  config: Config
  ferramentas: Ferramenta[]
  /** Ferramenta a editar; ausente = nova ferramenta. */
  slug?: string
  onFechar: () => void
}

function lerRascunho(chave: string): Rascunho | null {
  try {
    const bruto = localStorage.getItem(chave)
    return bruto ? (JSON.parse(bruto) as Rascunho) : null
  } catch {
    return null
  }
}

// Baixa do GitHub o estado atual da ferramenta (branch main, nao a release:
// uma edicao parte sempre do que ja foi aprovado, mesmo que ainda nao publicado).
async function carregar(repo: string, slug: string): Promise<Rascunho> {
  const base = `https://raw.githubusercontent.com/${repo}/main/tools/${slug}`
  const buscar = async (nome: string) => {
    const r = await fetch(`${base}/${nome}`, { cache: 'no-store' })
    if (!r.ok) throw new Error(`${nome}: resposta ${r.status}`)
    return r.text()
  }
  const tool = JSON.parse(await buscar('tool.json'))
  // Formato anterior ao das variantes: um script por sistema.
  tool.variantes ??= Object.entries(tool.plataformas ?? {}).map(([os, p]) => ({
    os,
    id: 'padrao',
    rotulo: 'Padrão',
    descricao: (p as { descricao: string }).descricao,
  }))
  const scripts: Record<string, string> = {}
  await Promise.all(
    tool.variantes.map(async (v: { os: Sistema; id: string }) => {
      scripts[arquivoDe(v)] = await buscar(arquivoDe(v))
    }),
  )
  return deToolJson(tool, scripts)
}

function baixar(arquivos: Arquivo[]) {
  arquivos.forEach((a, i) => {
    setTimeout(() => {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([a.conteudo], { type: 'text/plain' }))
      link.download = a.nome
      link.click()
      URL.revokeObjectURL(link.href)
    }, i * 250)
  })
}

export function Editor({ config, ferramentas, slug, onFechar }: Props) {
  const chave = `ob-rascunho:${slug ?? 'novo'}`
  const salvo = useRef(lerRascunho(chave))
  const proximaOrdem = Math.max(0, ...ferramentas.map((f) => f.ordem)) + 10
  const [estado, setEstado] = useState<'carregando' | 'erro' | 'pronto'>(slug && !salvo.current ? 'carregando' : 'pronto')
  const [r, setR] = useState<Rascunho>(() => salvo.current ?? rascunhoVazio(proximaOrdem))
  const [aba, setAba] = useState<Checagem['aba']>('ferramenta')
  const [enviando, setEnviando] = useState(false)
  const [pedido, setPedido] = useState<{ numero: number; url: string } | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const titulo = slug ? (ferramentas.find((f) => f.slug === slug)?.titulo ?? slug) : ''

  useEffect(() => {
    if (salvo.current) {
      toast.info('Rascunho restaurado', {
        description: 'Você tinha alterações não enviadas neste navegador.',
        action: slug ? { label: 'Descartar', onClick: () => descartar() } : undefined,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!slug || estado !== 'carregando') return
    let vivo = true
    carregar(config.repo, slug).then(
      (dados) => vivo && (setR(dados), setEstado('pronto')),
      () => vivo && setEstado('erro'),
    )
    return () => {
      vivo = false
    }
  }, [slug, estado, config.repo, tentativa])

  // Guarda o rascunho neste navegador para um recarregamento nao perder o trabalho.
  useEffect(() => {
    if (estado !== 'pronto' || pedido) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(chave, JSON.stringify(r))
      } catch {
        /* sem armazenamento: o rascunho vale so enquanto a pagina estiver aberta */
      }
    }, 400)
    return () => clearTimeout(t)
  }, [r, estado, pedido, chave])

  const descartar = () => {
    try {
      localStorage.removeItem(chave)
    } catch {
      /* nada a limpar */
    }
    salvo.current = null
    if (slug) {
      setEstado('carregando')
      setTentativa((n) => n + 1)
    } else {
      setR(rascunhoVazio(proximaOrdem))
    }
    setAba('ferramenta')
  }

  const checagens = useMemo(() => checar(r, ferramentas.map((f) => f.slug)), [r, ferramentas])
  const pendentes = checagens.filter((c) => !c.ok)
  const arquivos = useMemo(() => arquivosDoRascunho(r), [r])
  const sistemas = new Set(r.variantes.map((v) => v.os))

  const mudar = (parcial: Partial<Rascunho>) => setR((a) => ({ ...a, ...parcial }))
  const mudarVariante = (id: string, parcial: Partial<VarianteRascunho>) =>
    setR((a) => ({ ...a, variantes: a.variantes.map((v) => (v.chave === id ? { ...v, ...parcial } : v)) }))
  const mudarParametro = (id: string, parcial: Partial<ParametroRascunho>) =>
    setR((a) => ({ ...a, parametros: a.parametros.map((p) => (p.chave === id ? { ...p, ...parcial } : p)) }))

  async function enviar() {
    setEnviando(true)
    try {
      const resp = await fetch(config.envio, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: r.slug, modo: r.modo, autor: r.autor.trim(), resumo: r.resumo.trim(), arquivos }),
      })
      const dados = await resp.json().catch(() => null)
      if (!resp.ok || !dados?.ok) {
        toast.error('O servidor recusou o envio', { description: dados?.erro ?? `Resposta ${resp.status}. Tente de novo em instantes.` })
        return
      }
      try {
        localStorage.removeItem(chave)
      } catch {
        /* nada a limpar */
      }
      setPedido(dados.pr)
      toast.success('Enviado para revisão', { description: `Pedido #${dados.pr.numero} aberto no GitHub.` })
    } catch {
      toast.error('Sem contato com o servidor de onboarding', {
        description: 'O envio só funciona de dentro da rede interna. Seu rascunho continua salvo neste navegador.',
      })
    } finally {
      setEnviando(false)
    }
  }

  if (pedido) {
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-xl border bg-card/80 p-8 text-center backdrop-blur-sm">
        <motion.span
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          className="mx-auto grid size-14 place-items-center rounded-full bg-primary/15"
        >
          <Visto className="size-7" />
        </motion.span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Enviado para revisão</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          O pedido #{pedido.numero} está aberto no GitHub. Ele entra no catálogo depois que o administrador aprovar e publicar uma nova
          versão.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <a href={pedido.url} target="_blank" rel="noopener">
              <ExternalLink />
              Abrir pedido no GitHub
            </a>
          </Button>
          <Button variant="outline" onClick={onFechar}>
            Voltar ao catálogo
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[920px]">
      <Button variant="ghost" size="sm" onClick={onFechar} className="-ml-2 text-muted-foreground">
        <ArrowLeft />
        Voltar ao catálogo
      </Button>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-[28px]">{slug ? `Editar ${titulo}` : 'Novo script'}</h1>
      <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-muted-foreground">
        O que você enviar vira um pedido de revisão no GitHub. Só aparece no catálogo depois de aprovado e publicado.
      </p>

      {estado === 'carregando' && (
        <div className="mt-10 flex items-center gap-3 text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
          Buscando a versão atual no GitHub
        </div>
      )}
      {estado === 'erro' && (
        <div className="mt-8 rounded-xl border border-dashed p-6">
          <p className="font-medium">Não deu para carregar esta ferramenta do GitHub</p>
          <p className="mt-1 text-sm text-muted-foreground">Verifique a conexão e tente de novo.</p>
          <Button variant="outline" className="mt-4" onClick={() => (setEstado('carregando'), setTentativa((n) => n + 1))}>
            <RefreshCw />
            Tentar de novo
          </Button>
        </div>
      )}

      {estado === 'pronto' && (
        <Tabs value={aba} onValueChange={(v) => setAba(v as Checagem['aba'])} className="mt-6 gap-5">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <TabsList>
              {ABAS.map((a) => {
                const n = pendentes.filter((c) => c.aba === a.id).length
                return (
                  <TabsTrigger key={a.id} value={a.id} className="gap-1.5 px-3">
                    {a.nome}
                    {n > 0 && <span className="rounded-full bg-aviso/15 px-1.5 text-[11px] leading-4 font-medium text-aviso">{n}</span>}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>

          <TabsContent value="ferramenta">
            <Cartao>
              <div className="grid gap-5 sm:grid-cols-2">
                <Campo id="ed-titulo" rotulo="Título" ajuda="Nome que aparece no catálogo.">
                  <Input
                    id="ed-titulo"
                    value={r.titulo}
                    placeholder="ex.: Zabbix Agent 2"
                    onChange={(e) => {
                      const titulo = e.target.value
                      const automatico = r.modo === 'novo' && r.slug === slugificar(r.titulo)
                      mudar(automatico ? { titulo, slug: slugificar(titulo) } : { titulo })
                    }}
                  />
                </Campo>
                <Campo id="ed-slug" rotulo="Identificador" ajuda={r.modo === 'editar' ? 'Não muda depois de criado: está nas URLs em uso.' : `Vira ?script=${r.slug || '...'} na URL.`}>
                  <Input
                    id="ed-slug"
                    value={r.slug}
                    disabled={r.modo === 'editar'}
                    onChange={(e) => mudar({ slug: e.target.value.toLowerCase() })}
                    className="font-mono text-[13px]"
                    spellCheck={false}
                  />
                </Campo>
                <Campo rotulo="Categoria" ajuda="Agrupa a ferramenta na lista.">
                  <ToggleGroup type="single" variant="outline" size="sm" value={r.categoria} onValueChange={(v) => v && mudar({ categoria: v })} className="flex-wrap">
                    {CATEGORIAS.map((c) => (
                      <ToggleGroupItem key={c} value={c} className="px-3 data-[state=on]:bg-primary/15 data-[state=on]:text-primary">
                        {c}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Campo>
                <Campo id="ed-ordem" rotulo="Ordem" ajuda="Posição na lista. O menor número aparece primeiro.">
                  <Input id="ed-ordem" value={r.ordem} inputMode="numeric" onChange={(e) => mudar({ ordem: e.target.value })} className="w-28 font-mono text-[13px]" />
                </Campo>
              </div>
              <Chave
                id="ed-ativo"
                rotulo="Mostrar no catálogo"
                ajuda="Desligue para esconder a ferramenta sem apagar os scripts."
                valor={r.ativo}
                onValor={(ativo) => mudar({ ativo })}
                className="mt-5"
              />
            </Cartao>
          </TabsContent>

          <TabsContent value="variantes">
            <Variantes r={r} setR={setR} mudarVariante={mudarVariante} />
          </TabsContent>

          <TabsContent value="parametros">
            <Parametros r={r} setR={setR} mudarParametro={mudarParametro} sistemas={sistemas} />
          </TabsContent>

          <TabsContent value="envio">
            <Cartao>
              <h2 className="text-base font-semibold">Conferência</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {pendentes.length === 0
                  ? 'Tudo certo. As mesmas checagens rodam de novo no GitHub antes da aprovação.'
                  : `${pendentes.length} ${pendentes.length === 1 ? 'item precisa' : 'itens precisam'} de atenção. Toque num item para ir até ele.`}
              </p>
              <ul className="mt-4 flex flex-col gap-1.5">
                {checagens.map((c, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={c.ok}
                      onClick={() => setAba(c.aba)}
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-md px-2 py-1 text-left text-sm',
                        c.ok ? 'text-muted-foreground' : 'text-foreground hover:bg-muted',
                      )}
                    >
                      {c.ok ? <Visto className="mt-0.5 shrink-0" /> : <CircleX className="mt-0.5 size-3.5 shrink-0 text-aviso" />}
                      {c.texto}
                    </button>
                  </li>
                ))}
              </ul>
            </Cartao>

            <Cartao className="mt-5">
              <h2 className="text-base font-semibold">Arquivos do pedido</h2>
              <ul className="mt-3 flex flex-col gap-1 font-mono text-[13px]">
                {arquivos.map((a) => (
                  <li key={a.nome} className="flex justify-between gap-3">
                    <span className="truncate">
                      tools/{r.slug || '...'}/{a.nome}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{(new Blob([a.conteudo]).size / 1024).toFixed(1)} kB</span>
                  </li>
                ))}
              </ul>
              <Collapsible className="mt-3">
                <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                  <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                  Ver o tool.json gerado
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-lg border bg-term p-3 font-mono text-xs leading-5 text-term-foreground">{paraToolJson(r)}</pre>
                </CollapsibleContent>
              </Collapsible>
            </Cartao>

            <Cartao className="mt-5">
              <div className="grid gap-5">
                <Campo id="ed-autor" rotulo="Seu nome" ajuda="Aparece no pedido, para o revisor saber quem enviou.">
                  <Input id="ed-autor" value={r.autor} onChange={(e) => mudar({ autor: e.target.value })} maxLength={80} className="sm:max-w-sm" />
                </Campo>
                <Campo id="ed-resumo" rotulo="O que mudou" ajuda="Uma ou duas frases: o que o script faz, ou o que foi alterado e por quê.">
                  <Textarea id="ed-resumo" value={r.resumo} onChange={(e) => mudar({ resumo: e.target.value })} rows={3} maxLength={1000} />
                </Campo>
              </div>
              {!config.envio && (
                <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  O envio direto não está configurado nesta página. Baixe os arquivos e abra o pedido pelo GitHub.
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={enviar} disabled={enviando || pendentes.length > 0 || !config.envio}>
                  {enviando ? <LoaderCircle className="animate-spin" /> : <Send />}
                  {enviando ? 'Enviando' : 'Enviar para revisão'}
                </Button>
                <Button variant="outline" onClick={() => baixar(arquivos)}>
                  <Download />
                  Baixar arquivos
                </Button>
                <Button variant="ghost" className="text-muted-foreground sm:ml-auto" onClick={descartar}>
                  <Trash2 />
                  Descartar rascunho
                </Button>
              </div>
            </Cartao>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// ---------- Variantes ----------

interface VariantesProps {
  r: Rascunho
  setR: React.Dispatch<React.SetStateAction<Rascunho>>
  mudarVariante: (id: string, parcial: Partial<VarianteRascunho>) => void
}

function Variantes({ r, setR, mudarVariante }: VariantesProps) {
  const [aberta, setAberta] = useState<string | undefined>(r.variantes[0]?.chave)
  const arquivo = useRef<HTMLInputElement>(null)
  const v = r.variantes.find((x) => x.chave === aberta) ?? r.variantes[0]
  const padrao = (x: VarianteRascunho) => r.variantes.find((y) => y.os === x.os) === x

  const adicionar = (nova: VarianteRascunho) => {
    setR((a) => ({ ...a, variantes: [...a.variantes, nova] }))
    setAberta(nova.chave)
  }
  const remover = (x: VarianteRascunho) => {
    setR((a) => ({ ...a, variantes: a.variantes.filter((y) => y.chave !== x.chave) }))
    setAberta(r.variantes.find((y) => y.chave !== x.chave)?.chave)
  }
  const lerArquivo = async (f: File | undefined) => {
    if (!f || !v) return
    if (f.size > 300_000) {
      toast.error('Arquivo grande demais', { description: 'O limite é 300 kB por script.' })
      return
    }
    mudarVariante(v.chave, { conteudo: await f.text() })
    toast.success('Script carregado', { description: f.name })
  }

  return (
    <Cartao>
      <p className="max-w-[68ch] text-sm text-muted-foreground">
        Cada variante é um script para um sistema específico, como Windows Server 2025 ou Red Hat. A primeira de cada sistema é a entregue
        quando a pessoa não escolhe.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {r.variantes.map((x) => {
          const Icone = ICONE_SO[x.os]
          return (
            <button
              key={x.chave}
              type="button"
              onClick={() => setAberta(x.chave)}
              aria-pressed={x === v}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                x === v ? 'border-primary/40 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icone className={cn('size-4', x.os === 'windows' ? 'text-win' : 'text-lnx')} />
              {x.rotulo || 'Sem nome'}
              {padrao(x) && <span className="text-xs text-muted-foreground">padrão</span>}
            </button>
          )
        })}
        {(['windows', 'linux'] as Sistema[]).map((os) => (
          <Button key={os} variant="outline" size="sm" className="h-auto border-dashed bg-transparent py-1.5 text-muted-foreground" onClick={() => adicionar(novaVariante(os, r.variantes))}>
            <Plus />
            {NOME_SISTEMA[os]}
          </Button>
        ))}
      </div>

      {v && (
        <div key={v.chave} className="mt-5 border-t pt-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Campo id="ed-v-rotulo" rotulo="Nome da variante" ajuda={`Como aparece no catálogo, na aba ${NOME_SISTEMA[v.os]}.`}>
              <Input
                id="ed-v-rotulo"
                value={v.rotulo}
                placeholder={v.os === 'windows' ? 'ex.: Windows Server 2025' : 'ex.: Red Hat / Rocky'}
                onChange={(e) => {
                  const rotulo = e.target.value
                  const automatico = v.id !== 'padrao' && v.id === slugificar(v.rotulo)
                  mudarVariante(v.chave, automatico ? { rotulo, id: slugificar(rotulo) } : { rotulo })
                }}
              />
            </Campo>
            <Campo id="ed-v-id" rotulo="Identificador" ajuda={`Arquivo ${v.id ? arquivoDe(v) : '...'}${padrao(v) ? '' : `; na URL, variante=${v.id || '...'}`}`}>
              <Input id="ed-v-id" value={v.id} onChange={(e) => mudarVariante(v.chave, { id: e.target.value.toLowerCase() })} className="font-mono text-[13px]" spellCheck={false} />
            </Campo>
          </div>
          <Campo id="ed-v-desc" rotulo="Descrição" ajuda="O que o script faz neste sistema, em uma ou duas frases." className="mt-5">
            <Textarea id="ed-v-desc" value={v.descricao} onChange={(e) => mudarVariante(v.chave, { descricao: e.target.value })} rows={2} maxLength={300} />
          </Campo>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="ed-v-script">Script</Label>
            <div className="flex flex-wrap gap-1">
              <input ref={arquivo} type="file" accept=".ps1,.sh,.txt,text/plain" hidden onChange={(e) => (lerArquivo(e.target.files?.[0]), (e.target.value = ''))} />
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => arquivo.current?.click()}>
                <FileUp />
                Carregar arquivo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => adicionar({ ...v, chave: novaChave(), id: '', rotulo: '' })}
              >
                <Copy />
                Duplicar como nova variante
              </Button>
            </div>
          </div>
          <Textarea
            id="ed-v-script"
            value={v.conteudo}
            onChange={(e) => mudarVariante(v.chave, { conteudo: e.target.value })}
            rows={18}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="mt-2 max-h-[60vh] min-h-64 overflow-auto bg-term font-mono text-xs leading-5 text-term-foreground dark:bg-term"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {v.conteudo.split('\n').length} linhas. Os parâmetros entram por{' '}
              <span className="font-mono">{v.os === 'windows' ? 'param( )' : 'VAR="${VAR:-padrão}"'}</span>.
            </span>
            {r.variantes.length > 1 && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remover(v)}>
                <Trash2 />
                Remover variante
              </Button>
            )}
          </div>
        </div>
      )}
    </Cartao>
  )
}

// ---------- Parametros ----------

interface ParametrosProps {
  r: Rascunho
  setR: React.Dispatch<React.SetStateAction<Rascunho>>
  mudarParametro: (id: string, parcial: Partial<ParametroRascunho>) => void
  sistemas: Set<Sistema>
}

function Parametros({ r, setR, mudarParametro, sistemas }: ParametrosProps) {
  const [aberto, setAberto] = useState<string>()
  const mover = (i: number, d: number) =>
    setR((a) => {
      const lista = [...a.parametros]
      const [p] = lista.splice(i, 1)
      lista.splice(i + d, 0, p)
      return { ...a, parametros: lista }
    })
  const adicionar = () => {
    const p = novoParametro()
    setR((a) => ({ ...a, parametros: [...a.parametros, p] }))
    setAberto(p.chave)
  }

  return (
    <Cartao>
      <p className="max-w-[68ch] text-sm text-muted-foreground">
        Cada parâmetro vira um campo no catálogo e chega ao script pela variável indicada. Vale para todas as variantes do sistema.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {r.parametros.map((p, i) => (
            <motion.div key={p.chave} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Collapsible open={aberto === p.chave} onOpenChange={(o) => setAberto(o ? p.chave : undefined)} className="rounded-lg border bg-background/40">
                <CollapsibleTrigger className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{p.nome || 'novo_parametro'}</span>
                  <span className="text-xs text-muted-foreground">{TIPOS.find((t) => t.valor === p.tipo)?.nome}</span>
                  {p.obrigatorio && <span className="text-xs text-aviso">obrigatório</span>}
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                  <div className="grid gap-5 border-t px-3.5 py-4 sm:grid-cols-2">
                    <Campo id={`p-${p.chave}-nome`} rotulo="Nome" ajuda="Como aparece na URL: minúsculas, números e _.">
                      <Input id={`p-${p.chave}-nome`} value={p.nome} onChange={(e) => mudarParametro(p.chave, { nome: e.target.value.toLowerCase() })} className="font-mono text-[13px]" spellCheck={false} />
                    </Campo>
                    <Campo rotulo="Tipo" ajuda={TIPOS.find((t) => t.valor === p.tipo)?.ajuda}>
                      <ToggleGroup type="single" variant="outline" size="sm" value={p.tipo} onValueChange={(t) => t && mudarParametro(p.chave, { tipo: t as ParametroRascunho['tipo'] })} className="flex-wrap">
                        {TIPOS.map((t) => (
                          <ToggleGroupItem key={t.valor} value={t.valor} className="px-2.5 data-[state=on]:bg-primary/15 data-[state=on]:text-primary">
                            {t.nome}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Campo>
                    <Campo id={`p-${p.chave}-desc`} rotulo="Descrição" ajuda="Explica o campo para quem preenche." className="sm:col-span-2">
                      <Input id={`p-${p.chave}-desc`} value={p.descricao} onChange={(e) => mudarParametro(p.chave, { descricao: e.target.value })} />
                    </Campo>
                    {p.tipo !== 'bool' && (
                      <Campo id={`p-${p.chave}-padrao`} rotulo="Valor padrão" ajuda={p.tipo === 'lista' ? 'Itens separados por vírgula. Tem de ser o mesmo padrão do script.' : 'Em branco = sem padrão. Tem de ser o mesmo padrão do script.'}>
                        <Input id={`p-${p.chave}-padrao`} value={p.padrao} onChange={(e) => mudarParametro(p.chave, { padrao: e.target.value })} className="font-mono text-[13px]" spellCheck={false} />
                      </Campo>
                    )}
                    {p.tipo !== 'bool' && p.tipo !== 'enum' && (
                      <Campo id={`p-${p.chave}-ex`} rotulo="Exemplo" ajuda="Mostrado dentro do campo vazio.">
                        <Input id={`p-${p.chave}-ex`} value={p.exemplo} onChange={(e) => mudarParametro(p.chave, { exemplo: e.target.value })} className="font-mono text-[13px]" spellCheck={false} />
                      </Campo>
                    )}
                    {(p.tipo === 'string' || p.tipo === 'lista') && (
                      <Campo id={`p-${p.chave}-re`} rotulo="Regex de validação" ajuda={p.tipo === 'lista' ? 'Aplicada a cada item. Em branco: letras, números, ponto, _ e hífen.' : 'Em branco: letras, números, ponto, _ e hífen.'} className="sm:col-span-2">
                        <Input id={`p-${p.chave}-re`} value={p.regex} placeholder="^[A-Za-z0-9._-]{1,128}$" onChange={(e) => mudarParametro(p.chave, { regex: e.target.value })} className="font-mono text-[13px]" spellCheck={false} />
                      </Campo>
                    )}
                    {p.tipo === 'int' && (
                      <>
                        <Campo id={`p-${p.chave}-min`} rotulo="Mínimo">
                          <Input id={`p-${p.chave}-min`} value={p.min} inputMode="numeric" onChange={(e) => mudarParametro(p.chave, { min: e.target.value })} className="font-mono text-[13px]" />
                        </Campo>
                        <Campo id={`p-${p.chave}-max`} rotulo="Máximo">
                          <Input id={`p-${p.chave}-max`} value={p.max} inputMode="numeric" onChange={(e) => mudarParametro(p.chave, { max: e.target.value })} className="font-mono text-[13px]" />
                        </Campo>
                      </>
                    )}
                    {p.tipo === 'enum' && (
                      <Campo id={`p-${p.chave}-val`} rotulo="Opções" ajuda="Uma por linha. Depois de |, uma explicação opcional." className="sm:col-span-2">
                        <Textarea id={`p-${p.chave}-val`} value={p.valores} rows={3} placeholder={'tcp | Padrão, recomendado\nudp'} onChange={(e) => mudarParametro(p.chave, { valores: e.target.value })} className="font-mono text-[13px]" spellCheck={false} />
                      </Campo>
                    )}
                    {sistemas.has('windows') && (
                      <Campo id={`p-${p.chave}-vw`} rotulo="Variável no PowerShell" ajuda="Nome dentro de param( ), sem o $. Em branco: não vale no Windows.">
                        <Input id={`p-${p.chave}-vw`} value={p.varWindows} placeholder="ex.: ZabbixServer" onChange={(e) => mudarParametro(p.chave, { varWindows: e.target.value })} className="font-mono text-[13px]" spellCheck={false} />
                      </Campo>
                    )}
                    {sistemas.has('linux') && (
                      <Campo id={`p-${p.chave}-vl`} rotulo="Variável no Bash" ajuda="Em MAIÚSCULAS. Em branco: não vale no Linux.">
                        <Input id={`p-${p.chave}-vl`} value={p.varLinux} placeholder="ex.: ZABBIX_SERVER" onChange={(e) => mudarParametro(p.chave, { varLinux: e.target.value.toUpperCase() })} className="font-mono text-[13px]" spellCheck={false} />
                      </Campo>
                    )}
                    <Chave
                      id={`p-${p.chave}-obr`}
                      rotulo="Obrigatório"
                      ajuda="O catálogo avisa quando ficar em branco."
                      valor={p.obrigatorio}
                      onValor={(obrigatorio) => mudarParametro(p.chave, { obrigatorio })}
                      className="sm:col-span-2"
                    />
                    {Object.keys(p.resto).length > 0 && (
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        Mantidos como estão no repositório: <span className="font-mono">{Object.keys(p.resto).join(', ')}</span>.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1 sm:col-span-2">
                      <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => mover(i, -1)} className="text-muted-foreground">
                        <ArrowUp />
                        Subir
                      </Button>
                      <Button variant="ghost" size="sm" disabled={i === r.parametros.length - 1} onClick={() => mover(i, 1)} className="text-muted-foreground">
                        <ArrowDown />
                        Descer
                      </Button>
                      <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={() => setR((a) => ({ ...a, parametros: a.parametros.filter((x) => x.chave !== p.chave) }))}>
                        <Trash2 />
                        Remover
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </motion.div>
          ))}
        </AnimatePresence>
        {r.parametros.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Sem parâmetros: o comando do catálogo fica pronto para copiar.</p>}
      </div>
      <Button variant="outline" className="mt-4 border-dashed bg-transparent" onClick={adicionar}>
        <Plus />
        Adicionar parâmetro
      </Button>
    </Cartao>
  )
}

// ---------- pecas ----------

function Cartao({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-xl border bg-card/80 p-4 backdrop-blur-sm sm:p-5', className)}>{children}</section>
}

function Campo({ id, rotulo, ajuda, children, className }: { id?: string; rotulo: string; ajuda?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  )
}

function Chave({ id, rotulo, ajuda, valor, onValor, className }: { id: string; rotulo: string; ajuda: string; valor: boolean; onValor: (v: boolean) => void; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 rounded-lg border bg-background/40 px-3.5 py-3', className)}>
      <div className="min-w-0">
        <Label htmlFor={id}>{rotulo}</Label>
        <p className="mt-1 text-sm text-muted-foreground">{ajuda}</p>
      </div>
      <Switch id={id} checked={valor} onCheckedChange={onValor} className="mt-0.5" />
    </div>
  )
}
