// ABOUTME: Headless parcel preview for Playwright. Voxels only, lot outlines, labels, minimap inset.

import type { ParcelRecord } from '../../common/messages/parcel'
import Grid from '../grid'
import { getComputePool } from '../mono-pool'
import { NullGrid } from '../null-grid'
import { Island, OCEAN, createMaterial } from '../voxels-map'

const SIZE = 1024
const MINI = 200
const MINI_INSET = 10

type LotRect = { id: number; x1: number; x2: number; z1: number; z2: number }

type PreviewWorld = {
  lots?: LotRect[]
  islands?: any[]
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

function makeIslands(scene: BABYLON.Scene, record: ParcelRecord, islands: any[]) {
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

function makeLabels(scene: BABYLON.Scene, record: ParcelRecord) {
  if (!(BABYLON as any).GUI) return
  const ui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('tile', true, scene)
  const label = (text: string, size: number, color: string, top: number) => {
    if (!text) return
    const t = new BABYLON.GUI.TextBlock('', text)
    t.resizeToFit = true
    t.fontSize = size
    t.color = color
    t.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
    t.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP
    t.paddingLeft = '28px'
    t.paddingTop = `${top}px`
    ui.addControl(t)
  }
  label(record.name || record.address || `#${record.id}`, 44, '#fff', 24)
  label(record.island || '', 28, '#ddd', 82)
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

function makeMinimap(engine: BABYLON.Engine, record: ParcelRecord, islands: any[]) {
  const mini = new BABYLON.Scene(engine)
  mini.autoClear = false
  mini.skipPointerMovePicking = true
  mini.skipPointerDownPicking = true
  mini.skipPointerUpPicking = true

  const { cx, cz, span } = islandBounds(islands)
  const cam = new BABYLON.FreeCamera('preview-mini', new BABYLON.Vector3(cx, 100, cz), mini)
  cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA
  cam.setTarget(new BABYLON.Vector3(cx, 0, cz))
  cam.rotation.y = 0
  const half = span / 2
  cam.orthoLeft = -half
  cam.orthoRight = half
  cam.orthoTop = half
  cam.orthoBottom = -half
  cam.viewport = new BABYLON.Viewport(1 - (MINI + MINI_INSET) / SIZE, MINI_INSET / SIZE, MINI / SIZE, MINI / SIZE)
  mini.activeCamera = cam

  const ocean = BABYLON.MeshBuilder.CreateGround('preview-ocean', { width: span * 2, height: span * 2 }, mini)
  ocean.position.set(cx, -1, cz)
  ocean.material = createMaterial('preview-ocean', mini, OCEAN.r, OCEAN.g, OCEAN.b)
  ocean.isPickable = false

  const root = new BABYLON.TransformNode('preview-islands', mini)
  const islandMat = new BABYLON.StandardMaterial('preview-island', mini)
  islandMat.disableLighting = true
  islandMat.emissiveColor.set(0.9, 0.9, 0.9)
  islandMat.backFaceCulling = false
  islandMat.freeze()
  for (const desc of islands) {
    try {
      const island = new Island(mini, root, desc)
      island.setMaterial(islandMat)
      island.setEnabled(true)
    } catch (e) {
      console.error('[preview] island', desc?.name, e)
    }
  }

  const markerSize = Math.max(span * 0.02, 8)
  const marker = BABYLON.MeshBuilder.CreatePlane('preview-marker', { width: markerSize, height: markerSize }, mini)
  marker.rotation.x = Math.PI / 2
  marker.position.set((record.x1 + record.x2) / 2, 2, (record.z1 + record.z2) / 2)
  marker.material = createMaterial('preview-marker', mini, 0.98, 0.36, 0.14)
  marker.isPickable = false

  return mini
}

async function renderOnce(record: ParcelRecord, embeds?: Record<string, string>, world?: PreviewWorld, type = 'image/webp'): Promise<ArrayBuffer> {
  stubWindow()
  if (!(globalThis as any).BABYLON) throw new Error('BABYLON missing')
  installEmbeds(embeds)

  const canvas = document.getElementById('c') as HTMLCanvasElement | null
  if (!canvas) throw new Error('no canvas')
  canvas.width = SIZE
  canvas.height = SIZE

  const engine = new BABYLON.Engine(canvas, true)
  const scene = new BABYLON.Scene(engine)
  scene.clearColor = OCEAN.clone()

  const camera = new BABYLON.ArcRotateCamera('preview', Math.PI / 4, Math.acos(1 / Math.sqrt(3)), 8, BABYLON.Vector3.Zero(), scene)
  camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA
  camera.minZ = 0.01

  // No features - constant time. Voxel bake only.
  const bare = { ...record, features: [] }
  makeOcean(scene, bare)
  makeIslands(scene, bare, world?.islands || [])
  makeLotOutlines(scene, bare, world?.lots || [])
  makeLabels(scene, bare)

  // Fresh mesher per render - static Grid.mesher is tied to a scene.
  ;(Grid as any).mesher = undefined
  window.scene = scene
  const grid = new NullGrid(scene)
  await grid.preparePreview()
  // environment.load() stomps clearColor to transparent.
  scene.clearColor = OCEAN.clone()
  if (scene.lights[0]) scene.lights[0].intensity = 0.5
  await getComputePool()
  await Grid.mesher.initialize()

  const parcel = grid.spawnPreview(bare)
  if (!parcel) throw new Error('spawnPreview failed')
  parcel.preview = true

  let mini: BABYLON.Scene | undefined
  try {
    await parcel.generate()
    await parcel.activate()
    await scene.whenReadyAsync()
    zoomCamera(camera, bare)
    // environment.load() and later hooks leave clearColor transparent -> white webp.
    scene.clearColor = new BABYLON.Color4(OCEAN.r, OCEAN.g, OCEAN.b, 1)
    if (world?.islands?.length) mini = makeMinimap(engine, bare, world.islands)
    // Twice so GUI DynamicTexture uploads before capture.
    scene.render()
    scene.render()
    mini?.render()
    const quality = type === 'image/png' ? 0.8 : 0.9
    return await blobFromCanvas(canvas, type, quality)
  } finally {
    if (!(window as any).__keepPreview) {
      try {
        parcel.unload()
      } catch {
        // ignore
      }
      try {
        mini?.dispose()
      } catch {
        // ignore
      }
      engine.dispose()
      ;(Grid as any).mesher = undefined
    }
  }
}

async function renderParcelPreview(record: ParcelRecord, embeds?: Record<string, string>, world?: PreviewWorld, type = 'image/webp'): Promise<string> {
  const bytes = await renderOnce(record, embeds, world, type)
  return bufToB64(bytes)
}

;(window as any).renderParcelPreview = renderParcelPreview
;(window as any).__parcelRenderReady = true
