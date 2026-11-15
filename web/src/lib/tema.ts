import { useCallback, useEffect, useState } from 'react'

export type Tema = 'dark' | 'light'

const atual = (): Tema => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

// O tema inicial e aplicado por um script no index.html; aqui so alternamos.
export function useTema(): [Tema, () => void] {
  const [tema, setTema] = useState<Tema>(atual)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', tema === 'dark')
  }, [tema])
  const alternar = useCallback(() => {
    setTema((t) => {
      const prox = t === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem('ob-theme', prox)
      } catch {
        /* navegacao privada: o tema vale so nesta visita */
      }
      return prox
    })
  }, [])
  return [tema, alternar]
}
