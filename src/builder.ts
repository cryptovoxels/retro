import cachedFetch from '../web/src/helpers/cached-fetch'
import ndarray from 'ndarray'
import { blocks, getBlockId } from '../common/content/blocks'
import { robotFov, isSkynet, wantsRoboshot } from '../common/helpers/detector'
import { tilesetRuntimeUrl } from '../common/helpers/parcel-compile'
import { contentName } from '../common/helpers/ugc-upload-keys'
import { uploadParcelBytes } from '../common/helpers/upload-media'
import type Parcel from './parcel'

type Point = [number, number, number]
let writing = false

function editable(id: number): Parcel | undefined {
  const parcel = window.grid?.getByID(id)
  if (parcel?.loaded && parcel.canEdit && (parcel.sandbox || window.grid?.isOpen)) return parcel
}

function inside(point: Point, shape: number[]) {
  return point.length === 3 && point.every((v, i) => Number.isInteger(v) && v >= 0 && v < shape[i])
}

async function paint(parcel: Parcel, points: Iterable<Point>, value: number) {
  if (writing) return { error: 'Build in progress. Await each write.' }
  if (!Number.isInteger(value) || value < 0 || value > 65535) return { error: 'Expected a uint16 block value.' }
  writing = true
  let count = 0
  try {
    if (!parcel.field) parcel.field = ndarray(new Uint16Array(parcel.fieldShape.reduce((a, b) => a * b, 1)), parcel.fieldShape)
    let batch: Point[] = []
    for (const point of points) {
      batch.push(point)
      count++
      if (batch.length === 2048) {
        if (!editable(parcel.id as number)) return { error: 'Parcel disconnected or edit permission lost.', count: count - batch.length }
        parcel.set(batch, value)
        // Parcel.set sends after 5ms. Another call before then drops its patch.
        await new Promise((resolve) => setTimeout(resolve, 10))
        batch = []
      }
    }
    if (batch.length) {
      if (!editable(parcel.id as number)) return { error: 'Parcel disconnected or edit permission lost.', count: count - batch.length }
      parcel.set(batch, value)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    // Let the trailing mesh refresh start, then await the newest generation.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await parcel.generateVoxelField()
    return { submitted: count, sandbox: parcel.sandbox }
  } catch (e: any) {
    return { error: e.message, submitted: count }
  } finally {
    writing = false
  }
}

const builder = {
  blocks,
  block: getBlockId,
  parcels() {
    return [...(window.grid?.parcels.values() || [])].map((p) => ({
      id: p.id,
      name: p.name,
      loaded: p.loaded,
      canEdit: p.canEdit,
      sandbox: p.sandbox,
      shape: p.fieldShape,
      bounds: [p.boundingBox.minimumWorld.asArray(), p.boundingBox.maximumWorld.asArray()],
      tileset: p.tileset,
      palette: p.palette,
    }))
  },
  read(id: number, points: Point[]) {
    const p = window.grid?.getByID(id)
    if (!p?.loaded) return { error: 'Parcel is not loaded.' }
    return points.map((v) => (inside(v, p.fieldShape) ? (p.field?.get(...v) ?? 0) : null))
  },
  async set(id: number, points: Point[], value: number) {
    const p = editable(id)
    if (!p) return { error: 'Load an editable parcel and connect first.' }
    if (points.some((v) => !inside(v, p.fieldShape))) return { error: 'Voxel coordinates outside field.' }
    return paint(p, points, value)
  },
  async fill(id: number, from: Point, to: Point, value: number) {
    const p = editable(id)
    if (!p) return { error: 'Load an editable parcel and connect first.' }
    if (!inside(from, p.fieldShape) || !inside(to, p.fieldShape) || from.some((v, i) => v > to[i])) return { error: 'Expected ordered, inclusive field bounds.' }
    function* points(): Generator<Point> {
      for (let x = from[0]; x <= to[0]; x++) for (let y = from[1]; y <= to[1]; y++) for (let z = from[2]; z <= to[2]; z++) yield [x, y, z]
    }
    return paint(p, points(), value)
  },
  tileset(id: number, url: string) {
    const p = editable(id)
    if (!p) return { error: 'Load an editable parcel and connect first.' }
    p.setTileset(url)
    return { submitted: true }
  },
  async upload(id: number, file: File) {
    if (!editable(id)) return { error: 'Load an editable parcel and connect first.' }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const name = (await contentName(bytes)) + '.' + file.name.split('.').pop()
      return await uploadParcelBytes(id, name, bytes, file.type || 'application/octet-stream')
    } catch (e: any) {
      return { error: e.message }
    }
  },
  async atlas(id: number) {
    const p = window.grid?.getByID(id)
    if (!p?.loaded) return { error: 'Parcel is not loaded.' }
    try {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = p.tileset ? tilesetRuntimeUrl(p.tileset) : '/textures/atlas-ao.png'
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1024
      canvas.getContext('2d')!.drawImage(image, 0, 0, 1024, 1024)
      return canvas
    } catch (e: any) {
      return { error: e.message }
    }
  },
  tile(canvas: HTMLCanvasElement, index: number, image: CanvasImageSource) {
    if (!Number.isInteger(index) || index < 0 || index > 15) return { error: 'Tile index must be 0-15.' }
    const ctx = canvas.getContext('2d')
    if (!ctx) return { error: 'Canvas unavailable.' }
    const slot = (index + 1) % 16
    const x = (slot % 4) * 256
    const y = Math.floor(slot / 4) * 256
    ctx.clearRect(x, y, 256, 256)
    for (let i = 16; i > 0; i--) ctx.drawImage(image, x + 64 - i, y + 64 - i, 128 + i * 2, 128 + i * 2)
    return { updated: index }
  },
  async search(query: string, page = 0) {
    const params = new URLSearchParams({ q: query, page: String(page), limit: '20', sort: 'views', asc: 'false' })
    try {
      const response = await cachedFetch(`/api/library/all.json?${params}`)
      return await response.json()
    } catch (e: any) {
      return { error: e.message }
    }
  },
}

declare global {
  interface Window {
    builder: typeof builder
  }
}

export function installBuilder() {
  if (!isSkynet() && !wantsRoboshot()) return
  window.builder = builder
  if (isSkynet() && window.scene) window.scene.audioEnabled = false
  if ((isSkynet() || wantsRoboshot()) && window.scene?.activeCamera) window.scene.activeCamera.fov = robotFov()
}
