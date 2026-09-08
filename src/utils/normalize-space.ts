import type { ParcelRecord } from '../../common/messages/parcel'
import type { SpaceRecord } from '../../common/messages/space'

export type MountDesc = Omit<ParcelRecord, 'id'> & { id: number | string }

export function normalizeSpace(space: SpaceRecord): MountDesc {
  const desc: any = { ...space }
  if (desc.content) Object.assign(desc, desc.content)
  desc.id = space.id
  desc.x1 = -desc.width / 2
  desc.x2 = desc.width / 2
  desc.z1 = -desc.depth / 2
  desc.z2 = desc.depth / 2
  desc.island = ''
  desc.suburb = 'The void'
  desc.address = 'Nowhere near'
  desc.visible = true
  desc.kind = desc.kind || 'plot'
  desc.owner = desc.owner || ''
  desc.geometry = desc.geometry || {
    type: 'Polygon',
    crs: { type: 'name', properties: { name: 'EPSG:0' } },
    coordinates: [[[0, 0]]],
  }
  return desc as MountDesc
}
