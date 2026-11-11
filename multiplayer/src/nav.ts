import { inflateSync } from 'node:zlib'
import type { ConnectionHandle } from './common/pq'
import { groundOffset, snapRing } from '../../src/utils/polygon-utils'
import { islandLayout } from '../../src/monoworker/island'
import ParcelBuilder, { ground as floor } from '../../server/parcel-builder'

type Parcel = { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; voxels?: string }

// x/z are the south-west corner in world metres. C clips each input to this region.
export function buildNav(core: any, x: number, z: number, ground: Buffer | null, parcels: Parcel[], island?: any) {
  let bottom = -2,
    top = 16
  for (const p of parcels) {
    bottom = Math.min(bottom, p.y1 * 2)
    top = Math.max(top, p.y2 * 2)
  }
  if (!core._region(x * 2, bottom, z * 2, top - bottom)) throw Error('invalid nav region')
  function stamp(
    bytes: Buffer,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    terrain: boolean,
    scale = 1,
  ) {
    if (bytes.length !== w * h * d * (terrain ? 1 : 2)) return
    const ptr = core._malloc(bytes.length)
    if (!ptr) throw Error('nav input too large')
    try {
      core.HEAPU8.set(bytes, ptr)
      core._stamp(ptr, x, y, z, w, h, d, Number(terrain), scale)
    } finally {
      core._free(ptr)
    }
  }
  if (ground && ground.length >= 16) {
    const w = ground.readInt32LE(8),
      d = ground.readInt32LE(12)
    const h = (ground.length - 16) / (w * d)
    if (w > 0 && d > 0 && [1, 8, 16].includes(h)) {
      const scale = h === 1 ? 2 : 1
      const gx = ground.readInt32LE(0) * 2,
        gz = ground.readInt32LE(4) * 2
      const left = Math.max(0, (2 * x - gx) / scale),
        back = Math.max(0, (2 * z - gz) / scale)
      const width = Math.min(w, (2 * x + 64 - gx) / scale) - left,
        depth = Math.min(d, (2 * z + 64 - gz) / scale) - back
      if (width > 0 && depth > 0) {
        const tile = Buffer.allocUnsafe(width * depth * h)
        for (let iy = 0; iy < h; iy++)
          for (let iz = 0; iz < depth; iz++) {
            const start = 16 + (iy * d + iz + back) * w + left
            ground.copy(tile, (iy * depth + iz) * width, start, start + width)
          }
        stamp(tile, gx + left * scale, h === 1 ? 0 : -2, gz + back * scale, width, h, depth, true, scale)
      }
    }
  }
  if (!ground && island?.geometry_json) {
    function shore(ring: number[][], land: boolean) {
      const points = Float32Array.from(snapRing(ring, groundOffset(island.texture)).flatMap((p) => [p.x, p.z]))
      if (!points.length) return
      const ptr = core._malloc(points.byteLength)
      if (!ptr) throw Error('shoreline too large')
      try {
        core.HEAPF32.set(points, ptr / 4)
        core._shoreline(ptr, points.length / 2, Number(land))
      } finally {
        core._free(ptr)
      }
    }
    const rings = island.geometry_json.coordinates
    if (rings.length) {
      shore(rings[0], true)
      for (const polygon of island.lakes_geometry_json?.coordinates ?? []) shore(polygon[0], false)
      if (['Scarcity', 'Flora', 'Andromeda'].includes(island.name))
        for (const polygon of island.holes_geometry_json?.coordinates ?? []) shore(polygon[0], false)
      if (island.id >= 40) for (const ring of rings.slice(1)) shore(ring, true)
    }
  }
  for (const p of parcels) {
    if (!p.voxels) continue
    const w = (p.x2 - p.x1) * 2,
      h = (p.y2 - p.y1) * 2,
      d = (p.z2 - p.z1) * 2
    if (w <= 0 || h <= 0 || d <= 0) continue
    let bytes: Buffer
    try {
      bytes = inflateSync(Buffer.from(p.voxels, 'base64'), { maxOutputLength: w * h * d * 2 })
    } catch {
      continue
    }
    stamp(bytes, p.x1 * 2, p.y1 * 2, p.z1 * 2, w, h, d, false)
  }
  core._surfaces()
}

export async function loadNav(db: ConnectionHandle, core: any, island: string, x: number, z: number) {
  if (island.startsWith('draft:')) {
    const {
      rows: [draft],
    } = await db.query('sim-draft', 'select settings, ground from island_drafts where slug=$1', [island.slice(6)])
    if (!draft) return false
    const s = draft.settings
    const { parcels } = islandLayout({
      ...s,
      streets: s.streets
        .split('\n')
        .map((v: string) => v.trim())
        .filter(Boolean),
    })
    const nearby: Parcel[] = []
    parcels.forEach((p, i) => {
      const dx = Math.round(s.center[0] * 100),
        dz = Math.round(s.center[1] * 100)
      const shape = { ...p, x1: p.x1 + dx, x2: p.x2 + dx, z1: p.z1 + dz, z2: p.z2 + dz, height: p.y2 - p.y1 }
      if (shape.x1 >= x + 32 || shape.x2 <= x || shape.z1 >= z + 32 || shape.z2 <= z) return
      const house = ParcelBuilder.Village(shape, p.material ?? floor, p.door, s.artpack === 'texas-thrift', i)
      nearby.push({ ...shape, voxels: house.voxels })
    })
    buildNav(core, x, z, draft.ground, nearby)
  } else {
    const {
      rows: [terrain],
    } = await db.query(
      'sim-ground',
      'select id,name,texture,ground,geometry_json,lakes_geometry_json,holes_geometry_json from islands where lower(name)=lower($1)',
      [island],
    )
    const { rows } = await db.query<Parcel>(
      'sim-parcels',
      `select x1,y1,z1,x2,y2,z2,content->>'voxels' as voxels from properties
       where lower(island)=lower($1) and (visible or minted) and x1<$2+32 and x2>$2 and z1<$3+32 and z2>$3`,
      [island, x, z],
    )
    buildNav(core, x, z, terrain?.ground, rows, terrain)
  }
  return true
}
