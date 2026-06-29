import { useEffect, useState } from 'preact/hooks'
import type UserInterface from '../../src/user-interface'

declare global {
  interface Window {
    ui?: UserInterface
  }
}

export function InWorldPane({ id }: { id: string }) {
  const [, tick] = useState(0)

  useEffect(() => {
    const bump = () => tick((n) => n + 1)
    window.addEventListener('panechange', bump)
    return () => window.removeEventListener('panechange', bump)
  }, [])

  const ui = window.ui
  if (!ui) return null
  return ui.paneContent(id as any)
}
