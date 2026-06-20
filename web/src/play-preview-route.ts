import { exitPointerLock } from '../../common/helpers/ui-helpers'
import { app } from './state'

function worldPath(path: string) {
  const p = path.split('?')[0]
  if (p === '/play' || p === '/scratchpad') return true
  if (/^\/spaces\/\d+\/play$/.test(p)) return true
  if (/^\/assets\/\d+\/play$/.test(p)) return true
  if (/^\/parcels\/\d+$/.test(p)) return true
  return false
}

function canvasInWorld() {
  const canvas = document.getElementById('renderCanvas')
  return !!(canvas && document.querySelector('.client-placeholder')?.contains(canvas))
}

export function maybePlayPreview(from: string, to: string) {
  const toPath = to.split('?')[0]
  if (worldPath(toPath)) {
    if (app.playPreview.value) app.playPreview.value = null
    return
  }
  if (!canvasInWorld() || !worldPath(from.split('?')[0])) return

  exitPointerLock()
  window.ui?.hide?.()
  app.enterPlayPreview(from)
}
