// ABOUTME: Shared Babylon vox -> webp thumb render. Used by browser worker and Playwright page.

import { expandMeshBuf } from '../../common/mesh/upload'
import { loadVox } from '../../src/monoworker/vox'
import type { Renderable, RenderedImage, ThumbScene } from './types'

let jobIndex = 1

function parseBg(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return new BABYLON.Color4(1, 0, 0.667, 1)
  const n = parseInt(m[1], 16)
  return new BABYLON.Color4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1)
}

function zoomCamera(cam: BABYLON.ArcRotateCamera, scn: BABYLON.Scene) {
  const extents = scn.getWorldExtends()
  const bounds = new BABYLON.BoundingBox(extents.min, extents.max)
  cam.alpha = Math.PI / 4
  cam.beta = Math.acos(1 / Math.sqrt(3))
  cam.target = bounds.center.clone()
  cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA
  const orthoSize = Math.max(bounds.extendSize.length() * 1.5, 0.5)
  cam.orthoLeft = -orthoSize
  cam.orthoRight = orthoSize
  cam.orthoTop = orthoSize
  cam.orthoBottom = -orthoSize
  cam.radius = orthoSize * 6
}

async function blobFromCanvas(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<ArrayBuffer> {
  if ('convertToBlob' in canvas && typeof (canvas as OffscreenCanvas).convertToBlob === 'function') {
    const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality: 0.9 })
    return blob.arrayBuffer()
  }
  const el = canvas as HTMLCanvasElement
  const blob = await new Promise<Blob>((resolve, reject) => {
    el.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/webp', 0.9)
  })
  return blob.arrayBuffer()
}

async function meshFromBuffer(scene: BABYLON.Scene, buf: ArrayBuffer): Promise<BABYLON.Mesh> {
  const data = await loadVox({
    renderJob: jobIndex++,
    buffer: buf.slice(0),
    flipX: true,
    megavox: false,
    wantCollider: false,
    timeoutMs: 10000,
  })
  if (data?.cancelled) throw new Error('vox cancelled')
  if (!data?.pos) throw new Error('vox parse failed')

  const { positions, colors, indices } = expandMeshBuf(data)
  const mesh = new BABYLON.Mesh('thumb', scene)
  const vd = new BABYLON.VertexData()
  vd.positions = positions
  vd.indices = indices
  vd.colors = colors
  vd.applyToMesh(mesh)

  const mat = new BABYLON.StandardMaterial('thumb', scene)
  mat.diffuseColor.set(1, 1, 1)
  mat.specularColor.set(0, 0, 0)
  mat.emissiveColor.set(0.25, 0.25, 0.25)
  mat.backFaceCulling = false
  mat.freeze()
  mesh.material = mat

  mesh.computeWorldMatrix(true)
  mesh.refreshBoundingInfo()
  const center = mesh.getBoundingInfo().boundingBox.centerWorld
  mesh.position.set(-center.x, -center.y, center.z)
  mesh.freezeWorldMatrix()
  return mesh
}

export function createThumbScene(canvas: OffscreenCanvas | HTMLCanvasElement): ThumbScene {
  const engine = new BABYLON.Engine(canvas as any, true)
  const scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color4(1, 0, 0.667, 1)
  const camera = new BABYLON.ArcRotateCamera('thumb', Math.PI / 4, Math.acos(1 / Math.sqrt(3)), 8, BABYLON.Vector3.Zero(), scene)
  camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA
  camera.useAutoRotationBehavior = false
  camera.minZ = 0.01
  const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene)
  hemi.intensity = 1
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -1, 1), scene)
  sun.intensity = 1.2
  scene.ambientColor = new BABYLON.Color3(1, 1, 1)
  return { engine, scene, camera, canvas }
}

export async function renderVoxThumb(ctx: ThumbScene, renderable: Renderable): Promise<RenderedImage> {
  const { scene, camera, canvas, engine } = ctx
  if (renderable.size > 0) {
    engine.setSize(renderable.size, renderable.size)
  }
  scene.clearColor = parseBg(renderable.background)
  let mesh: BABYLON.Mesh | undefined
  try {
    mesh = await meshFromBuffer(scene, renderable.bytes)
    zoomCamera(camera, scene)
    scene.render()
    const bytes = await blobFromCanvas(canvas)
    return { bytes, contentType: 'image/webp' }
  } finally {
    mesh?.dispose(false, true)
  }
}
