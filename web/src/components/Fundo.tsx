import { useEffect, useRef } from 'react'

const PASSO = 44 // mesmo passo da grade desenhada em CSS
const CAUDA = 110

interface Pulso {
  // Cantos percorridos; o ultimo ponto e a cabeca.
  pts: { x: number; y: number }[]
  dx: number
  dy: number
  vel: number
  vida: number
}

// Fundo da pagina: uma grade discreta com pulsos de luz que correm pelas
// linhas, como pacotes numa rede. Fica parado com "reduzir movimento" e
// pausa quando a aba nao esta visivel.
export function Fundo() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let largura = 0
    let altura = 0
    let cor = '53 214 194'
    let raf = 0
    let anterior = 0
    let pulsos: Pulso[] = []

    const lerCor = () => {
      cor = getComputedStyle(document.documentElement).getPropertyValue('--pulso').trim() || cor
    }
    const medir = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      largura = innerWidth
      altura = innerHeight
      canvas.width = largura * dpr
      canvas.height = altura * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const novo = (): Pulso => {
      const horizontal = Math.random() < 0.5
      const sentido = Math.random() < 0.5 ? 1 : -1
      const x = Math.round((Math.random() * largura) / PASSO) * PASSO
      const y = Math.round((Math.random() * altura) / PASSO) * PASSO
      return {
        pts: [{ x, y }, { x, y }],
        dx: horizontal ? sentido : 0,
        dy: horizontal ? 0 : sentido,
        vel: 50 + Math.random() * 70,
        vida: 5 + Math.random() * 6,
      }
    }

    const quadro = (agora: number) => {
      const dt = Math.min((agora - anterior) / 1000, 0.05)
      anterior = agora
      ctx.clearRect(0, 0, largura, altura)

      const alvo = largura < 768 ? 5 : 11
      while (pulsos.length < alvo) pulsos.push(novo())

      for (const p of pulsos) {
        p.vida -= dt
        const cabeca = p.pts[p.pts.length - 1]
        const antes = { x: cabeca.x, y: cabeca.y }
        cabeca.x += p.dx * p.vel * dt
        cabeca.y += p.dy * p.vel * dt

        // Ao cruzar um no da grade, as vezes vira 90 graus.
        const eixo = p.dx !== 0 ? 'x' : 'y'
        const no = p.dx + p.dy > 0 ? Math.floor(cabeca[eixo] / PASSO) * PASSO : Math.ceil(cabeca[eixo] / PASSO) * PASSO
        const cruzou = (antes[eixo] - no) * (cabeca[eixo] - no) < 0
        if (cruzou && Math.random() < 0.3) {
          cabeca[eixo] = no
          const sentido = Math.random() < 0.5 ? 1 : -1
          if (p.dx !== 0) {
            p.dx = 0
            p.dy = sentido
          } else {
            p.dy = 0
            p.dx = sentido
          }
          p.pts.push({ x: cabeca.x, y: cabeca.y })
        }

        // Cauda: percorre os trechos de tras para frente, esmaecendo.
        const brilho = Math.min(1, p.vida, 1.2) * 0.75
        let resto = CAUDA
        for (let i = p.pts.length - 1; i > 0 && resto > 0; i--) {
          const a = p.pts[i]
          const b = p.pts[i - 1]
          const comp = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
          if (comp === 0) continue
          const usado = Math.min(comp, resto)
          const fx = a.x + ((b.x - a.x) * usado) / comp
          const fy = a.y + ((b.y - a.y) * usado) / comp
          const g = ctx.createLinearGradient(a.x, a.y, fx, fy)
          g.addColorStop(0, `rgb(${cor} / ${(brilho * resto) / CAUDA})`)
          g.addColorStop(1, `rgb(${cor} / ${(brilho * (resto - usado)) / CAUDA})`)
          ctx.strokeStyle = g
          ctx.lineWidth = 1.25
          ctx.beginPath()
          ctx.moveTo(a.x + 0.5, a.y + 0.5)
          ctx.lineTo(fx + 0.5, fy + 0.5)
          ctx.stroke()
          resto -= usado
        }
        ctx.fillStyle = `rgb(${cor} / ${brilho})`
        ctx.beginPath()
        ctx.arc(cabeca.x + 0.5, cabeca.y + 0.5, 1.6, 0, Math.PI * 2)
        ctx.fill()
        if (p.pts.length > 8) p.pts.splice(0, p.pts.length - 8)
      }

      pulsos = pulsos.filter(
        (p) => {
          const c = p.pts[p.pts.length - 1]
          return p.vida > 0 && c.x > -CAUDA && c.x < largura + CAUDA && c.y > -CAUDA && c.y < altura + CAUDA
        },
      )
      raf = requestAnimationFrame(quadro)
    }

    const iniciar = () => {
      cancelAnimationFrame(raf)
      anterior = performance.now()
      raf = requestAnimationFrame(quadro)
    }
    const visibilidade = () => (document.hidden ? cancelAnimationFrame(raf) : iniciar())
    const tema = new MutationObserver(lerCor)

    medir()
    lerCor()
    iniciar()
    addEventListener('resize', medir)
    document.addEventListener('visibilitychange', visibilidade)
    tema.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', medir)
      document.removeEventListener('visibilitychange', visibilidade)
      tema.disconnect()
    }
  }, [])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(var(--grade) 1px, transparent 1px), linear-gradient(90deg, var(--grade) 1px, transparent 1px)',
          backgroundSize: `${PASSO}px ${PASSO}px`,
        }}
      />
      <canvas ref={ref} className="absolute inset-0 size-full" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(60rem 32rem at 85% -10%, rgb(var(--pulso) / 0.10), transparent 70%), radial-gradient(ellipse at 50% 120%, var(--background) 30%, transparent 75%)',
        }}
      />
    </div>
  )
}
