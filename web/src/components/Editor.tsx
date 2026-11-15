import { motion } from 'motion/react'
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
  Info,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  SquareTerminal,
  Trash2,
  TriangleAlert,
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
  comParametros,
  deToolJson,
  diagnosticar,
  nomeDeVariavel,
  novaChave,
  novaVariante,
  paraToolJson,
  parametrosDe,
  rascunhoVazio,
  slugificar,
  TIPOS,
  type Arquivo,
  type Checagem,
  type DiagnosticoVariante,
  type Rascunho,
  type VarianteRascunho,
} from '@/lib/editor'
import type { Diagnostico, ParametroMeta, TipoMeta } from '@/lib/metadados'
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

  const mudar = (parcial: Partial<Rascunho>) => setR((a) => ({ ...a, ...parcial }))
  const mudarVariante = (id: string, parcial: Partial<VarianteRascunho>) =>
    setR((a) => ({ ...a, variantes: a.variantes.map((v) => (v.chave === id ? { ...v, ...parcial } : v)) }))
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

          {r.migrado && (
            <p className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm">
              Os parâmetros desta ferramenta estavam no <span className="font-mono">tool.json</span>. Eles foram passados para o bloco{' '}
              <span className="font-mono"># @onboarding</span> de cada script; confira e envie para concluir a migração.
            </p>
          )}

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
            <Parametros r={r} mudarVariante={mudarVariante} />
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
  const diag = useMemo(() => diagnosticar(r), [r])
  const dv = diag.variantes.find((d) => d.variante.chave === v?.chave)

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
      <SeletorVariante r={r} escolhida={v?.chave} onEscolher={setAberta} className="mt-4">
        {(['windows', 'linux'] as Sistema[]).map((os) => (
          <Button key={os} variant="outline" size="sm" className="h-auto border-dashed bg-transparent py-1.5 text-muted-foreground" onClick={() => adicionar(novaVariante(os, r.variantes))}>
            <Plus />
            {NOME_SISTEMA[os]}
          </Button>
        ))}
      </SeletorVariante>

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
              {v.conteudo.split('\n').length} linhas. Declare a variável em{' '}
              <span className="font-mono">{v.os === 'windows' ? 'param( )' : 'VAR="${VAR:-padrão}"'}</span> e descreva-a no bloco <span className="font-mono"># @onboarding</span>.
            </span>
            {r.variantes.length > 1 && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remover(v)}>
                <Trash2 />
                Remover variante
              </Button>
            )}
          </div>
          {dv && (
            <div className="mt-4">
              <Diagnosticos dv={dv} entre={diag.entre} onDeclarar={(variavel) => mudarVariante(v.chave, { conteudo: comParametros(v, [...parametrosDe(v), { name: nomeDeVariavel(variavel), variable: variavel }]) })} />
            </div>
          )}
        </div>
      )}
    </Cartao>
  )
}

// ---------- Diagnostico ----------

const ICONE_NIVEL = { erro: CircleX, aviso: TriangleAlert, info: Info }
const COR_NIVEL = { erro: 'text-destructive', aviso: 'text-aviso', info: 'text-muted-foreground' }

interface DiagnosticosProps {
  dv: DiagnosticoVariante
  entre: Diagnostico[]
  /** Acrescenta aos metadados uma variavel que o script ja declara. */
  onDeclarar: (variavel: string) => void
}

// O que o editor entendeu do script: parametros reconhecidos e o que nao bate
// entre metadados, variaveis e as outras variantes.
function Diagnosticos({ dv, entre, onDeclarar }: DiagnosticosProps) {
  const nomes = new Set(dv.parametros.map((p) => p.name))
  const itens = [...dv.itens, ...entre.filter((g) => g.parametro && nomes.has(g.parametro))]
  const erros = itens.filter((g) => g.nivel === 'erro').length
  return (
    <div className="rounded-lg border bg-background/40 p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">Diagnóstico do script</h3>
        <span className="text-xs text-muted-foreground">
          {dv.parametros.length === 0 ? 'nenhum parâmetro declarado' : `${dv.parametros.length} ${dv.parametros.length === 1 ? 'parâmetro reconhecido' : 'parâmetros reconhecidos'}`}
          {erros > 0 && `, ${erros} ${erros === 1 ? 'erro' : 'erros'}`}
        </span>
      </div>
      {dv.parametros.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {dv.parametros.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 font-mono text-xs">
              {p.type === 'secret' && <KeyRound className="size-3 text-aviso" />}
              {p.name || '(sem nome)'}
              <span className="text-muted-foreground">{p.type ?? 'string'}</span>
            </span>
          ))}
        </div>
      )}
      {itens.length === 0 ? (
        <p className="mt-2.5 flex items-center gap-2 text-sm text-muted-foreground">
          <Visto /> Metadados e variáveis conferem.
        </p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {itens.map((g, i) => {
            const Icone = ICONE_NIVEL[g.nivel]
            return (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Icone className={cn('mt-0.5 size-4 shrink-0', COR_NIVEL[g.nivel])} />
                <span className="min-w-0 flex-1">{g.texto}</span>
                {g.codigo === 'sem-metadados' && g.variavel && (
                  <Button variant="outline" size="sm" className="-my-0.5 h-7 shrink-0 px-2 text-xs" onClick={() => onDeclarar(g.variavel!)}>
                    Declarar
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------- Parametros ----------

interface ParametrosProps {
  r: Rascunho
  mudarVariante: (id: string, parcial: Partial<VarianteRascunho>) => void
}

// Os parametros moram no bloco "# @onboarding" de cada script. Esta aba le o
// bloco da variante escolhida e, a cada alteracao, regrava o bloco no script.
function Parametros({ r, mudarVariante }: ParametrosProps) {
  const [escolhida, setEscolhida] = useState<string | undefined>(r.variantes[0]?.chave)
  const [aberto, setAberto] = useState<number>()
  const diag = useMemo(() => diagnosticar(r), [r])
  const dv = diag.variantes.find((d) => d.variante.chave === escolhida) ?? diag.variantes[0]
  if (!dv) return <Cartao>Adicione uma variante primeiro.</Cartao>
  const v = dv.variante
  const lista = dv.parametros
  const gravar = (nova: ParametroMeta[]) => mudarVariante(v.chave, { conteudo: comParametros(v, nova) })
  const mover = (i: number, d: number) => {
    const nova = [...lista]
    const [p] = nova.splice(i, 1)
    nova.splice(i + d, 0, p)
    gravar(nova)
    setAberto(i + d)
  }
  const bloqueado = dv.itens.some((g) => g.codigo === 'bloco-invalido')

  return (
    <Cartao>
      <p className="max-w-[68ch] text-sm text-muted-foreground">
        Os parâmetros são declarados no início de cada script, no bloco <span className="font-mono text-foreground/80"># @onboarding</span>. O que você
        editar aqui é gravado nesse bloco; o que editar no script aparece aqui.
      </p>
      <SeletorVariante r={r} escolhida={v.chave} onEscolher={(c) => (setEscolhida(c), setAberto(undefined))} className="mt-4" />

      <div className="mt-4">
        <Diagnosticos dv={dv} entre={diag.entre} onDeclarar={(variavel) => gravar([...lista, { name: nomeDeVariavel(variavel), variable: variavel }])} />
      </div>

      {bloqueado ? (
        <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Corrija o bloco de metadados na aba Variantes para editar os parâmetros aqui.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2">
            {lista.map((p, i) => (
              <ItemParametro
                key={`${v.chave}:${i}:${lista.length}`}
                p={p}
                os={v.os}
                aberto={aberto === i}
                onAbrir={(o) => setAberto(o ? i : undefined)}
                onMudar={(novo) => gravar(lista.map((x, j) => (j === i ? novo : x)))}
                onRemover={() => (gravar(lista.filter((_, j) => j !== i)), setAberto(undefined))}
                onSubir={i > 0 ? () => mover(i, -1) : undefined}
                onDescer={i < lista.length - 1 ? () => mover(i, 1) : undefined}
              />
            ))}
            {lista.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Sem parâmetros: o comando do catálogo fica pronto para copiar.</p>}
          </div>
          <Button variant="outline" className="mt-4 border-dashed bg-transparent" onClick={() => (gravar([...lista, { name: '', variable: '' }]), setAberto(lista.length))}>
            <Plus />
            Adicionar parâmetro
          </Button>
        </>
      )}
    </Cartao>
  )
}

interface ItemProps {
  p: ParametroMeta
  os: Sistema
  aberto: boolean
  onAbrir: (o: boolean) => void
  onMudar: (p: ParametroMeta) => void
  onRemover: () => void
  onSubir?: () => void
  onDescer?: () => void
}

const textoDe = (v: unknown) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v))
const opcoesComoTexto = (p: ParametroMeta) =>
  (p.options ?? []).map((o) => (typeof o === 'string' ? o : o.description ? `${o.value} | ${o.description}` : o.value)).join('\n')

function ItemParametro({ p, os, aberto, onAbrir, onMudar, onRemover, onSubir, onDescer }: ItemProps) {
  const tipo = p.type ?? 'string'
  // Campos de texto livre guardam o que foi digitado; o bloco recebe o valor ja tipado.
  const [t, setT] = useState({ padrao: textoDe(p.default), opcoes: opcoesComoTexto(p), aliases: textoDe(p.aliases), min: textoDe(p.min), max: textoDe(p.max) })

  // Monta o parametro limpo: campo vazio nao vai para o bloco.
  const montar = (parcial: Partial<ParametroMeta>, textos = t): ParametroMeta => {
    const base = { ...p, ...parcial }
    const tp = base.type ?? 'string'
    const novo: ParametroMeta = { name: base.name, variable: base.variable }
    if (base.type) novo.type = base.type
    if (base.required) novo.required = true
    const padrao = textos.padrao.trim()
    if (tp === 'bool') {
      if (base.default === true) novo.default = true
    } else if (tp === 'list') {
      const itens = padrao.split(',').map((x) => x.trim()).filter(Boolean)
      if (itens.length) novo.default = itens
    } else if (tp !== 'secret' && padrao) {
      novo.default = tp === 'int' && /^\d+$/.test(padrao) ? Number(padrao) : padrao
    }
    if (base.description) novo.description = base.description
    if (base.example && tp !== 'bool' && tp !== 'enum' && tp !== 'secret') novo.example = base.example
    if (base.regex && (tp === 'string' || tp === 'list')) novo.regex = base.regex
    if (tp === 'int') {
      if (/^-?\d+$/.test(textos.min.trim())) novo.min = Number(textos.min)
      if (/^-?\d+$/.test(textos.max.trim())) novo.max = Number(textos.max)
    }
    if (tp === 'enum') {
      novo.options = textos.opcoes.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const i = l.indexOf('|')
        return i < 0 ? l : { value: l.slice(0, i).trim(), description: l.slice(i + 1).trim() }
      })
    }
    const aliases = textos.aliases.split(',').map((x) => x.trim()).filter(Boolean)
    if (aliases.length) novo.aliases = aliases
    return novo
  }
  const mudar = (parcial: Partial<ParametroMeta>) => onMudar(montar(parcial))
  const mudarTexto = (parcial: Partial<typeof t>) => {
    const textos = { ...t, ...parcial }
    setT(textos)
    onMudar(montar({}, textos))
  }
  const id = (campo: string) => `p-${p.variable || 'novo'}-${campo}`
  const mono = 'font-mono text-[13px]'

  return (
    <Collapsible open={aberto} onOpenChange={onAbrir} className="rounded-lg border bg-background/40">
      <CollapsibleTrigger className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {tipo === 'secret' && <KeyRound className="size-3.5 shrink-0 text-aviso" />}
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{p.name || 'novo_parametro'}</span>
        <span className="hidden truncate font-mono text-xs text-muted-foreground sm:block">{p.variable && (os === 'windows' ? `$${p.variable}` : p.variable)}</span>
        <span className="text-xs text-muted-foreground">{TIPOS.find((x) => x.valor === tipo)?.nome ?? tipo}</span>
        {p.required && <span className="text-xs text-aviso">obrigatório</span>}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="grid gap-5 border-t px-3.5 py-4 sm:grid-cols-2">
          <Campo id={id('nome')} rotulo="Nome" ajuda="Como aparece na URL: minúsculas, números e _.">
            <Input id={id('nome')} value={p.name ?? ''} onChange={(e) => mudar({ name: e.target.value.toLowerCase() })} className={mono} spellCheck={false} />
          </Campo>
          <Campo id={id('var')} rotulo={os === 'windows' ? 'Variável no PowerShell' : 'Variável no Bash'} ajuda={os === 'windows' ? 'Nome dentro de param( ), sem o $.' : 'Em MAIÚSCULAS, declarada como VAR="${VAR:-}".'}>
            <Input id={id('var')} value={p.variable ?? ''} onChange={(e) => mudar({ variable: os === 'linux' ? e.target.value.toUpperCase() : e.target.value })} className={mono} spellCheck={false} />
          </Campo>
          <Campo rotulo="Tipo" ajuda={TIPOS.find((x) => x.valor === tipo)?.ajuda} className="sm:col-span-2">
            <ToggleGroup type="single" variant="outline" size="sm" value={tipo} onValueChange={(x) => x && mudar({ type: x as TipoMeta })} className="flex-wrap">
              {TIPOS.map((x) => (
                <ToggleGroupItem key={x.valor} value={x.valor} className="px-2.5 data-[state=on]:bg-primary/15 data-[state=on]:text-primary">
                  {x.nome}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Campo>
          <Campo id={id('desc')} rotulo="Descrição" ajuda="Explica o campo para quem preenche." className="sm:col-span-2">
            <Input id={id('desc')} value={p.description ?? ''} onChange={(e) => mudar({ description: e.target.value })} />
          </Campo>
          {tipo === 'secret' ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground sm:col-span-2">
              No catálogo este campo é mascarado. O valor não vai para a URL, para o GitHub nem para o rascunho: o host o busca uma única vez por uma
              referência temporária. Segredo não tem valor padrão nem exemplo.
            </p>
          ) : tipo === 'bool' ? (
            <Chave id={id('padrao')} rotulo="Ligado por padrão" ajuda="Tem de ser o mesmo padrão do script." valor={p.default === true} onValor={(x) => mudar({ default: x ? true : undefined })} className="sm:col-span-2" />
          ) : (
            <Campo id={id('padrao')} rotulo="Valor padrão" ajuda={tipo === 'list' ? 'Itens separados por vírgula. Tem de ser o mesmo padrão do script.' : 'Em branco = sem padrão. Tem de ser o mesmo padrão do script.'}>
              <Input id={id('padrao')} value={t.padrao} onChange={(e) => mudarTexto({ padrao: e.target.value })} className={mono} spellCheck={false} />
            </Campo>
          )}
          {tipo !== 'bool' && tipo !== 'enum' && tipo !== 'secret' && (
            <Campo id={id('ex')} rotulo="Exemplo" ajuda="Mostrado dentro do campo vazio.">
              <Input id={id('ex')} value={p.example ?? ''} onChange={(e) => mudar({ example: e.target.value })} className={mono} spellCheck={false} />
            </Campo>
          )}
          {(tipo === 'string' || tipo === 'list') && (
            <Campo id={id('re')} rotulo="Regex de validação" ajuda={tipo === 'list' ? 'Aplicada a cada item. Em branco: letras, números, ponto, _ e hífen.' : 'Em branco: letras, números, ponto, _ e hífen.'} className="sm:col-span-2">
              <Input id={id('re')} value={p.regex ?? ''} placeholder="^[A-Za-z0-9._-]{1,128}$" onChange={(e) => mudar({ regex: e.target.value })} className={mono} spellCheck={false} />
            </Campo>
          )}
          {tipo === 'int' && (
            <>
              <Campo id={id('min')} rotulo="Mínimo">
                <Input id={id('min')} value={t.min} inputMode="numeric" onChange={(e) => mudarTexto({ min: e.target.value })} className={mono} />
              </Campo>
              <Campo id={id('max')} rotulo="Máximo">
                <Input id={id('max')} value={t.max} inputMode="numeric" onChange={(e) => mudarTexto({ max: e.target.value })} className={mono} />
              </Campo>
            </>
          )}
          {tipo === 'enum' && (
            <Campo id={id('val')} rotulo="Opções" ajuda="Uma por linha. Depois de |, uma explicação opcional." className="sm:col-span-2">
              <Textarea id={id('val')} value={t.opcoes} rows={3} placeholder={'tcp | Padrão, recomendado\nudp'} onChange={(e) => mudarTexto({ opcoes: e.target.value })} className={mono} spellCheck={false} />
            </Campo>
          )}
          <Campo id={id('alias')} rotulo="Nomes alternativos" ajuda="Outros nomes aceitos na URL, separados por vírgula. Opcional." className="sm:col-span-2">
            <Input id={id('alias')} value={t.aliases} onChange={(e) => mudarTexto({ aliases: e.target.value.toLowerCase() })} className={mono} spellCheck={false} />
          </Campo>
          <Chave id={id('obr')} rotulo="Obrigatório" ajuda="O catálogo avisa quando ficar em branco." valor={p.required === true} onValor={(x) => mudar({ required: x })} className="sm:col-span-2" />
          <div className="flex flex-wrap gap-1 sm:col-span-2">
            <Button variant="ghost" size="sm" disabled={!onSubir} onClick={onSubir} className="text-muted-foreground">
              <ArrowUp />
              Subir
            </Button>
            <Button variant="ghost" size="sm" disabled={!onDescer} onClick={onDescer} className="text-muted-foreground">
              <ArrowDown />
              Descer
            </Button>
            <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={onRemover}>
              <Trash2 />
              Remover
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SeletorVariante({ r, escolhida, onEscolher, className, children }: { r: Rascunho; escolhida?: string; onEscolher: (chave: string) => void; className?: string; children?: ReactNode }) {
  const padrao = (x: VarianteRascunho) => r.variantes.find((y) => y.os === x.os) === x
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {r.variantes.map((x) => {
        const Icone = ICONE_SO[x.os]
        return (
          <button
            key={x.chave}
            type="button"
            onClick={() => onEscolher(x.chave)}
            aria-pressed={x.chave === escolhida}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              x.chave === escolhida ? 'border-primary/40 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icone className={cn('size-4', x.os === 'windows' ? 'text-win' : 'text-lnx')} />
            {x.rotulo || 'Sem nome'}
            {padrao(x) && <span className="text-xs text-muted-foreground">padrão</span>}
          </button>
        )
      })}
      {children}
    </div>
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
