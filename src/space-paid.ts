/** unpaid space mode: mono canvas, ghost avatars, garbled chat */
export function unpaid() {
  return !!window.config?.isSpace && !(window.grid?.fastbootParcel as any)?.paid
}

export function sponsorBy() {
  return ((window.grid?.fastbootParcel as any)?.by as string) || ''
}

export function mono(on: boolean) {
  // kill any leftover css filter from the first dumb pass
  const c = document.querySelector('canvas#renderCanvas') as HTMLCanvasElement | null
  if (c) c.style.filter = ''
  window.graphic?.postProcesses?.setMono(on)
}

const G = 'G4RBl3DgArBlEd'
export function garble(s: string) {
  let i = 0
  return s.replace(/[a-zA-Z0-9]/g, () => G[i++ % G.length])
}
