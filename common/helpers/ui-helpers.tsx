import { useEffect, useRef } from 'preact/hooks'
import { unmountComponentAtNode } from 'preact/compat'
import { isMobileMedia } from './detector'

// Attempt to unlock. Also blur the canvas so the pointer-lock handler doesn't re-acquire on the next click.
export const exitPointerLock = () => {
  if (!document.pointerLockElement) return
  document.exitPointerLock?.()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
}

export function openDialog(className: string) {
  const el = document.createElement('dialog')
  el.className = className.includes('pointer-lock-close') ? className : `${className} pointer-lock-close`
  ;(document.querySelector('.client') || document.body).appendChild(el)
  exitPointerLock()
  ;(window as any).engine?.setBlur?.(true)

  const close = () => {
    unmountComponentAtNode(el)
    el.remove()
    if (!document.querySelector('.pointer-lock-close,.overlay')) {
      ;(window as any).engine?.setBlur?.(false)
    }
    requestPointerLockIfNoOverlays()
  }
  return { el, close }
}

// allows people to use the space bar to click links and element for for accessibility, e.g. the right hand parcel-tabs
export const extendTabIndexOnClick = () => {
  document.addEventListener(
    'keydown',
    (evt) => {
      if (evt.code == 'Space' && evt.target instanceof HTMLElement && evt.target.tabIndex === 0) {
        evt.target.click()
      }
    },
    { capture: true },
  )
}

export const requestPointerLock = () => {
  const canvas = document.querySelector('canvas#renderCanvas') as HTMLCanvasElement | null
  if (canvas) {
    canvas.focus()
    canvas.requestPointerLock && canvas.requestPointerLock()
  }
}

export const requestPointerLockIfNoOverlays = () => {
  if (!document.querySelector('.pointer-lock-close,.overlay')) {
    if (isMobileMedia()) return // don't request pointer lock on mobile
    requestPointerLock()
  }
}

export const hasPointerLock = () => {
  return !!(document.pointerLockElement || (document as any)['mozPointerLockElement'])
}

// will autofocus any element with this applied to `ref` attribute
export function autoFocusRef(autoFocus = true) {
  if (autoFocus) {
    const ref = useRef(null) as any

    useEffect(() => {
      ref?.current?.focus?.({ preventScroll: true })
    }, [ref])

    return ref
  }
}
