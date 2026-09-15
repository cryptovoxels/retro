// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../common/helpers/detector', () => ({ isDesktop: () => true, isMobile: () => false }))
vi.mock('../src/user', () => ({ User: class {} }))
vi.mock('../src/avatar', () => ({ default: class {} }))
vi.mock('../src/features/feature', () => ({ default: class {} }))
vi.mock('../src/connector', () => ({ default: class {} }))
vi.mock('../src/controls/utils/player-camera', () => ({ default: class {} }))
vi.mock('../src/controls/utils/player-body', () => ({ default: class {}, WALK: 2.78, RUN: 12.65 }))
vi.mock('../common/helpers/utils', () => ({}))
vi.mock('../common/helpers/ui-helpers', () => ({ hasPointerLock: () => false }))
vi.mock('../src/utils/loading-done', () => ({}))
vi.mock('../src/utils/camera', () => ({}))

const bundle = readFileSync('dist/vendor/library-6.11.2.max.js', 'utf8')
const runtime: any = { console, setTimeout, clearTimeout }
runInNewContext(bundle.slice(0, bundle.indexOf('//# sourceMappingURL=babylon.max.js.map')), runtime)
const B = runtime.BABYLON
runtime.PointerEvent = class {
  button = 0
  constructor(type: string, init: any) {
    Object.assign(this, init)
  }
}

let Controls: any
let engine: any
let scene: any
let controls: any
let selection: any
let teleport: any
let sources: any[]

beforeAll(async () => {
  vi.stubGlobal('BABYLON', B)
  Controls = (await import('../src/controls/controls')).default
})

beforeEach(() => {
  vi.stubGlobal('BABYLON', B)
  vi.stubGlobal('ui', { visible: true })
  engine = new B.NullEngine()
  scene = new B.Scene(engine)
  const manager = new B.WebXRSessionManager(scene)
  // Detachment during a teleport frame executes this cleanup immediately.
  manager.runInXRFrame = (callback: any) => callback()
  scene.activeCamera = new B.WebXRCamera('camera', scene, manager)
  sources = ['left', 'right'].map((hand) => {
    const trigger = { onButtonStateChangedObservable: new B.Observable() }
    return {
      uniqueId: hand,
      inputSource: { handedness: hand, targetRayMode: 'tracked-pointer', gamepad: {} },
      pointer: B.MeshBuilder.CreateBox(hand, {}, scene),
      onMotionControllerInitObservable: new B.Observable(),
      motionController: { getMainComponent: () => trigger },
      trigger,
    }
  })
  const input = { controllers: sources, onControllerAddedObservable: new B.Observable(), onControllerRemovedObservable: new B.Observable() }
  selection = new B.WebXRControllerPointerSelection(manager, { xrInput: input, enablePointerSelectionOnAllControllers: true })
  selection.attach()
  teleport = new B.WebXRMotionControllerTeleportation(manager, { xrInput: input, teleportationTargetMesh: B.MeshBuilder.CreateBox('target', {}, scene) })
  teleport.setSelectionFeature(selection)
  controls = Object.create(Controls.prototype)
  controls.scene = scene
  controls.MAX_PICK_DISTANCE = 20
  controls.xrPicks = new Map()
  controls.xrSelection = selection
  scene.onPointerObservable.add(controls.featureClickHandler.bind(controls))
})

afterEach(() => {
  teleport.dispose()
  selection.dispose()
  scene.dispose()
  engine.dispose()
  vi.unstubAllGlobals()
})

function aimAt(hand: string) {
  const pick = new B.PickingInfo()
  pick.hit = true
  pick.distance = 2
  pick.pickedPoint = new B.Vector3(0, 0, 2)
  pick.ray = new B.Ray(B.Vector3.Zero(), B.Vector3.Forward())
  pick.pickedMesh = B.MeshBuilder.CreateBox(`${hand}-button`, {}, scene)
  pick.pickedMesh.cvOnLeftClick = vi.fn()
  selection._controllers[hand].pick = pick
  return pick.pickedMesh.cvOnLeftClick
}

function pressTrigger(hand: string, pressed: boolean) {
  sources.find((source) => source.uniqueId === hand).trigger.onButtonStateChangedObservable.notifyObservers({ changes: { pressed: { current: pressed } } })
}

test.each(['left', 'right'])('teleport cleanup does not repeat a completed %s click', (hand) => {
  const click = aimAt(hand)
  pressTrigger(hand, true)
  pressTrigger(hand, false)
  expect(click).toHaveBeenCalledTimes(1)
  teleport._setTargetMeshVisibility(true, true)
  expect(click).toHaveBeenCalledTimes(1)
})

test.each(['left', 'right'])('teleport cancels an unfinished %s press', (hand) => {
  const click = aimAt(hand)
  pressTrigger(hand, true)
  teleport._setTargetMeshVisibility(true, true)
  expect(click).not.toHaveBeenCalled()
  scene.onBeforeRenderObservable.notifyObservers(scene)
  teleport._setTargetMeshVisibility(false, true)
  const next = aimAt(hand)
  pressTrigger(hand, false)
  expect(controls.xrPicks.size).toBe(0)
  expect(click).not.toHaveBeenCalled()
  expect(next).not.toHaveBeenCalled()
  pressTrigger(hand, true)
  pressTrigger(hand, false)
  expect(next).toHaveBeenCalledTimes(1)
})

test.each(['left', 'right'])('a %s release off the mesh clears the pending press', (hand) => {
  const click = aimAt(hand)
  pressTrigger(hand, true)
  selection._controllers[hand].pick = new B.PickingInfo()
  pressTrigger(hand, false)
  expect(controls.xrPicks.size).toBe(0)
  expect(click).not.toHaveBeenCalled()
})

test('each hand consumes its own press when both triggers are held', () => {
  const left = aimAt('left')
  const right = aimAt('right')
  pressTrigger('left', true)
  pressTrigger('right', true)
  pressTrigger('left', false)
  pressTrigger('right', false)
  expect(left).toHaveBeenCalledTimes(1)
  expect(right).toHaveBeenCalledTimes(1)
  expect(controls.xrPicks.size).toBe(0)
})

test('desktop mouse picks retain the existing routing', () => {
  const click = vi.spyOn(controls, 'lockedLeftClick')
  controls.featureClickHandler({ type: B.PointerEventTypes.POINTERPICK, event: { button: 0, pointerType: 'mouse' }, pickInfo: {} })
  expect(click).not.toHaveBeenCalled()
})
