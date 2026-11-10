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
  controls.autoPerspective = true
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
  const send = (type: number, name = '', button = 0) => {
    const state = { skipNextObservers: false }
    controls.desktopClicks({ type, event: { button, shiftKey: false, preventDefault: vi.fn() }, pickInfo: { pickedMesh: { name } } }, state)
    return state.skipNextObservers
  }
  return { controls, send }
}

for (const editor of [false, true])
  it(`consumes the recapture gesture${editor ? ' with the editor open' : ''}, then allows the next click`, () => {
    const { controls, send } = setup(editor)
    expect(send(BABYLON.PointerEventTypes.POINTERDOWN)).toBe(true)
    expect(send(BABYLON.PointerEventTypes.POINTERUP)).toBe(true)
    expect(send(BABYLON.PointerEventTypes.POINTERTAP)).toBe(true)
    expect(controls.lockedLeftClick).not.toHaveBeenCalled()
    send(BABYLON.PointerEventTypes.POINTERDOWN)
    send(BABYLON.PointerEventTypes.POINTERTAP)
    expect(controls.lockedLeftClick).toHaveBeenCalledTimes(editor ? 0 : 1)
    expect(window.ui!.closeWithPointerLock).not.toHaveBeenCalled()
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

it('keeps voxel editing when recapturing the canvas', () => {
  const { send } = setup()
  const ui = window.ui as any
  ui.voxelTool = ui.activeTool = {}
  ui.exitVoxels = vi.fn()
  expect(send(BABYLON.PointerEventTypes.POINTERDOWN)).toBe(true)
  expect(ui.exitVoxels).not.toHaveBeenCalled()
})

it('right click exits voxel editing without opening a context action', () => {
  const { controls, send } = setup()
  const ui = window.ui as any
  ui.voxelTool = ui.activeTool = {}
  ui.exitVoxels = vi.fn()
  controls.handleContextClick = vi.fn()
  send(BABYLON.PointerEventTypes.POINTERDOWN, '', 2)
  expect(send(BABYLON.PointerEventTypes.POINTERTAP, '', 2)).toBe(true)
  expect(ui.exitVoxels).toHaveBeenCalledOnce()
  expect(controls.handleContextClick).not.toHaveBeenCalled()
})

it('starts close third person, enters first person on lock, and keeps the camera on unlock', () => {
  const { controls } = setup()
  const canvas = document.createElement('canvas')
  const descriptor = Object.getOwnPropertyDescriptor(document, 'pointerLockElement')
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => (lock.value ? canvas : null) })
  controls.scene = { getEngine: () => ({ getRenderingCanvas: () => canvas }) }
  controls.camera = { inputs: { attached: {} }, rotation: { x: 0 }, cameraRotation: { set: vi.fn() } }
  controls.resetControls = vi.fn()
  controls.enterThirdPerson = vi.fn()
  controls.enterFirstPerson = vi.fn()
  try {
    controls.onPointerLockChange()
    expect(controls.enterThirdPerson).not.toHaveBeenCalled()
    controls.persona = {}
    controls.onPointerLockChange()
    expect(controls.enterThirdPerson).toHaveBeenCalledWith(1.5)
    expect(controls.camera.rotation.x).toBe(0.35)
    lock.value = true
    controls.onPointerLockChange()
    expect(controls.enterFirstPerson).toHaveBeenCalledTimes(1)
    controls.camera.rotation.x = -0.23
    controls.onPointerLockChange()
    expect(controls.enterFirstPerson).toHaveBeenCalledTimes(1)
    lock.value = false
    controls.onPointerLockChange()
    expect(controls.targetCameraDistance).toBe(1.5)
    expect(controls.enterThirdPerson).toHaveBeenCalledTimes(1)
    expect(controls.camera.rotation.x).toBe(-0.23)
    controls.autoPerspective = false
    controls.enterFirstPerson.mockClear()
    controls.enterThirdPerson.mockClear()
    lock.value = true
    controls.onPointerLockChange()
    lock.value = false
    controls.onPointerLockChange()
    expect(controls.enterFirstPerson).not.toHaveBeenCalled()
    expect(controls.enterThirdPerson).not.toHaveBeenCalled()
  } finally {
    if (descriptor) Object.defineProperty(document, 'pointerLockElement', descriptor)
    else delete (document as any).pointerLockElement
  }
})
