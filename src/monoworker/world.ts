import { RBush3D } from 'rbush-3d'
import type { CachedParcelsMessage, ApiParcelMessage } from '../../common/messages/api-parcels'
import { packIds } from '../../common/helpers/bloom'
import { getBufferFromVoxels, getFieldShape } from '../../common/voxels/helpers'

export type Lot = Pick<CachedParcelsMessage['parcels'][number], 'id' | 'hash' | 'x1' | 'x2' | 'y1' | 'y2' | 'z1' | 'z2'>
const index = new RBush3D(10)
const lots = new Map<number, Lot>()
let ready: Promise<void> | undefined

export function loadIndex(): Promise<void> {
  return (ready ??= (async () => {
    const response = await fetch(process.env.ASSET_PATH + '/api/parcels/cached.json')
    if (!response.ok) throw new Error('Parcel index unavailable')
    const data: CachedParcelsMessage = await response.json()
    index.clear()
    lots.clear()
    index.load(
      data.parcels.map((p) => {
        lots.set(p.id, p)
        return { minX: p.x1, minY: p.y1, minZ: p.z1, maxX: p.x2, maxY: p.y2, maxZ: p.z2, id: p.id }
      }),
    )
  })().catch((error) => {
    ready = undefined
    throw error
  }))
}

export async function nearbyLots(position: number[], radius: number): Promise<Lot[]> {
  await loadIndex()
  const [x, y, z] = position
  return index.search({ minX: x - radius, minY: y - radius, minZ: z - radius, maxX: x + radius, maxY: y + radius, maxZ: z + radius }).map((box: any) => lots.get(box.id)!)
}

// The caller owns residency. This worker only fetches and decodes the requested batch.
export async function fetchLots(ids: number[], signal: AbortSignal) {
  await loadIndex()
  if (signal.aborted) return []
  let records: ApiParcelMessage['parcel'][] = []
  try {
    const pack = packIds(ids.map((id) => `${id}:${lots.get(id)?.hash}`))
    const response = await fetch(new URL(`/grid/parcels/${pack}.pack`, self.location.origin), { signal })
    if (response.ok) records = (await response.json()).parcels || []
  } catch (error) {
    if (signal.aborted) return []
  }
  const result = []
  for (const id of ids) {
    if (signal.aborted) break
    try {
      let record = records.find((p) => p.id === id)
      if (!record) {
        const response = await fetch(new URL(`/grid/parcels/${id}`, self.location.origin), { signal })
        if (!response.ok) continue
        const data: ApiParcelMessage = await response.json()
        if (!data.success) continue
        record = data.parcel
      }
      let field: ReturnType<typeof getBufferFromVoxels>
      try {
        field = getBufferFromVoxels({ ...record, fieldShape: getFieldShape(record) })
      } catch {
        // A broken voxel field must not prevent the parcel's features from loading.
      }
      result.push({ record: { ...lots.get(id), ...record } as any, field })
    } catch (error) {
      if (!signal.aborted) console.warn(`Parcel ${id} could not load`, error)
    }
  }
  return result
}
