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
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:2rem;text-align:center;z-index:3;pointer-events:none;color:var(--fg);'
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
  const parent = spawnCam.parent instanceof BABYLON.Node ? spawnCam.parent : null

  spawnCam.layerMask = LAYER_PARCEL
  scene.meshes.forEach((m) => {
    if (!isGatewayMesh(m)) m.layerMask = LAYER_PARCEL
  })
  scene.onNewMeshAddedObservable.add((m) => {
    if (!isGatewayMesh(m)) m.layerMask = LAYER_PARCEL
  })

  const rtt = new BABYLON.RenderTargetTexture('gateway-wall', 1024, scene, false)
  rtt.activeCamera = spawnCam
  rtt.renderList = scene.meshes.filter((m) => !isGatewayMesh(m))
  scene.onNewMeshAddedObservable.add((m) => {
    if (!isGatewayMesh(m)) rtt.renderList!.push(m)
  })
  scene.customRenderTargets.push(rtt)

  const roomCam = new BABYLON.DeviceOrientationCamera('gateway-room', frozenPos.clone(), scene)
  if (parent) roomCam.parent = parent
  roomCam.rotation.copyFrom(frozenRot)
  roomCam.layerMask = LAYER_ROOM
  roomCam.minZ = 0.1
  roomCam.maxZ = 40
  roomCam.fov = spawnCam.fov
  scene.activeCamera = roomCam
  enableRoomLook(roomCam)

  scene.onBeforeRenderObservable.add(() => {
    spawnCam.position.copyFrom(frozenPos)
    if ('rotation' in spawnCam) (spawnCam as BABYLON.FreeCamera).rotation.copyFrom(frozenRot)
  })

  showHint('look at a wall, then tap to open the door')

  let placing = true
  let openedAt = 0

  scene.onPointerObservable.add((info) => {
    if (info.type !== BABYLON.PointerEventTypes.POINTERDOWN) return

    if (placing) {
      placing = false
      forward = lookDir(roomCam)
      const holePos = roomCam.position.add(forward.scale(WALL_DISTANCE))
      holePos.y = roomCam.position.y - 0.4

      const hole = BABYLON.MeshBuilder.CreatePlane(HOLE, { width: 1.2, height: 2.2 }, scene)
      if (parent) hole.parent = parent
      hole.position.copyFrom(holePos)
      hole.rotation.y = Math.atan2(forward.x, forward.z) + Math.PI
      hole.layerMask = LAYER_ROOM
      hole.isPickable = true
      const holeMat = new BABYLON.StandardMaterial(HOLE, scene)
      holeMat.diffuseTexture = rtt
      holeMat.emissiveTexture = rtt
      holeMat.disableLighting = true
      holeMat.fogEnabled = false
      holeMat.backFaceCulling = true
      hole.material = holeMat
      holeMesh = hole

      const frame = BABYLON.MeshBuilder.CreateBox(FRAME, { width: 1.32, height: 2.32, depth: 0.06 }, scene)
      if (parent) frame.parent = parent
      frame.position.copyFrom(holePos)
      frame.position.subtractInPlace(forward.scale(0.04))
      frame.rotation.y = hole.rotation.y
      frame.layerMask = LAYER_ROOM
      frame.isPickable = false
      const frameMat = new BABYLON.StandardMaterial(FRAME, scene)
      frameMat.emissiveColor = new BABYLON.Color3(0.45, 0.45, 0.4)
      frameMat.disableLighting = true
      frameMat.wireframe = true
      frameMat.fogEnabled = false
      frame.material = frameMat

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
      engine.setStencilOperationFail(BABYLON.Engine.KEEP)
      engine.setStencilOperationDepthFail(BABYLON.Engine.KEEP)
      engine.setStencilOperationPass(BABYLON.Engine.REPLACE)
    } else if (info.renderingGroupId === 1) {
      engine.setStencilBuffer(true)
      engine.setStencilMask(0x00)
      engine.setStencilFunction(BABYLON.Engine.EQUAL)
      engine.setStencilFunctionReference(1)
      engine.setStencilOperationFail(BABYLON.Engine.KEEP)
      engine.setStencilOperationDepthFail(BABYLON.Engine.KEEP)
      engine.setStencilOperationPass(BABYLON.Engine.KEEP)
    } else {
      engine.setStencilBuffer(false)
    }
  })

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
  startPhoneVideo()

  if (wantsPhoneCamera()) {
    startWallDoor(scene, controls, cam)
  } else {
    startStencilDoor(scene, cam)
  }

  if (!isLoaded()) markLoaded()
}

export function hideGatewayBackdrop(skybox?: { mesh: BABYLON.Mesh }, horizon?: { setVisible: (v: boolean) => void }) {
  if (!wantsGateway()) return
  if (skybox) skybox.mesh.isVisible = false
  horizon?.setVisible(false)
}
