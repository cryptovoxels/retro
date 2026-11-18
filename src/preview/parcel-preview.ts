import { createEngine } from '../../common/helpers/utils'
// ABOUTME: Shared OpenSea parcel thumbnail and orbit scene.

import { setMainThread } from '../../common/helpers/detector'
import type { ParcelRecord } from '../../common/messages/parcel'
import { islandGround } from '../terrain/ground'
import { groundOffset } from '../utils/polygon-utils'
import Grid from '../grid'
import { getComputePool } from '../mono-pool'
import { NullGrid } from '../null-grid'
import { OCEAN, createMaterial } from '../voxels-map'

setMainThread()

const SIZE = 1024
const MINI = 278

type LotRect = { id: number; x1: number; x2: number; z1: number; z2: number }

type GhostRow = { type: number; path: string }

type PreviewWorld = {
  lots?: LotRect[]
  islands?: any[]
  ghosts?: GhostRow[]
}

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

  const preprocess = BABYLON.Tools.PreprocessUrl
  const assetUrl = (url: string) => lookupEmbed(url) || url.replace(/^https:\/\/ugc\.voxels\.com\//, '/renderer/ugc/')
  BABYLON.Tools.PreprocessUrl = (url) => assetUrl(preprocess(url))

  const origFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (typeof input === 'string') input = assetUrl(input)
    return origFetch(input, init)
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

function stubStorage() {
  try {
    const testKey = '__test__'
    window.localStorage.setItem(testKey, '1')
    window.localStorage.removeItem(testKey)
  } catch {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      },
      configurable: true,
    })
    Object.defineProperty(window, 'sessionStorage', { value: undefined, configurable: true })
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'storage', { value: {}, configurable: true })
  }
}

function sizeCanvas(canvas: HTMLCanvasElement, orbit: boolean) {
  if (!orbit) {
    canvas.width = SIZE
    canvas.height = SIZE
    return
  }
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.width = canvas.clientWidth || window.innerWidth || SIZE
  canvas.height = canvas.clientHeight || window.innerHeight || SIZE
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
  const engine = cam.getEngine()
  const fit = () => {
    const aspect = engine.getAspectRatio(cam)
    cam.orthoRight = orthoSize * Math.max(1, aspect)
    cam.orthoLeft = -cam.orthoRight
    cam.orthoTop = orthoSize * Math.max(1, 1 / aspect)
    cam.orthoBottom = -cam.orthoTop
  }
  fit()
  engine.onResizeObservable.add(fit)
  cam.radius = orthoSize * 6
}

async function blobFromCanvas(canvas: HTMLCanvasElement, type = 'image/webp', quality = 0.9): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality)
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

function groundSize(record: ParcelRecord) {
  const w = (Math.max(record.x2 - record.x1, 4) + 16) * 2
  const d = (Math.max(record.z2 - record.z1, 4) + 16) * 2
  const cx = (record.x1 + record.x2) / 2
  const cz = (record.z1 + record.z2) / 2
  return { w, d, cx, cz }
}

function subgridMaterial(scene: BABYLON.Scene) {
  const assetPath = process.env.ASSET_PATH || 'https://www.voxels.com'
  const tex = new BABYLON.Texture(assetPath + '/textures/subgrid.png', scene)
  tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE
  tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE
  const mat = new BABYLON.StandardMaterial('preview-subgrid', scene)
  mat.disableLighting = true
  mat.emissiveColor.set(0.5, 0.5, 0.5)
  mat.emissiveTexture = tex
  mat.backFaceCulling = false
  mat.freeze()
  return mat
}

function subgridUv(mesh: BABYLON.Mesh) {
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)
  if (!positions) return
  const uvs = new Float32Array((positions.length / 3) * 2)
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    uvs[j] = positions[i] / 2
    uvs[j + 1] = positions[i + 2] / 2
  }
  mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs)
}

function makeOcean(scene: BABYLON.Scene, record: ParcelRecord) {
  const { w, d, cx, cz } = groundSize(record)
  // Huge slab so the ortho frustum is always over water even for big lots.
  const ocean = BABYLON.MeshBuilder.CreateBox('preview-ocean', { width: Math.max(w * 4, 500), height: 1, depth: Math.max(d * 4, 500) }, scene)
  ocean.position.set(cx, record.y1 - 1.5, cz)
  ocean.material = createMaterial('preview-ocean', scene, OCEAN.r, OCEAN.g, OCEAN.b)
  ocean.isPickable = false
  ocean.receiveShadows = false
}

function islandHoles(multipolygon: any) {
  const nudge = 0.25
  if (!multipolygon?.coordinates) return []
  return multipolygon.coordinates.map((p: any) => p[0].map((c: any) => new BABYLON.Vector2(c[0] * 100 + nudge, c[1] * 100 + nudge)))
}

async function makeIslands(scene: BABYLON.Scene, record: ParcelRecord, islands: any[]) {
  if (!islands.length) return
  const mat = subgridMaterial(scene)
  const root = new BABYLON.TransformNode('preview-islands', scene)
  // PolygonMeshBuilder extrudes in -Y from y=0; top of 1m slab at record.y1.
  root.position.y = record.y1

  for (const desc of islands) {
    try {
      const rings = desc?.geometry?.coordinates
      if (!Array.isArray(rings) || !rings[0]) continue
      const shape = rings[0].map((c: any) => new BABYLON.Vector2(c[0] * 100, c[1] * 100)).reverse()
      const pt = new BABYLON.PolygonMeshBuilder('island/' + desc.name, shape, scene)
      let holes = islandHoles(desc.lakes_geometry_json)
      if (desc.holes_geometry_json && ['Scarcity', 'Flora', 'Andromeda'].includes(desc.name)) {
        holes = holes.concat(islandHoles(desc.holes_geometry_json))
      }
      holes.forEach((hole: BABYLON.Vector2[]) => pt.addHole(hole))
      const meshes = [pt.build(false, 1)]
      if (desc.id >= 40) {
        for (const s of rings.slice(1)) {
          const extra = s.map((c: any) => new BABYLON.Vector2(c[0] * 100, c[1] * 100)).reverse()
          meshes.push(new BABYLON.PolygonMeshBuilder('island/' + desc.name, extra, scene).build(false, 1))
        }
      }
      const mesh = BABYLON.Mesh.MergeMeshes(meshes, true)
      if (!mesh) continue
      mesh.parent = root
      subgridUv(mesh)
      mesh.material = mat
      mesh.isPickable = false
      if (desc.ground && desc.name === record.island) {
        await islandGround(mesh, desc)
        if (mesh.material !== mat) {
          mesh.parent = null
          const offset = groundOffset(desc.texture)
          mesh.position.set(offset, 0, offset)
        }
      }
    } catch (e) {
      console.error('[preview] island', desc?.name, e)
    }
  }
}

function makeLotOutlines(scene: BABYLON.Scene, record: ParcelRecord, lots: LotRect[]) {
  if (!lots.length) return
  // Thin raised edges - no opaque plane to hide the ocean/island stack.
  const y = record.y1 + 0.02
  const h = 0.08
  const t = 0.12
  const mat = createMaterial('preview-lots', scene, 0.333, 0.333, 0.333)
  for (const lot of lots) {
    const w = lot.x2 - lot.x1
    const d = lot.z2 - lot.z1
    const cx = (lot.x1 + lot.x2) / 2
    const cz = (lot.z1 + lot.z2) / 2
    const edges = [
      { width: w, depth: t, x: cx, z: lot.z1 + t / 2 },
      { width: w, depth: t, x: cx, z: lot.z2 - t / 2 },
      { width: t, depth: d, x: lot.x1 + t / 2, z: cz },
      { width: t, depth: d, x: lot.x2 - t / 2, z: cz },
    ]
    for (const e of edges) {
      const box = BABYLON.MeshBuilder.CreateBox('lot-edge', { width: e.width, height: h, depth: e.depth }, scene)
      box.position.set(e.x, y + h / 2, e.z)
      box.material = mat
      box.isPickable = false
    }
  }
}

// Same packing as src/ghosts.ts: float32 t,x,y,z per sample.
function unpackPath(b64: string): Float32Array | null {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    if (bytes.byteLength % 16 !== 0 || bytes.byteLength < 32) return null
    return new Float32Array(bytes.buffer)
  } catch {
    return null
  }
}

// Black capsules replaying visitor paths on loop. Returns the per-frame tick.
function makeGhosts(scene: BABYLON.Scene, rows: GhostRow[]) {
  const paths = rows.map((r) => unpackPath(r.path)).filter((p): p is Float32Array => !!p)
  if (!paths.length) return () => {}
  const mat = createMaterial('preview-ghost', scene, 0, 0, 0)
  const start = performance.now()
  const ghosts = paths.map((path) => {
    const mesh = BABYLON.MeshBuilder.CreateCapsule('preview-ghost', { height: 1.8, radius: 0.35 }, scene)
    mesh.material = mat
    mesh.isPickable = false
    // Linger 2s at the end so it reads as arriving, not teleporting.
    return { mesh, path, loop: path[path.length - 4] - path[0] + 2 }
  })
  return () => {
    const now = (performance.now() - start) / 1000
    for (const { mesh, path, loop } of ghosts) {
      const t = path[0] + (now % loop)
      let i = 4
      while (i < path.length - 4 && path[i] < t) i += 4
      const a = i - 4
      const f = Math.min(1, Math.max(0, (t - path[a]) / Math.max(0.001, path[i] - path[a])))
      mesh.position.set(path[a + 1] + (path[i + 1] - path[a + 1]) * f, path[a + 2] + (path[i + 2] - path[a + 2]) * f + 0.9, path[a + 3] + (path[i + 3] - path[a + 3]) * f)
    }
  }
}

function islandBounds(islands: any[]) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const desc of islands) {
    const rings = desc?.geometry?.coordinates
    if (!Array.isArray(rings)) continue
    for (const ring of rings) {
      if (!Array.isArray(ring)) continue
      for (const c of ring) {
        if (!Array.isArray(c) || c.length < 2) continue
        const x = c[0] * 100
        const z = c[1] * 100
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
    }
  }
  if (!Number.isFinite(minX)) {
    return { cx: 0, cz: 0, span: 2000 }
  }
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const span = Math.max(maxX - minX, maxZ - minZ, 1) * 1.05
  return { cx, cz, span }
}

function drawMap(ctx: CanvasRenderingContext2D, record: ParcelRecord, islands: any[]) {
  const { cx, cz, span } = islandBounds(islands)
  const scale = MINI / span
  const x = (world: number) => MINI / 2 + (world - cx) * scale
  const z = (world: number) => MINI / 2 - (world - cz) * scale
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#19130f'
  ctx.lineWidth = 2
  for (const island of islands) {
    ctx.beginPath()
    for (const ring of island.geometry?.coordinates || []) {
      ring.forEach(([px, pz]: number[], i: number) => {
        if (i === 0) ctx.moveTo(x(px * 100), z(pz * 100))
        else ctx.lineTo(x(px * 100), z(pz * 100))
      })
      ctx.closePath()
    }
    ctx.fillStyle = island.name === 'Origin City' ? '#fff1c4' : '#e3d8bd'
    ctx.stroke()
    ctx.fill('evenodd')
  }

  ctx.font = '17px Bangers, sans-serif'
  ctx.lineWidth = 3
  ctx.strokeText('Origin City', x(0) + 14, z(0) + 4)
  ctx.fillStyle = '#fff1c4'
  ctx.fillText('Origin City', x(0) + 14, z(0) + 4)
  ctx.beginPath()
  ctx.arc(x((record.x1 + record.x2) / 2), z((record.z1 + record.z2) / 2), 5, 0, Math.PI * 2)
  ctx.fillStyle = '#ffda24'
  ctx.fill()
  ctx.stroke()
}

async function makeOverlay(scene: BABYLON.Scene, record: ParcelRecord, islands: any[]) {
  if (!BABYLON.GUI) return
  if (!Array.from(document.fonts).some((font) => font.family === 'Bangers')) {
    const font = new FontFace('Bangers', 'url(/renderer/page/fonts/Bangers-Regular.ttf)')
    await font
      .load()
      .then((face) => document.fonts.add(face))
      .catch(() => {})
  }
  const ui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('parcel-overlay', true, scene)
  ui.useInvalidateRectOptimization = false
  ui.onEndRenderObservable.add(() => {
    const ctx = ui.getContext() as CanvasRenderingContext2D
    const { width, height } = ui.getSize()
    const scale = Math.min(width, height) / SIZE
    ctx.save()
    ctx.scale(scale, scale)
    ctx.lineJoin = 'round'
    const label = (text: string, size: number, y: number, fill: string, stroke: number) => {
      ctx.font = size + 'px Bangers, sans-serif'
      ctx.lineWidth = stroke
      ctx.strokeStyle = '#100c09'
      const max = width / scale - 60
      ctx.strokeText(text, 33, y + 5, max)
      ctx.strokeText(text, 30, y, max)
      ctx.fillStyle = fill
      ctx.fillText(text, 30, y, max)
    }
    label(record.name || record.address || '#' + record.id, 82, 87, '#ffda24', 9)
    label(record.island || '', 43, 137, record.island === 'Texas' ? '#d38a50' : '#fff1c4', 6)
    if (islands.length) {
      ctx.translate(width / scale - MINI - 16, height / scale - MINI - 4)
      drawMap(ctx, record, islands)
    }
    ctx.restore()
  })
}

type PreviewLive = {
  canvas: HTMLCanvasElement
  engine: BABYLON.Engine
  scene: BABYLON.Scene
  camera: BABYLON.ArcRotateCamera
  parcel: any
}

async function buildPreview(record: ParcelRecord, embeds: Record<string, string> | undefined, world: PreviewWorld | undefined, orbit: boolean): Promise<PreviewLive> {
  stubWindow()
  if (orbit) stubStorage()
  if (!(globalThis as any).BABYLON) throw new Error('BABYLON missing')
  installEmbeds(embeds)

  const canvas = document.getElementById('c') as HTMLCanvasElement | null
  if (!canvas) throw new Error('no canvas')
  sizeCanvas(canvas, orbit)

  const engine = createEngine(canvas, true, { audioEngine: true })
  const scene = new BABYLON.Scene(engine)
  scene.clearColor = OCEAN.clone()

  const camera = new BABYLON.ArcRotateCamera('preview', Math.PI / 4, Math.acos(1 / Math.sqrt(3)), 8, BABYLON.Vector3.Zero(), scene)
  camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA
  camera.minZ = 0.01

  makeOcean(scene, record)
  await makeIslands(scene, record, world?.islands || [])
  makeLotOutlines(scene, record, world?.lots || [])
  await makeOverlay(scene, record, world?.islands || [])

  window.scene = scene
  const grid = new NullGrid(scene)
  await grid.preparePreview()
  scene.clearColor = OCEAN.clone()
  await getComputePool()

  const features = (record.features || []).filter((f) => f && ['vox-model', 'megavox', 'ride', 'collectible-model', 'group'].includes(f.type))
  const parcel = grid.spawnPreview({ ...record, features })
  if (!parcel) throw new Error('spawnPreview failed')
  parcel.preview = true

  await parcel.generate()
  await parcel.activate()
  await scene.whenReadyAsync()
  zoomCamera(camera, record)
  scene.clearColor = new BABYLON.Color4(OCEAN.r, OCEAN.g, OCEAN.b, 1)
  return { canvas, engine, scene, camera, parcel }
}

async function renderOnce(record: ParcelRecord, embeds?: Record<string, string>, world?: PreviewWorld, type = 'image/webp'): Promise<ArrayBuffer> {
  const live = await buildPreview(record, embeds, world, false)
  try {
    // Twice so GUI DynamicTexture uploads before capture.
    live.scene.render()
    live.scene.render()
    const quality = type === 'image/png' ? 0.8 : 0.9
    return await blobFromCanvas(live.canvas, type, quality)
  } finally {
    if (!(window as any).__keepPreview) {
      try {
        live.parcel.unload()
      } catch {
        // ignore
      }
      live.engine.dispose()
      ;(Grid as any).mesher = undefined
    }
  }
}

async function renderParcelPreview(record: ParcelRecord, embeds?: Record<string, string>, world?: PreviewWorld, type = 'image/webp'): Promise<string> {
  const bytes = await renderOnce(record, embeds, world, type)
  return bufToB64(bytes)
}

async function orbitParcelPreview(record: ParcelRecord, embeds?: Record<string, string>, world?: PreviewWorld): Promise<void> {
  const live = await buildPreview(record, embeds, world, true)
  const tickGhosts = makeGhosts(live.scene, world?.ghosts || [])
  live.engine.runRenderLoop(() => {
    live.camera.alpha += live.engine.getDeltaTime() / 1000
    tickGhosts()
    live.scene.render()
  })
  window.addEventListener('resize', () => live.engine.resize())
}

;(window as any).renderParcelPreview = renderParcelPreview
;(window as any).orbitParcelPreview = orbitParcelPreview
;(window as any).__parcelRenderReady = true
