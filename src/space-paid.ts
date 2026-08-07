/** unpaid space mode: mono canvas, ghost avatars, garbled chat */
export function unpaid() {
  return !!window.config?.isSpace && !(window.grid?.fastbootParcel as any)?.paid
}

export function sponsorBy() {
  const p = window.grid?.fastbootParcel as any
  return {
    by: (p?.by as string) || '',
    who: (p?.who as string) || '',
    say: ((p?.say as string) || '').slice(0, 50),
  }
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
