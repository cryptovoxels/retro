import { expect, it, vi } from 'vitest'
import { InteractionHint } from '../src/controls/interaction-hint'

vi.mock('../common/helpers/ui-helpers', () => ({ hasPointerLock: () => true, isFastviewBlocking: () => false }))
vi.mock('../src/controls/controls', () => ({ featureFromPick: (hit: any) => hit?.pickedMesh?.feature }))

it.each(['sit', 'open'])('measures the %s prompt from the player, even in third person', (action) => {
  const render = new BABYLON.Observable<BABYLON.Scene>()
  const onClick = vi.fn()
  const hit = { pickedPoint: new BABYLON.Vector3(12, 3, 20), distance: 5, pickedMesh: { feature: { interactHint: action, onClick } } }
  const controls = { body: { position: { x: 10, y: 3, z: 20 } }, pickAtView: () => hit, reticuleHighlightPredicate: () => true }
  const hint = new InteractionHint(controls as any, { onAfterRenderObservable: render } as any)
  const label = document.querySelector<HTMLElement>('.interaction-hint')!
  try {
    render.notifyObservers({} as any)
    expect(label.hidden).toBe(false)
    expect(label.textContent).toBe('press E to ' + action)
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }))
    hit.pickedPoint.x += 0.001
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 150)
    render.notifyObservers({} as any)
    expect(label.hidden).toBe(true)
  } finally {
    hint.dispose()
    vi.restoreAllMocks()
  }
})
