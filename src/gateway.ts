import { isIOS, isMobile, isTablet, wantsGateway } from '../common/helpers/detector'
import type Controls from './controls/controls'
import { isLoaded, markLoaded } from './utils/loading-done'

const HOLE = 'gateway-hole'
const FRAME = 'gateway-frame'
const ENTER_AFTER_MS = 1500
const ENTER_DEPTH = 0.45
const WALL_DISTANCE = 3.2
const LAYER_PARCEL = 1
const LAYER_ROOM = 2
const OPEN_FRAMES = 42

let started = false
let videoStarted = false
let holeMesh: BABYLON.Mesh | null = null
let forward = new BABYLON.Vector3(0, 0, 1)
let bootAt = 0

function isGatewayMesh(mesh: BABYLON.AbstractMesh) {
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
    el.style.cssText =
      'position:fixed;left:1rem;right:1rem;bottom:2rem;text-align:center;z-index:9999;pointer-events:none;color:var(--bg);font-size:1rem;'
    document.body.appendChild(el)
  }
  el.textContent = text
}

function hideHint() {
  document.getElementById('gatewayHint')?.remove()
}

function playOpen(hole: BABYLON.Mesh, frame: BABYLON.Mesh) {
  const ease = new BABYLON.CubicEase()
  ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT)
  hole.scaling.set(0.04, 0.06, 1)
  frame.scaling.set(0.04, 0.06, 1)
  const end = new BABYLON.Vector3(1, 1, 1)
  BABYLON.Animation.CreateAndStartAnimation('gateway-open-h', hole, 'scaling', 60, OPEN_FRAMES, hole.scaling.clone(), end, 0, ease)
  BABYLON.Animation.CreateAndStartAnimation('gateway-open-f', frame, 'scaling', 60, OPEN_FRAMES, frame.scaling.clone(), end, 0, ease)
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
  showHint('allow the camera, then point at a wall and tap')
}

function enableRoomLook(camera: BABYLON.DeviceOrientationCamera) {
  const DOE = window.DeviceOrientationEvent as any
  if (DOE && typeof DOE.requestPermission === 'function') {
    const once = () => {
      DOE.requestPermission()
        .then((s: string) => {
          if (s === 'granted' && typeof camera.enableDeviceOrientation === 'function') camera.enableDeviceOrientation()
        })
        .catch(() => {})
    }
    window.addEventListener('pointerdown', once, { capture: true, once: true })
  } else if (typeof camera.enableDeviceOrientation === 'function') {
    camera.enableDeviceOrientation()
  }
}

function placeHole(scene: BABYLON.Scene, holePos: BABYLON.Vector3, yawOrQuat: number | BABYLON.Quaternion) {
  const hole = BABYLON.MeshBuilder.CreatePlane(HOLE, { width: 1.2, height: 2.2 }, scene)
  hole.position.copyFrom(holePos)
  if (typeof yawOrQuat === 'number') hole.rotation.y = yawOrQuat
  else hole.rotationQuaternion = yawOrQuat
  hole.renderingGroupId = 0
  hole.layerMask = 0x0fffffff
  hole.isPickable = true
  const holeMat = new BABYLON.StandardMaterial(HOLE, scene)
  holeMat.disableColorWrite = true
  holeMat.disableDepthWrite = true
  holeMat.backFaceCulling = false
  holeMat.fogEnabled = false
  hole.material = holeMat
  holeMesh = hole

  const frame = BABYLON.MeshBuilder.CreateBox(FRAME, { width: 1.32, height: 2.32, depth: 0.06 }, scene)
  frame.position.copyFrom(holePos)
  if (typeof yawOrQuat === 'number') frame.rotation.y = yawOrQuat
  else frame.rotationQuaternion = yawOrQuat.clone()
  frame.renderingGroupId = 2
  frame.layerMask = 0x0fffffff
  frame.isPickable = false
  const frameMat = new BABYLON.StandardMaterial(FRAME, scene)
  frameMat.emissiveColor = new BABYLON.Color3(0.45, 0.45, 0.4)
  frameMat.disableLighting = true
  frameMat.wireframe = true
  frameMat.fogEnabled = false
  frame.material = frameMat
  return { hole, frame }
}

function revealParcelThroughHole(scene: BABYLON.Scene, cam: BABYLON.Camera) {
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

async function tryGatewayAR(scene: BABYLON.Scene, controls: Controls, spawnCam: BABYLON.Camera): Promise<boolean> {
  const xrNav = navigator.xr
  if (!xrNav?.isSessionSupported) return false
  const supported = await xrNav.isSessionSupported('immersive-ar').catch(() => false)
  if (!supported) return false

  try {
    spawnCam.detachControl()
  } catch {}

  spawnCam.layerMask = LAYER_PARCEL
  scene.meshes.forEach((m) => {
    if (!isGatewayMesh(m)) m.layerMask = LAYER_PARCEL
  })
  scene.onNewMeshAddedObservable.add((m) => {
    if (!isGatewayMesh(m) && !holeMesh) m.layerMask = LAYER_PARCEL
  })

  showHint('tap to start, then tap a wall')

  const worldOffset = spawnCam.parent instanceof BABYLON.TransformNode ? spawnCam.parent : null
  let lastHit: { position: BABYLON.Vector3; rotation: BABYLON.Quaternion } | null = null
  let placing = true
  let openedAt = 0
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

    const hitTest = helper.baseExperience.featuresManager.enableFeature(BABYLON.WebXRFeatureName.HIT_TEST, 'latest', {
      disablePermanentHitTest: false,
      enableTransientHitTest: true,
    } as any) as any

    hitTest?.onHitTestResultObservable?.add((results: any[]) => {
      if (!results?.length) return
      const pos = new BABYLON.Vector3()
      const rot = new BABYLON.Quaternion()
      const scl = new BABYLON.Vector3()
      results[0].transformationMatrix.decompose(scl, rot, pos)
      lastHit = { position: pos, rotation: rot }
    })

    showHint('tap a wall to open the door')
  }

  const place = () => {
    if (!placing || !lastHit) return
    placing = false
    const hitPos = lastHit.position
    const hitRot = lastHit.rotation
    const mat = new BABYLON.Matrix()
    hitRot.toRotationMatrix(mat)
    const normal = BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Up(), mat)
    const cam = scene.activeCamera
    if (cam && BABYLON.Vector3.Dot(normal, cam.globalPosition.subtract(hitPos)) < 0) normal.scaleInPlace(-1)

    if (worldOffset) {
      const spawnAbs = spawnCam.getAbsolutePosition()
      worldOffset.position.addInPlace(hitPos.subtract(spawnAbs))
    }
    const { hole, frame } = placeHole(scene, hitPos, 0)
    hole.lookAt(hitPos.add(normal))
    frame.lookAt(hitPos.add(normal))
    if (scene.activeCamera) revealParcelThroughHole(scene, scene.activeCamera)
    playOpen(hole, frame)
    hideHint()
    openedAt = Date.now()
  }

  scene.onPointerObservable.add((info) => {
    if (info.type !== BABYLON.PointerEventTypes.POINTERDOWN) return
    if (!entered) {
      enter().catch(() => {
        entered = false
        startPhoneVideo()
        startWallDoor(scene, controls, spawnCam)
      })
      return
    }
    if (placing) {
      place()
      return
    }
    if (info.pickInfo?.pickedMesh === holeMesh && Date.now() - openedAt > 700) enterPlay()
  })

  return true
}
  const d = cam.getForwardRay().direction.clone()
  d.y = 0
  if (d.lengthSquared() < 0.01) d.set(0, 0, 1)
  d.normalize()
  return d
}

function setupStencilPortal(scene: BABYLON.Scene) {
  scene.setRenderingAutoClearDepthStencil(0, true, true, true)
  scene.setRenderingAutoClearDepthStencil(1, false, true, false)
  scene.setRenderingAutoClearDepthStencil(2, false, false, false)

  const engine = scene.getEngine()
  scene.onBeforeRenderingGroupObservable.add((info) => {
    if (info.renderingGroupId === 0) {
      engine.setStencilBuffer(true)
      engine.setStencilMask(0xff)
      engine.setStencilFunction(BABYLON.Engine.ALWAYS)
      engine.setStencilFunctionReference(1)
      engine.setStencilOperation(BABYLON.Engine.KEEP, BABYLON.Engine.KEEP, BABYLON.Engine.REPLACE)
    } else if (info.renderingGroupId === 1) {
      engine.setStencilBuffer(true)
      engine.setStencilMask(0x00)
      engine.setStencilFunction(BABYLON.Engine.EQUAL)
      engine.setStencilFunctionReference(1)
      engine.setStencilOperation(BABYLON.Engine.KEEP, BABYLON.Engine.KEEP, BABYLON.Engine.KEEP)
    } else {
      engine.setStencilBuffer(false)
    }
  })
}

function lookDir(cam: BABYLON.Camera) {
  const d = cam.getForwardRay().direction.clone()
  d.y = 0
  if (d.lengthSquared() < 0.01) d.set(0, 0, 1)
  d.normalize()
  return d
}

function startWallDoor(scene: BABYLON.Scene, controls: Controls, spawnCam: BABYLON.Camera) {
  try {
    spawnCam.detachControl()
  } catch {}
  controls.disableMovement()

  const frozenPos = spawnCam.position.clone()
  const frozenRot = 'rotation' in spawnCam ? (spawnCam as BABYLON.FreeCamera).rotation.clone() : new BABYLON.Vector3(0, 0, 0)
  const worldOffset = spawnCam.parent instanceof BABYLON.TransformNode ? spawnCam.parent : null

  spawnCam.layerMask = LAYER_PARCEL
  scene.meshes.forEach((m) => {
    if (!isGatewayMesh(m)) m.layerMask = LAYER_PARCEL
  })
  const meshObs = scene.onNewMeshAddedObservable.add((m) => {
    if (!isGatewayMesh(m)) m.layerMask = LAYER_PARCEL
  })

  const roomCam = new BABYLON.DeviceOrientationCamera('gateway-room', frozenPos.clone(), scene)
  if (worldOffset) roomCam.parent = worldOffset
  roomCam.rotation.copyFrom(frozenRot)
  roomCam.layerMask = LAYER_ROOM
  roomCam.minZ = 0.1
  roomCam.maxZ = 80
  roomCam.fov = spawnCam.fov
  scene.activeCamera = roomCam
  enableRoomLook(roomCam)

  showHint('point at a wall, then tap')

  let placing = true
  let openedAt = 0
  const readyAt = Date.now() + 600

  scene.onPointerObservable.add((info) => {
    if (info.type !== BABYLON.PointerEventTypes.POINTERDOWN) return

    if (placing) {
      if (Date.now() < readyAt) return
      placing = false
      forward = lookDir(roomCam)
      roomCam.setParent(null)
      scene.onNewMeshAddedObservable.remove(meshObs)

      // parcel starts at the wall so the hole is a real view into the rooms, not a sticker
      if (worldOffset) worldOffset.position.addInPlace(forward.scale(WALL_DISTANCE))

      const holePos = roomCam.position.add(forward.scale(WALL_DISTANCE))
      holePos.y = roomCam.position.y - 0.4
      const yaw = Math.atan2(forward.x, forward.z) + Math.PI

      const hole = BABYLON.MeshBuilder.CreatePlane(HOLE, { width: 1.2, height: 2.2 }, scene)
      hole.position.copyFrom(holePos)
      hole.rotation.y = yaw
      hole.renderingGroupId = 0
      hole.layerMask = 0x0fffffff
      hole.isPickable = true
      const holeMat = new BABYLON.StandardMaterial(HOLE, scene)
      holeMat.disableColorWrite = true
      holeMat.disableDepthWrite = true
      holeMat.backFaceCulling = false
      holeMat.fogEnabled = false
      hole.material = holeMat
      holeMesh = hole

      const frame = BABYLON.MeshBuilder.CreateBox(FRAME, { width: 1.32, height: 2.32, depth: 0.06 }, scene)
      frame.position.copyFrom(holePos)
      frame.position.subtractInPlace(forward.scale(0.04))
      frame.rotation.y = yaw
      frame.renderingGroupId = 2
      frame.layerMask = 0x0fffffff
      frame.isPickable = false
      const frameMat = new BABYLON.StandardMaterial(FRAME, scene)
      frameMat.emissiveColor = new BABYLON.Color3(0.45, 0.45, 0.4)
      frameMat.disableLighting = true
      frameMat.wireframe = true
      frameMat.fogEnabled = false
      frame.material = frameMat

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
      roomCam.layerMask = 0x0fffffff
      setupStencilPortal(scene)
      playOpen(hole, frame)
      hideHint()
      openedAt = Date.now()
      return
    }

    if (info.pickInfo?.pickedMesh === holeMesh && Date.now() - openedAt > 700) enterPlay()
  })
}

function startStencilDoor(scene: BABYLON.Scene, cam: BABYLON.Camera) {
  const pos = cam.position.clone()
  const ray = cam.getForwardRay()
  forward = ray.direction.clone()
  forward.y = 0
  if (forward.lengthSquared() < 0.01) forward.set(0, 0, 1)
  forward.normalize()

  const holePos = pos.add(forward.scale(0.35))
  holePos.y = 1.1
  const parent = cam.parent instanceof BABYLON.Node ? cam.parent : null

  const hole = BABYLON.MeshBuilder.CreatePlane(HOLE, { width: 1.2, height: 2.2 }, scene)
  if (parent) hole.parent = parent
  hole.position.copyFrom(holePos)
  hole.rotation.y = Math.atan2(forward.x, forward.z)
  hole.isPickable = false
  hole.renderingGroupId = 0
  const holeMat = new BABYLON.StandardMaterial(HOLE, scene)
  holeMat.disableColorWrite = true
  holeMat.disableDepthWrite = true
  holeMat.backFaceCulling = false
  holeMat.fogEnabled = false
  hole.material = holeMat
  holeMesh = hole

  const frame = BABYLON.MeshBuilder.CreateBox(FRAME, { width: 1.28, height: 2.28, depth: 0.08 }, scene)
  if (parent) frame.parent = parent
  frame.position.copyFrom(holePos)
  frame.rotation.y = hole.rotation.y
  frame.isPickable = false
  frame.renderingGroupId = 2
  const frameMat = new BABYLON.StandardMaterial(FRAME, scene)
  frameMat.emissiveColor = new BABYLON.Color3(0.55, 0.55, 0.5)
  frameMat.disableLighting = true
  frameMat.wireframe = true
  frameMat.fogEnabled = false
  frame.material = frameMat

  scene.meshes.forEach((m) => {
    if (!isGatewayMesh(m)) m.renderingGroupId = 1
  })
  scene.onNewMeshAddedObservable.add((m) => {
    if (!isGatewayMesh(m)) m.renderingGroupId = 1
  })

  setupStencilPortal(scene)

  const enterObs = scene.onAfterRenderObservable.add(() => {
    if (Date.now() - bootAt < ENTER_AFTER_MS || !holeMesh || !scene.activeCamera) return
    const into = BABYLON.Vector3.Dot(scene.activeCamera.position.subtract(holeMesh.position), forward)
    if (into > ENTER_DEPTH) {
      scene.onAfterRenderObservable.remove(enterObs)
      enterPlay()
    }
  })
}

export function startGateway(scene: BABYLON.Scene, controls: Controls) {
  if (!wantsGateway() || started) return
  const cam = scene.activeCamera
  if (!cam) return
  started = true
  bootAt = Date.now()

  document.body.classList.add('gateway')
  scene.autoClear = true
  scene.autoClearDepthAndStencil = true
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 0)
  scene.imageProcessingConfiguration.applyByPostProcess = false
  controls.gravityDisabledOverride = true

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

export function hideGatewayBackdrop(skybox?: { mesh: BABYLON.Mesh }, horizon?: { setVisible: (v: boolean) => void }) {
  if (!wantsGateway()) return
  if (skybox) skybox.mesh.isVisible = false
  horizon?.setVisible(false)
}
