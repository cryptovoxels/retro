import { createPortal } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'
import { isMobile } from '../../../common/helpers/detector'
import { app, AppEvent } from '../state'

let dismissed = false

export function FirstTimeInstructions() {
  const [show, setShow] = useState(!dismissed)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!show) return

    const dismiss = () => {
      if (dismissed) return
      dismissed = true
      setShow(false)
    }

    app.on(AppEvent.CanvasEngaged, dismiss)
    return () => app.removeListener(AppEvent.CanvasEngaged, dismiss)
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
