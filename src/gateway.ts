import { isIOS, isMobile, isTablet, wantsGateway } from '../common/helpers/detector'
import type Controls from './controls/controls'
import { isLoaded, markLoaded } from './utils/loading-done'

const HOLE = 'gateway-hole'
const FRAME = 'gateway-frame'
const ENTER_AFTER_MS = 1500
const ENTER_DEPTH = 0.45

let started = false
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

function startPhoneVideo() {
  if (!wantsPhoneCamera() || !navigator.mediaDevices?.getUserMedia) return

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
  // iOS often needs a tap before the permission sheet shows
  window.addEventListener('pointerdown', ask, { capture: true })
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

  const canvas = scene.getEngine().getRenderingCanvas()
  if (canvas) canvas.style.zIndex = '1'
  startPhoneVideo()
  if (!isLoaded()) markLoaded()
}

export function hideGatewayBackdrop(skybox?: { mesh: BABYLON.Mesh }, horizon?: { setVisible: (v: boolean) => void }) {
  if (!wantsGateway()) return
  if (skybox) skybox.mesh.isVisible = false
  horizon?.setVisible(false)
}
