// ABOUTME: Comlink worker that renders .vox files to 512 webp thumbs via OffscreenCanvas + Babylon.
// ABOUTME: Parallel fetch, serial GPU render, OPFS cache (memory fallback). No VoxImporter (window).

import * as Comlink from 'comlink'

// babylon via importScripts before anything touches BABYLON
require('./babylon')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadVox } = require('../../../src/monoworker/vox')

const mem = new Map<string, ArrayBuffer>()
const fetchCache = new Map<string, Promise<ArrayBuffer>>()
const pending = new Map<string, Promise<ArrayBuffer>>()

let engine: BABYLON.Engine | null = null
let scene: BABYLON.Scene | null = null
let camera: BABYLON.ArcRotateCamera | null = null
let canvas: OffscreenCanvas | HTMLCanvasElement | null = null
let chain: Promise<unknown> = Promise.resolve()
let opfsDir: FileSystemDirectoryHandle | null | undefined
let jobIndex = 1

function hashKey(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function parseBg(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return new BABYLON.Color4(1, 0, 0.667, 1)
  const n = parseInt(m[1], 16)
  return new BABYLON.Color4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1)
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => {},
    () => {},
  )
  return run
}

async function getOpfsDir() {
  if (opfsDir !== undefined) return opfsDir
  try {
    const storage = (globalThis as any).navigator?.storage
    if (!storage?.getDirectory) {
      opfsDir = null
      return null
    }
    const root = await storage.getDirectory()
    opfsDir = await root.getDirectoryHandle('vox-thumbs', { create: true })
    return opfsDir
  } catch {
    opfsDir = null
    return null
  }
}

async function readCache(key: string): Promise<ArrayBuffer | null> {
  const hit = mem.get(key)
  if (hit) return hit
  try {
    const dir = await getOpfsDir()
    if (!dir) return null
    const fh = await dir.getFileHandle(`${key}.webp`)
    const sync = (fh as any).createSyncAccessHandle?.()
    if (sync) {
      try {
        const size = sync.getSize()
        const buf = new ArrayBuffer(size)
        sync.read(new Uint8Array(buf), { at: 0 })
        mem.set(key, buf)
        return buf
      } finally {
        sync.close()
      }
    }
    const file = await fh.getFile()
    const buf = await file.arrayBuffer()
    mem.set(key, buf)
    return buf
  } catch {
    return null
  }
}

async function writeCache(key: string, bytes: ArrayBuffer) {
  mem.set(key, bytes)
  try {
    const dir = await getOpfsDir()
    if (!dir) return
    const fh = await dir.getFileHandle(`${key}.webp`, { create: true })
    const sync = (fh as any).createSyncAccessHandle?.()
    if (sync) {
      try {
        sync.write(new Uint8Array(bytes), { at: 0 })
        sync.truncate(bytes.byteLength)
        sync.flush()
      } finally {
        sync.close()
      }
      return
    }
    const writable = await (fh as any).createWritable()
    await writable.write(bytes)
    await writable.close()
  } catch {
    // disk optional
  }
}

function fetchVox(src: string) {
  let p = fetchCache.get(src)
  if (!p) {
    p = fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`vox fetch ${r.status}`)
        return r.arrayBuffer()
      })
      .catch((e) => {
        fetchCache.delete(src)
        throw e
      })
    fetchCache.set(src, p)
  }
  return p
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

function ensureScene(c: OffscreenCanvas | HTMLCanvasElement) {
  if (engine && scene && camera) return
  canvas = c
  engine = new BABYLON.Engine(c as any, true)
  scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color4(1, 0, 0.667, 1)
  camera = new BABYLON.ArcRotateCamera('thumb', Math.PI / 4, Math.acos(1 / Math.sqrt(3)), 8, BABYLON.Vector3.Zero(), scene)
  camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA
  camera.useAutoRotationBehavior = false
  camera.minZ = 0.01
  const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene)
  hemi.intensity = 1
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -1, 1), scene)
  sun.intensity = 1.2
  scene.ambientColor = new BABYLON.Color3(1, 1, 1)
}

async function blobFromCanvas(): Promise<ArrayBuffer> {
  if (!canvas) throw new Error('no canvas')
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

async function meshFromBuffer(buf: ArrayBuffer): Promise<BABYLON.Mesh> {
  if (!scene) throw new Error('no scene')
  const data = await loadVox({
    renderJob: jobIndex++,
    buffer: buf.slice(0),
    flipX: true,
    megavox: false,
    maxTriangles: 1_000_000,
    dryRun: false,
    wantCollider: false,
    timeoutMs: 10000,
  })
  if (data?.cancelled) throw new Error('vox cancelled')
  if (!data?.positions) throw new Error('vox parse failed')

  const mesh = new BABYLON.Mesh('thumb', scene)
  const vd = new BABYLON.VertexData()
  vd.positions = data.positions
  vd.indices = data.indices
  vd.colors = data.colors
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

async function renderBuffer(buf: ArrayBuffer, background: string): Promise<ArrayBuffer> {
  if (!engine || !scene || !camera) throw new Error('not inited')
  scene.clearColor = parseBg(background)
  let mesh: BABYLON.Mesh | undefined
  try {
    mesh = await meshFromBuffer(buf)
    zoomCamera(camera, scene)
    scene.render()
    return await blobFromCanvas()
  } finally {
    mesh?.dispose(false, true)
  }
}

function init(c: OffscreenCanvas | HTMLCanvasElement) {
  ensureScene(c)
}

function render(src: string, background: string): Promise<ArrayBuffer> {
  const key = hashKey(`${src}|${background}`)
  const existing = pending.get(key)
  if (existing) return existing

  const bufP = fetchVox(src)
  const p = (async () => {
    const hit = await readCache(key)
    if (hit) return hit
    return enqueue(async () => {
      const hit2 = await readCache(key)
      if (hit2) return hit2
      const buf = await bufP
      const bytes = await renderBuffer(buf, background)
      await writeCache(key, bytes)
      return bytes
    })
  })()

  pending.set(key, p)
  p.finally(() => pending.delete(key))
  return p
}

const api = {
  ping: () => true as const,
  init,
  render,
}

export type VoxelThumb = typeof api
export { api }

const WGS = (globalThis as any).WorkerGlobalScope
const inWorker = typeof WGS !== 'undefined' && typeof self !== 'undefined' && self instanceof WGS
if (inWorker) Comlink.expose(api)
