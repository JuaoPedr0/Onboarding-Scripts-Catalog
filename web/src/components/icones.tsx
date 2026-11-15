import { AnimatePresence, motion, type Variants } from 'motion/react'
import { Copy, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const tracar: Variants = {
  repouso: { pathLength: 1, opacity: 1 },
  ativo: { pathLength: [0, 1], opacity: [0.3, 1], transition: { duration: 0.7, ease: 'easeInOut' } },
}

// Icone da categoria. Anima quando `ativo` passa a true (hover ou selecao).
export function IconeCategoria({ categoria, ativo, className }: { categoria: string; ativo: boolean; className?: string }) {
  const estado = ativo ? 'ativo' : 'repouso'
  const cls = cn('size-4.5', className)
  switch (categoria) {
    case 'Monitoramento':
      return (
        <motion.svg {...base} className={cls} initial={false} animate={estado}>
          <motion.path d="M2.5 12h4l2.5-6.5 4.5 13 2.5-6.5h5.5" variants={tracar} />
        </motion.svg>
      )
    case 'Segurança':
      return (
        <motion.svg {...base} className={cls} initial={false} animate={estado}>
          <path d="M12 2.8 19.5 6v5.6c0 4.5-3 7.8-7.5 9.6-4.5-1.8-7.5-5.1-7.5-9.6V6z" />
          <motion.path d="m8.8 12 2.3 2.3 4.2-4.4" variants={tracar} />
        </motion.svg>
      )
    case 'Baseline':
      return (
        <motion.svg {...base} className={cls} initial={false} animate={estado}>
          <motion.path
            d="m12 3 9 4.5-9 4.5-9-4.5z"
            variants={{ repouso: { y: 0 }, ativo: { y: [0, -2, 0], transition: { duration: 0.5 } } }}
          />
          <path d="m3 12 9 4.5 9-4.5" />
          <motion.path
            d="m3 16.5 9 4.5 9-4.5"
            variants={{ repouso: { y: 0 }, ativo: { y: [0, 2, 0], transition: { duration: 0.5 } } }}
          />
        </motion.svg>
      )
    default:
      return (
        <motion.svg {...base} className={cls} initial={false} animate={estado}>
          <motion.path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" variants={tracar} />
          <path d="M4 7.5 12 12l8-4.5M12 12v9" />
        </motion.svg>
      )
  }
}

// Marca do catalogo: um prompt com o cursor piscando.
export function Marca({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary ring-1 ring-primary/25 ring-inset',
        className,
      )}
    >
      <svg {...base} strokeWidth={2.2} className="size-4.5">
        <path d="m5 8 5 4-5 4" />
        <path d="M13 16.5h6" className="animate-cursor" />
      </svg>
    </span>
  )
}

// Copiar que vira um visto desenhado quando `feito`.
export function IconeCopiar({ feito, className }: { feito: boolean; className?: string }) {
  return (
    <span className={cn('relative grid size-4 place-items-center', className)}>
      <AnimatePresence initial={false} mode="wait">
        {feito ? (
          <motion.svg
            key="ok"
            {...base}
            strokeWidth={2.4}
            className="size-4"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.path
              d="m5 12.5 4.5 4.5L19 7.5"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.3, delay: 0.05 }}
            />
          </motion.svg>
        ) : (
          <motion.span
            key="copiar"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Copy className="size-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

// Visto pequeno que se desenha quando um campo fica valido.
export function Visto({ className }: { className?: string }) {
  return (
    <motion.svg
      {...base}
      strokeWidth={2.6}
      className={cn('size-3.5 text-primary', className)}
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.5, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 24 }}
    >
      <motion.path d="m5 12.5 4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25 }} />
    </motion.svg>
  )
}

export function IconeTema({ escuro }: { escuro: boolean }) {
  return (
    <span className="relative grid size-4 place-items-center">
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={escuro ? 'lua' : 'sol'}
          initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {escuro ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
