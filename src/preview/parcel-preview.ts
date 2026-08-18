// ABOUTME: Headless parcel preview for Playwright. One Parcel on NullGrid, realistic lighting, 10s then webp.

import { voxImporter } from '../../common/vox-import/vox-import'
import type { ParcelRecord } from '../../common/messages/parcel'
import { isRenderable } from '../features/create'
import Grid from '../grid'
import { getComputePool } from '../mono-pool'
import { NullGrid } from '../null-grid'

const SIZE = 1024
const WAIT_MS = 10_000

function lookupEmbed(url: string): string | undefined {
  const map = (window as any).__embeds as Record<string, string> | undefined
  if (!map || !url || url.startsWith('data:')) return
  if (map[url]) return map[url]
  try {
    const abs = new URL(url, location.href)
    return map[abs.href] || map[abs.pathname]
  } catch {
    return
  }
}

function installEmbeds(embeds: Record<string, string> | undefined) {
  const map = embeds || {}
  ;(window as any).__embeds = map
  if ((window as any).__embedsInstalled) return
  ;(window as any).__embedsInstalled = true

  const origFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : String(input)
    const hit = lookupEmbed(raw)
    if (hit) return origFetch(hit, init)
    return origFetch(input as any, init)
  }) as typeof fetch

  const tools = (BABYLON as any).Tools
  if (tools?.LoadImage) {
    const origLoad = tools.LoadImage.bind(tools)
    tools.LoadImage = function (input: any, onload: any, onerror: any, ...rest: any[]) {
      if (typeof input === 'string') {
        const hit = lookupEmbed(input)
        if (hit) input = hit
      }
      return origLoad(input, onload, onerror, ...rest)
    }
  }
  if (tools?.LoadFile) {
    const origFile = tools.LoadFile.bind(tools)
    tools.LoadFile = function (url: any, ...rest: any[]) {
      if (typeof url === 'string') {
        const hit = lookupEmbed(url)
        if (hit) url = hit
      }
      return origFile(url, ...rest)
    }
  }
}

function stubWindow() {
  const noop = () => {}
  ;(window as any).user = { parcels: [] }
  ;(window as any).config = { isNight: false }
  ;(window as any).draw = {
    distance: 64,
    addEventListener: noop,
    removeEventListener: noop,
  }
  ;(window as any).graphic = {
    realisticLighting: true,
    getSettings: () => ({ level: 1 }),
    postProcesses: { reveal: noop },
    addEventListener: noop,
    removeEventListener: noop,
  }
  ;(window as any).environment = {
    addEventListener: noop,
    removeEventListener: noop,
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function zoomCamera(cam: BABYLON.ArcRotateCamera, record: ParcelRecord) {
  // Frame the lot, not scene.getWorldExtends() - parcels live at map coords, not origin.
  const cx = (record.x1 + record.x2) / 2
  const cy = (record.y1 + record.y2) / 2
  const cz = (record.z1 + record.z2) / 2
  cam.alpha = Math.PI / 4
  cam.beta = Math.acos(1 / Math.sqrt(3))
  cam.target.set(cx, cy, cz)
  cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA
  const orthoSize = Math.max(record.x2 - record.x1, record.z2 - record.z1, record.y2 - record.y1, 8) * 0.9
  cam.orthoLeft = -orthoSize
  cam.orthoRight = orthoSize
  cam.orthoTop = orthoSize
  cam.orthoBottom = -orthoSize
  cam.radius = orthoSize * 6
}

async function blobFromCanvas(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/webp', 0.9)
  })
  return blob.arrayBuffer()
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])
  }
  return btoa(s)
}

function filterFeatures(record: ParcelRecord): ParcelRecord {
  const features = (record.features || []).filter((f) => f && isRenderable(f.type))
  return { ...record, features }
}

function makeGround(scene: BABYLON.Scene, record: ParcelRecord) {
  const assetPath = process.env.ASSET_PATH || 'https://www.voxels.com'
  const w = (Math.max(record.x2 - record.x1, 4) + 16) * 2
  const d = (Math.max(record.z2 - record.z1, 4) + 16) * 2
  const tex = new BABYLON.Texture(assetPath + '/textures/subgrid.png', scene)
  tex.uScale = w / 2
  tex.vScale = d / 2
  const mat = new BABYLON.StandardMaterial('preview-ground', scene)
  mat.diffuseColor.set(1, 1, 1)
  mat.specularColor.set(0, 0, 0)
  mat.emissiveColor.set(0.5, 0.5, 0.5)
  mat.ambientTexture = tex
  const ground = BABYLON.MeshBuilder.CreateGround('preview-ground', { width: w, height: d }, scene)
  ground.material = mat
  ground.position.set((record.x1 + record.x2) / 2, record.y1, (record.z1 + record.z2) / 2)
  ground.isPickable = false
  return ground
}

async function renderOnce(record: ParcelRecord, embeds?: Record<string, string>): Promise<ArrayBuffer> {
  stubWindow()
  if (!(globalThis as any).BABYLON) throw new Error('BABYLON missing')
  installEmbeds(embeds)

  const canvas = document.getElementById('c') as HTMLCanvasElement | null
  if (!canvas) throw new Error('no canvas')
  canvas.width = SIZE
  canvas.height = SIZE

  const engine = new BABYLON.Engine(canvas, true)
  const scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color4(1, 1, 1, 1)

  const camera = new BABYLON.ArcRotateCamera('preview', Math.PI / 4, Math.acos(1 / Math.sqrt(3)), 8, BABYLON.Vector3.Zero(), scene)
  camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA
  camera.minZ = 0.01

  const filtered = filterFeatures(record)
  makeGround(scene, filtered)

  // Fresh mesher per render - static Grid.mesher is tied to a scene.
  ;(Grid as any).mesher = undefined
  window.scene = scene
  const grid = new NullGrid(scene)
  await grid.preparePreview()
  if (scene.lights[0]) scene.lights[0].intensity = 0.5
  await getComputePool()
  voxImporter().initialize(scene)
  await Grid.mesher.initialize()

  const parcel = grid.spawnPreview(filtered)
  if (!parcel) throw new Error('spawnPreview failed')
  parcel.preview = true

  try {
    await parcel.generate()
    await parcel.activate()
    await sleep(WAIT_MS)
    await scene.whenReadyAsync()
    zoomCamera(camera, filtered)
    scene.render()
    return await blobFromCanvas(canvas)
  } finally {
    if (!(window as any).__keepPreview) {
      try {
        parcel.unload()
      } catch {
        // ignore
      }
      engine.dispose()
      ;(Grid as any).mesher = undefined
    }
  }
}

async function renderParcelPreview(record: ParcelRecord, embeds?: Record<string, string>): Promise<string> {
  const bytes = await renderOnce(record, embeds)
  return bufToB64(bytes)
}

;(window as any).renderParcelPreview = renderParcelPreview
;(window as any).__parcelRenderReady = true
