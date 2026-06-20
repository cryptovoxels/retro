import { effect } from '@preact/signals'
import { route } from 'preact-router'
import { useEffect, useRef, useState } from 'preact/hooks'
import { app } from './state'

export function PlayPreview() {
  const box = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(!!app.playPreview.value)

  useEffect(() => {
    return effect(() => {
      setOn(!!app.playPreview.value)
    })
  }, [])

  useEffect(() => {
    if (!on || !box.current) return

    const ro = new ResizeObserver(() => window.engine?.resize())
    ro.observe(box.current)
    window.engine?.resize()

    return () => ro.disconnect()
  }, [on])

  return (
    <div
      id="world-preview"
      ref={box}
      class={`play-preview${on ? ' on' : ''}`}
      onClick={() => {
        if (!app.playPreview.value) return
        route(app.exitPlayPreview())
      }}
      title="Back to world"
    />
  )
}
