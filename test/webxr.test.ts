// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import RAPIER from '@dimforge/rapier3d-compat'
import XROverlay from '../src/controls/webxr'
import PlayerBody, { EYE } from '../src/controls/utils/player-body'
import { cameraRotation, setCameraPosition, setCameraRotation, xrHeight } from '../src/utils/camera'

const world = vi.hoisted(() => ({ loaded: false, terrain: { groundMeshes: [] as any[] }, events: new EventTarget() }))
const physics = vi.hoisted(() => ({ world: null as any }))
vi.mock('../src/physics/world', () => ({ physics: () => physics.world, PLAYER_QUERY: (0x0008 << 16) | 0x0001 }))
vi.mock('../common/helpers/detector', () => ({ wantsGateway: () => false, isDesktop: () => true, isMobile: () => false, wantsXR: () => true }))
vi.mock('../src/user', () => ({ User: class {} }))
vi.mock('../src/avatar', () => ({ default: class {} }))
vi.mock('../src/features/feature', () => ({ default: class {} }))
vi.mock('../src/connector', () => ({ default: class {} }))
vi.mock('../src/controls/utils/player-camera', () => ({ default: class {} }))
vi.mock('../src/controls/utils/locale-keyboard-move-input', () => ({ LocaleKeyboardMoveInput: class {} }))
vi.mock('../src/controls/utils/fps-camera', () => ({}))
vi.mock('../common/helpers/utils', () => ({}))
vi.mock('../common/helpers/ui-helpers', () => ({ hasPointerLock: () => false }))
vi.mock('../src/utils/loading-done', () => ({}))
vi.mock('../src/utils/helpers', () => ({}))
vi.mock('../src/store', () => ({}))
vi.mock('../web/src/state', () => ({}))
vi.mock('../src/tools/gizmos', () => ({}))
vi.mock('../src/init/world-scene', () => ({
  worldSceneLoaded: () => world.loaded,
  getWorldTerrain: () => world.terrain,
  worldSceneEvents: world.events,
}))

// Test the browser runtime, not the newer Babylon package used by TypeScript.
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

let engine: any, scene: any, camera: any, input: any, helper: any, controls: any, target: any, xr: any
let DesktopControls: any
let height = 1.7

beforeAll(async () => {
  await RAPIER.init()
  vi.stubGlobal('BABYLON', B)
  DesktopControls = (await import('../src/controls/desktop/controls')).default
})

beforeEach(() => {
  vi.stubGlobal('BABYLON', B)
  const page = new EventTarget()
  vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
  vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page))
  vi.stubGlobal('dispatchEvent', page.dispatchEvent.bind(page))
  world.loaded = false
  world.terrain.groundMeshes = []
  height = 1.7
  physics.world = new RAPIER.World({ x: 0, y: -9.8, z: 0 })
  engine = new B.NullEngine()
  scene = new B.Scene(engine)
  const manager = new B.WebXRSessionManager(scene)
  manager.updateRenderState = vi.fn()
  manager.currentFrame = {
    getViewerPose: vi.fn(() => {
      if (!manager.inXRFrameLoop) throw new DOMException('XR frame ended', 'InvalidStateError')
      return { transform: { position: { x: 0, y: height, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }, views: [] }
    }),
  }
  camera = new B.WebXRCamera('xr', scene, manager)
  target = B.MeshBuilder.CreateBox('target', {}, scene)
  input = { xrCamera: camera, controllers: [], onControllerAddedObservable: new B.Observable(), onControllerRemovedObservable: new B.Observable() }
  helper = {
    camera,
    sessionManager: manager,
    state: B.WebXRState.NOT_IN_XR,
    onStateChangedObservable: new B.Observable(),
    onInitialXRPoseSetObservable: new B.Observable(),
    exitXRAsync: vi.fn(async () => {
      helper.state = B.WebXRState.NOT_IN_XR
      helper.onStateChangedObservable.notifyObservers(helper.state)
    }),
    enterXRAsync: vi.fn(async () => {
      const p = controls.body.position
      const flat = new B.FreeCamera('flat', new B.Vector3(p.x, p.y, p.z), scene)
      camera.setTransformationFromNonVRCamera(flat, false)
      helper.onInitialXRPoseSetObservable.notifyObservers(camera)
      camera._firstFrame = true
      xrFrame(() => {
        camera._updateFromXRSession()
        helper.state = B.WebXRState.IN_XR
        helper.onStateChangedObservable.notifyObservers(helper.state)
      })
      flat.dispose()
    }),
    featuresManager: {
      enableFeature: vi.fn((name, version, options) => {
        const teleport = new B.WebXRMotionControllerTeleportation(manager, { ...options, teleportationTargetMesh: target })
        teleport.attach()
        return teleport
      }),
      disableFeature: vi.fn(),
    },
  }
  scene.createDefaultXRExperienceAsync = vi.fn(async () => ({ baseExperience: helper, input, renderTarget: {}, pointerSelection: { attach: vi.fn(), detach: vi.fn() } }))
  controls = {
    vehicleFeature: null,
    vehicleSteer: { forward: 0, turn: 0, climb: 0 },
    persona: { uuid: 'visitor' },
    body: new PlayerBody(),
    move: B.Vector3.Zero(),
    movementEnabled: true,
    camera: { rotation: B.Vector3.Zero(), place: vi.fn() },
    grid: { parcels: new Map() },
    resetFloor: vi.fn(),
    tryEnterVehicle: vi.fn(),
    enterVehicle: vi.fn(),
    stopVehicle: vi.fn(() => (controls.vehicleFeature = null)),
  }
  xr = new XROverlay(scene, {} as any, controls)
})

afterEach(() => {
  world.events.removeEventListener('ground-loaded', xr.onGroundLoaded)
  xr.xrTeleportation?.dispose()
  scene.dispose()
  engine.dispose()
  physics.world.free()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function controller(hand = 'left') {
  const stick = { type: 'thumbstick', onAxisValueChangedObservable: new B.Observable() }
  const button = { onButtonStateChangedObservable: new B.Observable() }
  const pace = { onButtonStateChangedObservable: new B.Observable() }
  const trigger = { onButtonStateChangedObservable: new B.Observable() }
  return {
    uniqueId: hand,
    inputSource: { handedness: hand, targetRayMode: 'tracked-pointer', gamepad: {} },
    pointer: B.MeshBuilder.CreateBox(hand, {}, scene),
    onMotionControllerInitObservable: new B.Observable(),
    getWorldPointerRayToRef: (ray: any) => {
      ray.origin.set(0, 0, 0)
      ray.direction.set(0, 0, 1)
    },
    motionController: {
      handedness: hand,
      getComponentOfType: () => stick,
      getMainComponent: () => trigger,
      getComponent: (name: string) => (name === 'xr-standard-thumbstick' ? stick : name === 'y-button' ? pace : button),
    },
    stick,
    button,
    pace,
    trigger,
  }
}

test('startup uses the shipped camera event and subscribes before XR entry', async () => {
  expect(B.Engine.Version).toBe('6.11.2')
  await xr.start()
  expect(xr.xrTeleportation.onAfterCameraTeleport).toBeUndefined()
  expect(camera.onAfterCameraTeleport.observers).toHaveLength(1)
  expect(scene.onBeforeRenderObservable.observers).toHaveLength(1)
  expect(input.onControllerAddedObservable.observers.length).toBeGreaterThan(0)
  expect(xr.floorSnapPending).toBe(true)
})

test('denied entry can retry and re-entry does not duplicate the movement loop', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  controls.body.position = { x: 10, y: 3, z: 20 }
  helper.enterXRAsync.mockImplementationOnce(async () => {
    helper.onStateChangedObservable.notifyObservers(B.WebXRState.ENTERING_XR)
    helper.onStateChangedObservable.notifyObservers(B.WebXRState.NOT_IN_XR)
    throw new Error('denied')
  })
  await xr.start()
  expect(controls.body.position).toEqual({ x: 10, y: 3, z: 20 })
  await Promise.all([xr.start(), xr.start()])
  expect(helper.enterXRAsync).toHaveBeenCalledTimes(2)
  helper.state = B.WebXRState.NOT_IN_XR
  helper.onStateChangedObservable.notifyObservers(helper.state)
  await xr.start()
  expect(helper.enterXRAsync).toHaveBeenCalledTimes(3)
  expect(scene.createDefaultXRExperienceAsync).toHaveBeenCalledTimes(1)
  expect(scene.onBeforeRenderObservable.observers).toHaveLength(1)
})

test('island ground registers after boot and disposed floors are removed', async () => {
  xr.attachWorldScene()
  await xr.start()
  const ground = B.MeshBuilder.CreateGround('island', { width: 10, height: 10 }, scene)
  world.terrain.groundMeshes = [ground]
  world.loaded = true
  world.events.dispatchEvent(new Event('ground-loaded'))
  world.events.dispatchEvent(new Event('ground-loaded'))
  expect(xr.teleportableMeshes.size).toBe(1)
  expect(xr.xrTeleportation._options.floorMeshes).toEqual([ground])
  ground.dispose()
  expect(xr.teleportableMeshes.size).toBe(0)
  expect(xr.xrTeleportation._options.floorMeshes).toEqual([])
})

test('floor snap recovers from y=0 below the street', async () => {
  await xr.start()
  const ground = B.MeshBuilder.CreateGround('island', { width: 10, height: 10 }, scene)
  ground.position.y = 0.74
  ground.computeWorldMatrix(true)
  xr.addTeleportMesh(ground)
  camera.position.setAll(0)
  expect(xr.resetXRFloorHeight(camera.position)).toBe(true)
  expect(camera.position.y).toBeCloseTo(0.74 + height)
})

test.each([1.1, 1.7, 2])('teleport onto the aimed ride enters at %sm eye height', async (eye) => {
  await xr.start()
  height = eye
  const mesh = B.MeshBuilder.CreateBox('ride', {}, scene)
  const ride = { mesh, disposed: false }
  xr.rideMeshes.set(mesh, ride)
  xr.xrTeleportation.onTargetMeshPositionUpdatedObservable.notifyObservers({ pickedMesh: mesh })
  target.position.set(0, 1, 0)
  target.isVisible = true
  xr.xrTeleportation._controllers.right = { teleportationState: { forward: true, currentRotation: 0 } }
  xrFrame(() => xr.xrTeleportation._teleportForward('right'))
  expect(controls.enterVehicle).toHaveBeenCalledExactlyOnceWith(ride)
  expect(xr.floorSnapPending).toBe(false)
})

test('teleport beside a previously aimed ride does not enter it', async () => {
  await xr.start()
  const mesh = B.MeshBuilder.CreateBox('ride', {}, scene)
  xr.rideMeshes.set(mesh, { mesh, disposed: false })
  xr.xrTeleportation.onTargetMeshPositionUpdatedObservable.notifyObservers({ pickedMesh: mesh })
  xr.xrTeleportation.onTargetMeshPositionUpdatedObservable.notifyObservers({ pickedMesh: target })
  camera.onAfterCameraTeleport.notifyObservers(camera.position)
  expect(controls.enterVehicle).not.toHaveBeenCalled()
})

test('existing controllers bind and X toggles only on a new press', async () => {
  const left = controller()
  input.controllers.push(left)
  await xr.start()
  left.stick.onAxisValueChangedObservable.notifyObservers({ x: 0, y: -1 })
  left.button.onButtonStateChangedObservable.notifyObservers({ pressed: true, changes: { pressed: { current: true } } })
  left.button.onButtonStateChangedObservable.notifyObservers({ pressed: true, changes: { touched: { current: true } } })
  expect(controls.tryEnterVehicle).toHaveBeenCalledTimes(1)
  input.onControllerRemovedObservable.notifyObservers(left)
  expect(xr.stick).toEqual({ x: 0, y: 0 })
  expect(controls.vehicleSteer).toEqual({ forward: 0, turn: 0, climb: 0 })
})

test('diagonal stick movement and long frames cannot multiply walking speed', async () => {
  await xr.start()
  xr.floorSnapPending = false
  xr.updateHint = vi.fn()
  vi.spyOn(engine, 'getDeltaTime').mockReturnValue(1000)
  camera.position.setAll(0)
  xr.stick = { x: 1, y: -1 }
  xrFrame(() => scene.onBeforeRenderObservable.notifyObservers(scene))
  expect(Math.hypot(camera.position.x, camera.position.z)).toBeCloseTo(1.5 * 0.05)
})

test('XR exit releases the ride and preserves the headset position for flat controls', async () => {
  const right = controller('right')
  input.controllers.push(right)
  await xr.start()
  xr.updateHint = vi.fn()
  xr.floorSnapPending = false
  controls.vehicleFeature = {}
  xrFrame(() => scene.onBeforeRenderObservable.notifyObservers(scene))
  expect(xr.xrTeleportation.teleportationEnabled).toBe(false)
  expect(xr.xrTeleportation.attached).toBe(true)
  const yaw = camera.rotationQuaternion.toEulerAngles().y
  right.stick.onAxisValueChangedObservable.notifyObservers({ x: 1, y: 0 })
  expect(camera.rotationQuaternion.toEulerAngles().y - yaw).toBeCloseTo(Math.PI / 8)
  xr.stick = { x: 1, y: 1 }
  xr.flyUp = true
  camera.position.set(10, 3, 20)
  helper.state = B.WebXRState.NOT_IN_XR
  helper.onStateChangedObservable.notifyObservers(helper.state)
  expect(controls.stopVehicle).toHaveBeenCalledTimes(1)
  expect(controls.body.position).toEqual({ x: 10, y: 3 + EYE - height, z: 20 })
  expect(controls.camera.place).toHaveBeenCalledTimes(1)
  expect(xr.stick).toEqual({ x: 0, y: 0 })
  expect(xr.flyUp).toBe(false)
  expect(xr.xrTeleportation.teleportationEnabled).toBe(true)
})

function box(half: number[], center: number[]) {
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setTranslation(center[0], center[1], center[2]))
}

function xrFrame(action: () => void) {
  helper.sessionManager.inXRFrameLoop = true
  try {
    action()
  } finally {
    helper.sessionManager.inXRFrameLoop = false
  }
}

function frames(count: number) {
  for (let i = 0; i < count; i++) {
    controls.body.gravity = !controls.flying
    physics.world.step()
    xrFrame(() => scene.onBeforeRenderObservable.notifyObservers(scene))
  }
}

async function walking() {
  await xr.start()
  xr.floorSnapPending = false
  xr.updateHint = vi.fn()
  vi.spyOn(engine, 'getDeltaTime').mockReturnValue(1000 / 60)
  camera.position.set(0, height, 0)
  box([10, 0.5, 10], [0, -0.5, 0])
}

test.each([1.1, 1.7, 2])('stick walking stops at walls and preserves %sm tracked height', async (eye) => {
  height = eye
  await walking()
  box([0.1, 2, 5], [2, 2, 0])
  xr.stick.x = 1
  frames(180)
  expect(camera.position.x).toBeGreaterThan(1.5)
  expect(camera.position.x).toBeLessThan(1.7)
  expect(camera.position.y).toBeCloseTo(height, 1)
})

test('walking climbs a voxel step and stops without stick drift', async () => {
  await walking()
  box([2, 0.125, 5], [3, 0.125, 0])
  xr.stick.x = 1
  frames(120)
  expect(camera.position.x).toBeGreaterThan(2.5)
  expect(camera.position.y).toBeCloseTo(height + 0.25, 1)
  xr.stick.x = 0
  const x = camera.position.x
  frames(30)
  expect(camera.position.x).toBeCloseTo(x, 5)
})

test('Y changes pace once per press and saves it for the next session', async () => {
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn() }
  vi.stubGlobal('localStorage', storage)
  const left = controller()
  input.controllers.push(left)
  await walking()
  expect(xr.slowWalk).toBe(true)
  left.pace.onButtonStateChangedObservable.notifyObservers({ pressed: true, changes: { pressed: { current: true } } })
  left.pace.onButtonStateChangedObservable.notifyObservers({ pressed: true, changes: { touched: { current: true } } })
  expect(xr.slowWalk).toBe(false)
  expect(storage.setItem).toHaveBeenCalledExactlyOnceWith('xrWalkSpeed', 'fast')
  storage.getItem.mockReturnValue('fast' as any)
  expect((new XROverlay(scene, {} as any, controls) as any).slowWalk).toBe(false)
  xr.stick.x = 1
  frames(60)
  expect(camera.position.x).toBeCloseTo(3.5, 1)
})

test('teleporting ends flight and movement locks are respected', async () => {
  await walking()
  xr.flyUp = true
  frames(30)
  expect(controls.flying).toBe(true)
  expect(camera.position.y).toBeGreaterThan(height + 0.5)
  xr.flyUp = false
  camera.position.set(0, height, 0)
  camera.onAfterCameraTeleport.notifyObservers(camera.position)
  expect(controls.flying).toBe(false)
  frames(30)
  expect(camera.position.y).toBeCloseTo(height, 1)
  controls.movementEnabled = false
  xr.stick.x = 1
  const x = camera.position.x
  frames(60)
  expect(camera.position.x).toBe(x)
})

test('teleport clears fall velocity while the destination floor loads', async () => {
  await walking()
  scene.activeCamera = camera
  camera.position.y = 20
  frames(60)
  expect(camera.position.y).toBeLessThan(18)
  setCameraPosition(scene, new B.Vector3(100, EYE, 100))
  controls.body.gravity = false
  xrFrame(() => scene.onBeforeRenderObservable.notifyObservers(scene))
  expect(camera.position.y).toBeCloseTo(height, 5)
})

test('Quest entry uses the configured render target and avoids unused XR work', async () => {
  const foveation = vi.spyOn(helper.sessionManager, 'fixedFoveation', 'set')
  await xr.start()
  expect(helper.enterXRAsync).toHaveBeenCalledWith('immersive-vr', 'local-floor', xr.webXR.renderTarget)
  expect(scene.createDefaultXRExperienceAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      disableNearInteraction: true,
      disableTeleportation: true,
      outputCanvasOptions: { canvasOptions: { framebufferScaleFactor: 0.5 } },
      pointerSelectionOptions: { enablePointerSelectionOnAllControllers: true, maxPointerDistance: 20, disableScenePointerVectorUpdate: true },
    }),
  )
  expect(foveation).toHaveBeenCalledWith(0.5)
  expect(xr.xrTeleportation._selectionFeature).toBe(xr.webXR.pointerSelection)
})

test.each(['left', 'right'])('%s trigger uses feature clicks without requesting mouse lock', async (hand) => {
  const source = controller(hand)
  source.pointer.isPickable = false
  input.controllers.push(source)
  await xr.start()
  target.isPickable = false
  scene.activeCamera = camera
  const clicks = Object.create(DesktopControls.prototype)
  clicks.scene = scene
  clicks.MAX_PICK_DISTANCE = 20
  clicks.requestPointerLock = vi.fn()
  vi.stubGlobal('ui', { visible: true })
  scene.pointerMovePredicate = clicks.defaultPointerMovePredicate.bind(clicks)
  scene.onPointerObservable.add(clicks.desktopClicks.bind(clicks))
  scene.onPointerObservable.add(clicks.featureClickHandler.bind(clicks))
  const sign = B.MeshBuilder.CreateBox('sign', {}, scene)
  sign.position.z = 3
  sign.computeWorldMatrix(true)
  sign.cvOnLeftClick = vi.fn()
  expect(clicks.defaultPointerMovePredicate(sign)).toBe(true)
  const selection = new B.WebXRControllerPointerSelection(helper.sessionManager, { xrInput: input, ...scene.createDefaultXRExperienceAsync.mock.calls[0][0].pointerSelectionOptions })
  clicks.xrSelection = selection
  clicks.xrPicks = new Map()
  selection.attach()
  selection._onXRFrame({})
  expect(selection.getMeshUnderPointer(source.uniqueId)?.name).toBe('sign')
  source.trigger.onButtonStateChangedObservable.notifyObservers({ changes: { pressed: { current: true } } })
  source.trigger.onButtonStateChangedObservable.notifyObservers({ changes: { pressed: { current: false } } })
  expect(sign.cvOnLeftClick).toHaveBeenCalledTimes(1)
  expect(clicks.requestPointerLock).not.toHaveBeenCalled()
  const wall = B.MeshBuilder.CreateBox('wall', {}, scene)
  wall.position.z = 1.5
  wall.computeWorldMatrix(true)
  selection._onXRFrame({})
  expect(selection.getMeshUnderPointer(source.uniqueId)?.name).toBe('wall')
  source.trigger.onButtonStateChangedObservable.notifyObservers({ changes: { pressed: { current: true } } })
  source.trigger.onButtonStateChangedObservable.notifyObservers({ changes: { pressed: { current: false } } })
  expect(sign.cvOnLeftClick).toHaveBeenCalledTimes(1)
  wall.dispose()
  sign.position.z = 25
  sign.computeWorldMatrix(true)
  selection._onXRFrame({})
  expect(selection.getMeshUnderPointer(source.uniqueId)).toBeNull()
  selection.dispose()
})

test('mouse clicks still request pointer lock and respect visible desktop UI', () => {
  scene.activeCamera = new B.FreeCamera('flat', B.Vector3.Zero(), scene)
  const clicks = Object.create(DesktopControls.prototype)
  clicks.scene = scene
  clicks.MAX_PICK_DISTANCE = 20
  clicks.requestPointerLock = vi.fn()
  vi.stubGlobal('ui', { visible: true })
  const mesh = { cvOnLeftClick: vi.fn() }
  clicks.lockedLeftClick({ pickedMesh: mesh, distance: 2 })
  expect(mesh.cvOnLeftClick).not.toHaveBeenCalled()
  clicks.desktopClicks({ type: B.PointerEventTypes.POINTERDOWN, event: { button: 0, pointerType: 'mouse' } }, {})
  expect(clicks.requestPointerLock).toHaveBeenCalledTimes(1)
})

test.each([1.1, 1.7, 2])('world links synchronize the body and facing at %sm eye height', async (eye) => {
  height = eye
  await walking()
  scene.activeCamera = camera
  controls.vehicleFeature = {}
  const destination = new B.Vector3(10, EYE, 20)
  setCameraPosition(scene, destination)
  setCameraRotation(scene, new B.Vector3(0, Math.PI / 2, 0))
  expect(camera.position.y).toBeCloseTo(height)
  expect(cameraRotation(scene).y).toBeCloseTo(Math.PI / 2)
  expect(controls.body.position.x).toBe(10)
  expect(controls.body.position.y).toBeCloseTo(EYE)
  expect(controls.body.position.z).toBe(20)
  expect(controls.stopVehicle).toHaveBeenCalledTimes(1)
  expect(controls.resetFloor).toHaveBeenCalledTimes(2)
  expect(helper.state).toBe(B.WebXRState.IN_XR)
  camera.position.x += 1
  expect(destination.x).toBe(10)
})

test('exit and asynchronous world links use cached height after the XR frame ends', async () => {
  height = 1.1
  await walking()
  scene.activeCamera = camera
  const pose = helper.sessionManager.currentFrame.getViewerPose
  pose.mockClear()
  expect(() => camera.realWorldHeight).toThrow('XR frame ended')
  pose.mockClear()
  setCameraPosition(scene, new B.Vector3(10, 5 + EYE, 20))
  expect(camera.position.y).toBeCloseTo(6.1)
  await helper.exitXRAsync()
  expect(pose).not.toHaveBeenCalled()
  expect(controls.body.position.y).toBeCloseTo(5 + EYE)
  expect(controls.camera.place).toHaveBeenCalledTimes(1)
  await xr.start()
  expect(camera.position.y).toBeCloseTo(6.1)
  expect(helper.state).toBe(B.WebXRState.IN_XR)
})

test('tracking loss retains the last valid height', async () => {
  height = 1.1
  await xr.start()
  helper.sessionManager.currentFrame.getViewerPose.mockReturnValueOnce(null)
  xrFrame(() => expect(xrHeight(camera)).toBeCloseTo(1.1))
  helper.sessionManager.currentFrame.getViewerPose.mockImplementationOnce(() => {
    throw new DOMException('Tracking lost', 'InvalidStateError')
  })
  xrFrame(() => expect(xrHeight(camera)).toBeCloseTo(1.1))
})

test.each([1.1, 1.7, 2])('entry keeps a 10m upper floor at %sm tracked height', async (eye) => {
  height = eye
  controls.body.position.y = 10 + EYE
  for (const y of [0, 10]) {
    const floor = B.MeshBuilder.CreateGround(`floor-${y}`, { width: 10, height: 10 }, scene)
    floor.position.y = y
    floor.computeWorldMatrix(true)
    xr.addTeleportMesh(floor)
  }
  await xr.start()
  expect(camera.position.y).toBeCloseTo(10 + height)
  xr.updateHint = vi.fn()
  xrFrame(() => scene.onBeforeRenderObservable.notifyObservers(scene))
  expect(camera.position.y).toBeCloseTo(10 + height, 1)
  expect(xr.floorSnapPending).toBe(false)
})

test('driving preserves physical leaning and standing while the seat moves', async () => {
  await walking()
  controls.vehicleFeature = {}
  controls.body.position = { x: 10, y: 5, z: 20 }
  xrFrame(() => scene.onBeforeRenderObservable.notifyObservers(scene))
  expect(camera.position.asArray()).toEqual([10, 6.1, 20])
  camera.position.addInPlace(new B.Vector3(0.3, 0.4, -0.2))
  height += 0.4
  controls.body.position.x += 2
  controls.body.position.y += 1
  controls.body.position.z -= 3
  xrFrame(() => scene.onBeforeRenderObservable.notifyObservers(scene))
  expect(camera.position.x).toBeCloseTo(12.3)
  expect(camera.position.y).toBeCloseTo(7.5)
  expect(camera.position.z).toBeCloseTo(16.8)
  const position = camera.position.clone()
  xrFrame(() => scene.onBeforeRenderObservable.notifyObservers(scene))
  expect(camera.position.asArray()).toEqual(position.asArray())
  await helper.exitXRAsync()
  expect(controls.body.position.y).toBeCloseTo(position.y + EYE - height)
})

test('opening a dialog exits XR once and disposal removes the listener', async () => {
  await xr.start()
  globalThis.dispatchEvent(new Event('dialogopen'))
  expect(helper.exitXRAsync).toHaveBeenCalledTimes(1)
  expect(helper.state).toBe(B.WebXRState.NOT_IN_XR)
  globalThis.dispatchEvent(new Event('dialogopen'))
  expect(helper.exitXRAsync).toHaveBeenCalledTimes(1)
  await xr.start()
  scene.dispose()
  globalThis.dispatchEvent(new Event('dialogopen'))
  expect(helper.exitXRAsync).toHaveBeenCalledTimes(1)
})

test('a rejected dialog exit does not throw from the click event', async () => {
  await xr.start()
  helper.exitXRAsync.mockRejectedValueOnce(new Error('session already ending'))
  expect(() => globalThis.dispatchEvent(new Event('dialogopen'))).not.toThrow()
  await Promise.resolve()
  expect(helper.exitXRAsync).toHaveBeenCalledTimes(1)
})
