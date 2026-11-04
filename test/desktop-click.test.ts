import { expect, it, vi } from 'vitest'
import DesktopControls from '../src/controls/desktop/controls'

const lock = vi.hoisted(() => ({ value: false }))
vi.mock('../src/controls/controls', () => ({ default: class {}, featureFromPick: () => null, CAMERA_DISTANCE: 3, MAX_CAMERA_DISTANCE: 6, MIN_CAMERA_DISTANCE: 1 }))
vi.mock('../src/controls/utils/fps-camera', () => ({ createFirstPersonCamera: vi.fn() }))
vi.mock('../src/utils/helpers', () => ({ decodeCoordsFromURL: vi.fn() }))
vi.mock('../common/helpers/ui-helpers', () => ({ hasPointerLock: () => lock.value, isFastviewBlocking: () => false }))
vi.mock('../src/store', () => ({ hoveredNft: {}, uiPane: {} }))
vi.mock('../web/src/state', () => ({ app: {}, AppEvent: {}, likedArt: {}, toggleLike: vi.fn() }))
vi.mock('../src/tools/gizmos', () => ({ pointerOverGizmo: () => false }))

function setup(editor = false, pending = false) {
  lock.value = false
  const controls: any = Object.create(DesktopControls.prototype)
  controls.requestPointerLock = vi.fn(() => {
    if (!pending) lock.value = true
  })
  controls.lockedLeftClick = vi.fn()
  controls.pickAtReticule = vi.fn()
  const featureTool = { selection: { mode: 'edit' } }
  ;(window as any).ui = {
    state: editor ? { feature: {} } : {},
    featureTool,
    activeTool: editor ? featureTool : null,
    closeWithPointerLock: vi.fn(() => {
      window.ui!.activeTool = null
      controls.requestPointerLock()
    }),
  }
  const send = (type: number, name = '') => {
    const state = { skipNextObservers: false }
    controls.desktopClicks({ type, event: { button: 0, shiftKey: false }, pickInfo: { pickedMesh: { name } } }, state)
    return state.skipNextObservers
  }
  return { controls, send }
}

for (const editor of [false, true])
  it(`consumes the recapture gesture${editor ? ' when closing the editor' : ''}, then allows the next click`, () => {
    const { controls, send } = setup(editor)
    expect(send(BABYLON.PointerEventTypes.POINTERDOWN)).toBe(true)
    expect(send(BABYLON.PointerEventTypes.POINTERUP)).toBe(true)
    expect(send(BABYLON.PointerEventTypes.POINTERTAP)).toBe(true)
    expect(controls.lockedLeftClick).not.toHaveBeenCalled()
    send(BABYLON.PointerEventTypes.POINTERDOWN)
    send(BABYLON.PointerEventTypes.POINTERTAP)
    expect(controls.lockedLeftClick).toHaveBeenCalledTimes(1)
  })

it('consumes release and tap while pointer lock is still pending', () => {
  const { controls, send } = setup(false, true)
  send(BABYLON.PointerEventTypes.POINTERDOWN)
  expect(send(BABYLON.PointerEventTypes.POINTERUP)).toBe(true)
  expect(send(BABYLON.PointerEventTypes.POINTERTAP)).toBe(true)
  expect(controls.lockedLeftClick).not.toHaveBeenCalled()
})

it('leaves action buttons unlocked and clickable', () => {
  const { controls, send } = setup()
  expect(send(BABYLON.PointerEventTypes.POINTERDOWN, 'feature/basicGui/drive')).toBe(false)
  expect(send(BABYLON.PointerEventTypes.POINTERUP)).toBe(false)
  expect(controls.requestPointerLock).not.toHaveBeenCalled()
})
