import { isIOS, isMobile, isSafari, isTablet, wantsGateway } from '../common/helpers/detector'
import type Controls from './controls/controls'
import { isLoaded, markLoaded } from './utils/loading-done'
import { Camera, Color3, Color4, FreeCamera, Mesh, SceneContext, Vec3 } from '@babylonjs/lite'
import { quat, vec3 } from 'wgpu-matrix'

const HOLE = 'gateway-hole'
const FRAME = 'gateway-frame'
const ENTER_AFTER_MS = 1500
const ENTER_DEPTH = 0.45
const WALL_DISTANCE = 3.2
const LAYER_PARCEL = 1
const LAYER_ROOM = 2

let started = false
let videoStarted = false
let holeMesh: Mesh | null = null
let forward = vec3.fromValues(0, 0, 1)
let bootAt = 0

function isGatewayMesh(mesh: Mesh) {
  return mesh.name === HOLE || mesh.name === FRAME
}

function enterPlay() {
  const u = new URL(window.location.href)
  u.searchParams.delete('gateway')
  const q = u.searchParams.toString().replace('%40', '@').replace(/%2C/g, ',')
  window.location.replace(q ? `${u.pathname}?${q}` : u.pathname)
}

function wantsPhoneCamera() {
  return isMobile() || isIOS() || isTablet()
}

function showHint(text: string) {
  let el = document.getElementById('gatewayHint')
  if (!el) {
    el = document.createElement('div')
    el.id = 'gatewayHint'
    el.style.cssText = 'position:fixed;left:1rem;right:1rem;bottom:2rem;text-align:center;z-index:9999;pointer-events:none;color:var(--bg);font-size:1rem;'
    document.body.appendChild(el)
  }
  el.textContent = text
}

function hideHint() {
  document.getElementById('gatewayHint')?.remove()
}

export function startPhoneVideo() {
  if (videoStarted || !wantsPhoneCamera() || !navigator.mediaDevices?.getUserMedia) return
  videoStarted = true

  const v = document.createElement('video')
  v.setAttribute('playsinline', '')
  v.setAttribute('webkit-playsinline', '')
  v.muted = true
  v.autoplay = true
  v.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;'
  document.body.appendChild(v)

  let asking = false
  const ask = () => {
    if (asking || v.srcObject) return
    asking = true
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        v.srcObject = stream
        v.play().catch(() => {})
      })
      .catch(() => {
        asking = false
      })
  }

  ask()
  window.addEventListener('pointerdown', ask, { capture: true })
}

function enableRoomLook(camera: any) {
  const cam = camera as any
  const DOE = window.DeviceOrientationEvent as any
  if (DOE && typeof DOE.requestPermission === 'function') {
    const once = () => {
      DOE.requestPermission()
        .then((s: string) => {
          if (s === 'granted' && typeof cam.enableDeviceOrientation === 'function') cam.enableDeviceOrientation()
        })
        .catch(() => {})
    }
    window.addEventListener('pointerdown', once, { capture: true, once: true })
  } else if (typeof cam.enableDeviceOrientation === 'function') {
    cam.enableDeviceOrientation()
  }
}

function muteCamera(cam: Camera) {
  try {
    cam.detachControl()
  } catch {}
  try {
    cam.inputs.clear()
  } catch {}
}

function hidePlayChrome() {
  const hide = () => {
    document.querySelectorAll('.mobile-controls-container').forEach((el) => {
      ;(el as HTMLElement).style.display = 'none'
    })
    ;(window.connector?.controls as { dpad?: { setVisible(v: boolean): void } } | undefined)?.dpad?.setVisible(false)
  }
  hide()
  setTimeout(hide, 400)
  setTimeout(hide, 1500)
}

function lookDir(cam: Camera) {
  const d = cam.getForwardRay().direction.clone()
  d.y = 0
  if (d.lengthSquared() < 0.01) d.set(0, 0, 1)
  d.normalize()
  return d
}

function setupStencilPortal(scene: SceneContext) {
  scene.setRenderingAutoClearDepthStencil(0, true, true, true)
  scene.setRenderingAutoClearDepthStencil(1, false, true, false)
  scene.setRenderingAutoClearDepthStencil(2, false, false, false)

  const engine = scene.getEngine() as any
  scene.onBeforeRenderingGroupObservable.add((info) => {
    if (info.renderingGroupId === 0) {
      engine.setStencilBuffer(true)
      engine.setStencilMask(0xff)
      engine.setStencilFunction((undefined as any /* todo(lite): BABYLON.Engine.ALWAYS */))
      engine.setStencilFunctionReference(1)
      engine.setStencilOperation((undefined as any /* todo(lite): BABYLON.Engine.KEEP */), (undefined as any /* todo(lite): BABYLON.Engine.KEEP */), (undefined as any /* todo(lite): BABYLON.Engine.REPLACE */))
    } else if (info.renderingGroupId === 1) {
      engine.setStencilBuffer(true)
      engine.setStencilMask(0x00)
      engine.setStencilFunction((undefined as any /* todo(lite): BABYLON.Engine.EQUAL */))
      engine.setStencilFunctionReference(1)
      engine.setStencilOperation((undefined as any /* todo(lite): BABYLON.Engine.KEEP */), (undefined as any /* todo(lite): BABYLON.Engine.KEEP */), (undefined as any /* todo(lite): BABYLON.Engine.KEEP */))
    } else {
      engine.setStencilBuffer(false)
    }
  })
}

function placeHole(scene: SceneContext, holePos: Vec3, yaw: number) {
  const hole = (undefined as any /* todo(lite): BABYLON.MeshBuilder.CreatePlane(HOLE, { width: 1.2, height: 2.2 }, scene) */)
  hole.position.copyFrom(holePos)
  hole.rotation.y = yaw
  hole.renderingGroupId = 0
  hole.layerMask = 0x0fffffff
  hole.isPickable = false
  const holeMat = (undefined as any /* todo(lite): new BABYLON.StandardMaterial(HOLE, scene) */)
  holeMat.disableColorWrite = true
  holeMat.disableDepthWrite = true
  holeMat.backFaceCulling = false
  holeMat.fogEnabled = false
  hole.material = holeMat
  holeMesh = hole

  const frame = (undefined as any /* todo(lite): BABYLON.MeshBuilder.CreateBox(FRAME, { width: 1.32, height: 2.32, depth: 0.06 }, scene) */)
  frame.position.copyFrom(holePos)
  frame.rotation.y = yaw
  frame.renderingGroupId = 2
  frame.layerMask = 0x0fffffff
  frame.isPickable = false
  const frameMat = (undefined as any /* todo(lite): new BABYLON.StandardMaterial(FRAME, scene) */)
  frameMat.emissiveColor = ([0.45, 0.45, 0.4] as Color3)
  frameMat.disableLighting = true
  frameMat.wireframe = true
  frameMat.fogEnabled = false
  frame.material = frameMat
  return { hole, frame }
}

function revealParcelThroughHole(scene: SceneContext, cam: Camera) {
  scene.meshes.forEach((m) => {
    if (isGatewayMesh(m)) return
    m.layerMask = 0x0fffffff
    m.renderingGroupId = 1
  })
  scene.onNewMeshAddedObservable.add((m) => {
    if (isGatewayMesh(m)) return
    m.layerMask = 0x0fffffff
    m.renderingGroupId = 1
  })
  cam.layerMask = 0x0fffffff
  setupStencilPortal(scene)
}

function openDoorInFront(scene: SceneContext, roomCam: Camera, meshObs: (any | null)) {
  if (holeMesh) return
  forward = lookDir(roomCam)
  ;(roomCam as any).setParent(null)
  if (meshObs) scene.onNewMeshAddedObservable.remove(meshObs)
  roomCam.position.subtractInPlace(forward.scale(WALL_DISTANCE))

  const holePos = roomCam.position.add(forward.scale(WALL_DISTANCE))
  holePos.y = roomCam.position.y - 0.4
  const yaw = Math.atan2(forward.x, forward.z) + Math.PI
  const { frame } = placeHole(scene, holePos, yaw)
  frame.position.subtractInPlace(forward.scale(0.04))
  revealParcelThroughHole(scene, roomCam)
  hideHint()
}

async function tryGatewayAR(scene: SceneContext, controls: Controls, spawnCam: Camera): Promise<boolean> {
  if (isIOS() || isSafari()) return false
  const xrNav = navigator.xr
  if (!xrNav?.isSessionSupported) return false
  const supported = await xrNav.isSessionSupported('immersive-ar').catch(() => false)
  if (!supported) return false

  muteCamera(spawnCam)
  spawnCam.layerMask = LAYER_PARCEL
  scene.meshes.forEach((m) => {
    if (!isGatewayMesh(m)) m.layerMask = LAYER_PARCEL
  })

  showHint('tap to look through the phone')

  let entered = false

  const enter = async () => {
    if (entered) return
    entered = true
    const helper = await scene.createDefaultXRExperienceAsync({
      disableDefaultUI: true,
      disableTeleportation: true,
      outputCanvasOptions: { canvasOptions: { framebufferScaleFactor: 0.5 } },
    } as any)
    if (!helper?.baseExperience) throw new Error('no xr')

    await helper.baseExperience.enterXRAsync('immersive-ar', 'local-floor', undefined, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body },
    } as any)

    const hitTest = helper.baseExperience.featuresManager.enableFeature((undefined as any /* todo(lite): BABYLON.WebXRFeatureName.HIT_TEST */), 'latest', {
      disablePermanentHitTest: false,
      enableTransientHitTest: true,
    } as any) as any

    showHint('point the phone at a wall')

    hitTest?.onHitTestResultObservable?.add((results: any[]) => {
      if (holeMesh || !results?.length) return
      const pos = vec3.create()
      const rot = quat.identity()
      const scl = vec3.create()
      results[0].transformationMatrix.decompose(scl, rot, pos)
      const mat = (undefined as any /* todo(lite): new BABYLON.Matrix() */)
      rot.toRotationMatrix(mat)
      const normal = (undefined as any /* todo(lite): BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Up(), mat) */)
      const cam = scene.activeCamera
      if (cam && vec3.dot(normal, cam.globalPosition.subtract(pos)) < 0) normal.scaleInPlace(-1)
      if (cam) cam.position.addInPlace(spawnCam.position.subtract(pos))
      const { hole, frame } = placeHole(scene, pos, 0)
      hole.lookAt(pos.add(normal))
      frame.lookAt(pos.add(normal))
      if (cam) revealParcelThroughHole(scene, cam)
      hideHint()
    })
  }

  scene.onPointerObservable.add((info) => {
    if (info.type !== (undefined as any /* todo(lite): BABYLON.PointerEventTypes.POINTERDOWN */)) return
    if (!entered) {
      enter().catch(() => {
        entered = false
        startPhoneVideo()
        startWallDoor(scene, controls, spawnCam)
      })
    }
  })

  return true
}

function startWallDoor(scene: SceneContext, controls: Controls, spawnCam: Camera) {
  muteCamera(spawnCam)
  controls.disableMovement()
  hidePlayChrome()

  const frozenPos = spawnCam.position.clone()
  const frozenRot = 'rotation' in spawnCam ? (spawnCam as FreeCamera).rotation.clone() : vec3.fromValues(0, 0, 0)

  spawnCam.layerMask = LAYER_PARCEL
  scene.meshes.forEach((m) => {
    if (!isGatewayMesh(m)) m.layerMask = LAYER_PARCEL
  })
  const meshObs = scene.onNewMeshAddedObservable.add((m) => {
    if (!isGatewayMesh(m)) m.layerMask = LAYER_PARCEL
  })

  const roomCam = (undefined as any /* todo(lite): new BABYLON.DeviceOrientationCamera('gateway-room', frozenPos.clone(), scene) */)
  roomCam.rotation.copyFrom(frozenRot)
  roomCam.layerMask = LAYER_ROOM
  roomCam.minZ = 0.1
  roomCam.maxZ = 80
  roomCam.fov = spawnCam.fov
  muteCamera(roomCam)
  scene.activeCamera = roomCam
  enableRoomLook(roomCam)

  showHint('look around with the phone')

  // door is already open; you find it by pointing
  scene.onAfterRenderObservable.addOnce(() => {
    openDoorInFront(scene, roomCam, meshObs)
  })
}

function startStencilDoor(scene: SceneContext, cam: Camera) {
  const pos = cam.position.clone()
  const ray = cam.getForwardRay()
  forward = ray.direction.clone()
  forward.y = 0
  if (forward.lengthSquared() < 0.01) forward.set(0, 0, 1)
  forward.normalize()

  const holePos = pos.add(forward.scale(0.35))
  holePos.y = 1.1
  const parent = (false /* todo(lite): cam.parent instanceof BABYLON.Node */) ? cam.parent : null
  const { hole, frame } = placeHole(scene, holePos, Math.atan2(forward.x, forward.z))
  if (parent) {
    hole.parent = parent
    frame.parent = parent
    hole.position.copyFrom(holePos)
    frame.position.copyFrom(holePos)
  }
  scene.meshes.forEach((m) => {
    if (!isGatewayMesh(m)) m.renderingGroupId = 1
  })
  scene.onNewMeshAddedObservable.add((m) => {
    if (!isGatewayMesh(m)) m.renderingGroupId = 1
  })
  setupStencilPortal(scene)

  const enterObs = scene.onAfterRenderObservable.add(() => {
    if (Date.now() - bootAt < ENTER_AFTER_MS || !holeMesh || !scene.activeCamera) return
    const into = vec3.dot(scene.activeCamera.position.subtract(holeMesh.position), forward)
    if (into > ENTER_DEPTH) {
      scene.onAfterRenderObservable.remove(enterObs)
      enterPlay()
    }
  })
}

export function startGateway(scene: SceneContext, controls: Controls) {
  if (!wantsGateway() || started) return
  const cam = scene.activeCamera
  if (!cam) return
  started = true
  bootAt = Date.now()

  document.body.classList.add('gateway')
  scene.autoClear = true
  scene.autoClearDepthAndStencil = true
  scene.clearColor = ([0, 0, 0, 0] as Color4)
  scene.imageProcessingConfiguration.applyByPostProcess = false
  controls.setNoclip(true)

  const canvas = scene.getEngine().getRenderingCanvas()
  if (canvas) canvas.style.zIndex = '1'

  void tryGatewayAR(scene, controls, cam).then((ok) => {
    if (ok) return
    if (wantsPhoneCamera()) {
      startPhoneVideo()
      startWallDoor(scene, controls, cam)
    } else {
      startStencilDoor(scene, cam)
    }
  })

  if (!isLoaded()) markLoaded()
}

export function hideGatewayBackdrop(skybox?: { mesh: Mesh }, horizon?: { setVisible: (v: boolean) => void }) {
  if (!wantsGateway()) return
  if (skybox) skybox.mesh.isVisible = false
  horizon?.setVisible(false)
}
