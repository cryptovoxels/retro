import type UserInterface from '../../src/user-interface'

declare global {
  interface Window {
    ui?: UserInterface
  }
}

export function InWorldPane({ id }: { id: string }) {
  const ui = window.ui
  if (!ui) return null
  return ui.paneContent(id as any)
}
