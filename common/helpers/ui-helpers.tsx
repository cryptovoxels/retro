import { useEffect, useRef } from 'preact/hooks'
import { unmountComponentAtNode } from 'preact/compat'
import { isMobileMedia } from './detector'

// Attempt to unlock. Also blur the canvas so the pointer-lock handler doesn't re-acquire on the next click.
export const exitPointerLock = () => {
  if (!document.pointerLockElement) return
  document.exitPointerLock?.()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
}

const FASTVIEW_MOUSE = 100
const FASTVIEW_WALK = 0.1
const NFT_BOUNCE_MS = 200

/** True while fastview owns locked left-clicks (open or bouncing out). */
let fastviewBlocksWorld = false

export function isFastviewBlocking() {
  return fastviewBlocksWorld
}

export function mediaSize(ar: number, zoom: number) {
  const maxW = innerWidth * 0.85
  const maxH = innerHeight * 0.7
  let w = maxW * zoom
  let h = w / ar
  if (h > maxH * zoom) {
    h = maxH * zoom
    w = h * ar
  }
  return { w, h }
}

export function openDialog(className: string, fastview = false) {
  const el = document.createElement('dialog')
  el.className = className.includes('pointer-lock-close') ? className : `${className} pointer-lock-close`
  ;(document.querySelector('.client') || document.body).appendChild(el)

  if (!fastview) {
    exitPointerLock()
  }

  ;(window as any).engine?.setBlur?.(true)

  let dist = 0
  let inFastview = fastview
  let closed = false
  let dismissing = false
  let walkObs: any = null
  let walkScene: any = null
  const origin = { x: 0, y: 0, z: 0 }

  const onWheel = (e: WheelEvent) => {
    if (!inFastview) return
    e.preventDefault()
    e.stopPropagation()
  }

  const stopFastviewListeners = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('pointerlockchange', onLockChange)
    document.removeEventListener('wheel', onWheel, true)
    if (walkObs && walkScene?.onBeforeRenderObservable) {
      walkScene.onBeforeRenderObservable.remove(walkObs)
      walkObs = null
    }
  }

  const teardown = () => {
    if (closed) return
    closed = true
    inFastview = false
    dismissing = false
    fastviewBlocksWorld = false
    el.classList.remove('fastview')
    delete (el as any).dismiss
    stopFastviewListeners()
    el.removeEventListener('click', onButtonClick, true)
    unmountComponentAtNode(el)
    el.remove()
    if (!document.querySelector('.pointer-lock-close,.overlay')) {
      ;(window as any).engine?.setBlur?.(false)
    }
    requestPointerLockIfNoOverlays()
  }

  const dismiss = () => {
    if (closed || dismissing) return
    if (el.classList.contains('nft-view')) {
      dismissing = true
      inFastview = false
      el.classList.remove('fastview')
      stopFastviewListeners()
      el.classList.add('-out')
      setTimeout(teardown, NFT_BOUNCE_MS)
      return
    }
    teardown()
  }
  ;(el as any).dismiss = dismiss

  const onMove = (e: MouseEvent) => {
    if (!inFastview || !hasPointerLock()) return
    dist += Math.hypot(e.movementX || 0, e.movementY || 0)
    if (dist > FASTVIEW_MOUSE) dismiss()
  }

  const onButtonClick = (e: MouseEvent) => {
    const t = e.target as Element | null
    if (!t?.closest) return
    if (t.closest('button, a')) dismiss()
  }

  const leaveFastView = () => {
    if (!inFastview) return
    inFastview = false
    fastviewBlocksWorld = false
    el.classList.remove('fastview')
    stopFastviewListeners()
  }

  const onLockChange = () => {
    if (inFastview && !hasPointerLock()) leaveFastView()
  }

  if (fastview) {
    fastviewBlocksWorld = true
    el.classList.add('fastview')
    document.addEventListener('mousemove', onMove)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('wheel', onWheel, { passive: false, capture: true })

    const cam = (window as any).connector?.controls?.camera
    walkScene = (window as any).connector?.scene
    const pos = cam?.globalPosition || cam?.position
    if (pos && walkScene?.onBeforeRenderObservable) {
      origin.x = pos.x
      origin.y = pos.y
      origin.z = pos.z
      walkObs = walkScene.onBeforeRenderObservable.add(() => {
        if (!inFastview) return
        const p = cam.globalPosition || cam.position
        const dx = p.x - origin.x
        const dy = p.y - origin.y
        const dz = p.z - origin.z
        if (dx * dx + dy * dy + dz * dz > FASTVIEW_WALK * FASTVIEW_WALK) dismiss()
      })
    }
  }
  el.addEventListener('click', onButtonClick, true)

  return { el, close: dismiss }
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
