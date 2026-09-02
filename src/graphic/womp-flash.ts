import type { ColorGrader } from './color-grading'

declare global {
  interface Window {
    _color?: ColorGrader
  }
}

let flashing = false

export function wompFlash(scene: BABYLON.Scene) {
  const color = window._color
  if (!color || flashing) return

  const pp = color.postProcess
  const base = pp.exposure
  const peak = 2.2

  flashing = true
  pp.exposure = peak

  let elapsed = 0
  const obs = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime()
    if (elapsed < 40) return

    const t = Math.min(1, (elapsed - 40) / 120)
    pp.exposure = base + (peak - base) * (1 - t)

    if (t >= 1) {
      pp.exposure = base
      scene.onBeforeRenderObservable.remove(obs)
      flashing = false
    }
  })
}
