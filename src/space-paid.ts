/** unpaid space mode: mono canvas, ghost avatars, garbled chat */
export function unpaid() {
  return !!window.config?.isSpace && !(window.grid?.fastbootParcel as any)?.paid
}

export function sponsorBy() {
  return ((window.grid?.fastbootParcel as any)?.by as string) || ''
}

export function mono(on: boolean) {
  const c = document.querySelector('canvas#renderCanvas') as HTMLCanvasElement | null
  if (!c) return
  c.style.filter = on ? 'saturate(0%)' : ''
}

const G = 'G4RBl3DgArBlEd'
export function garble(s: string) {
  let i = 0
  return s.replace(/[a-zA-Z0-9]/g, () => G[i++ % G.length])
}
