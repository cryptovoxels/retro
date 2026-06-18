import { createPortal } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'
import { isMobile } from '../../../common/helpers/detector'
import { app, AppEvent } from '../state'

const STORAGE_KEY = 'controls-hint-seen'
const MOVEMENT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'])

function hintSeen(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function markHintSeen() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {}
}

let dismissed = hintSeen()

export function FirstTimeInstructions() {
  const [show, setShow] = useState(!dismissed)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!show) return

    const dismiss = () => {
      if (dismissed) return
      dismissed = true
      markHintSeen()
      setShow(false)
    }

    const onKey = (e: KeyboardEvent) => {
      if (MOVEMENT_KEYS.has(e.code)) dismiss()
    }

    const onTouch = () => dismiss()

    app.on(AppEvent.CanvasEngaged, dismiss)
    window.addEventListener('keydown', onKey)
    if (isMobile()) {
      document.addEventListener('touchstart', onTouch, { capture: true, passive: true })
    }
    return () => {
      app.removeListener(AppEvent.CanvasEngaged, dismiss)
      window.removeEventListener('keydown', onKey)
      if (isMobile()) {
        document.removeEventListener('touchstart', onTouch, { capture: true })
      }
    }
  }, [show])

  useEffect(() => {
    if (!show) return

    const find = () => {
      const el = document.querySelector('.client-placeholder') as HTMLElement | null
      if (!el?.isConnected) {
        setHost(null)
        return
      }
      setHost((prev) => (prev === el ? prev : el))
    }

    find()
    const id = window.setInterval(find, 100)
    return () => window.clearInterval(id)
  }, [show])

  if (!show || !host) return null

  return createPortal(
    <dialog open class="first-time">
      {isMobile() ? 'Drag to look around. Use the pad to walk, tap it to jump.' : 'Click to look around, Arrow keys to walk, Press space to jump'}
    </dialog>,
    host,
  )
}
