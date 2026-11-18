import ndarray from 'ndarray'
import { getBufferFromVoxels, getFieldShape, getVoxelsFromBuffer } from './helpers'

export function commonsFeatures(base: any, commons: any) {
  const features = Array.isArray(base?.features) ? base.features : undefined
  if (!commons?.features?.length) return features
  const ids = new Set(features?.map((f: any) => f?.uuid))
  return (features || []).concat(commons.features.filter((f: any) => f && !ids.has(f.uuid)))
}

export function commonsBuild(row: any) {
  const base = row.content
  const layer = row.commons
  if (!row.is_common || !layer) return base

  const content = { ...base, features: commonsFeatures(base, layer) }
  if (!layer.voxels) return content
  if (!base?.voxels) return { ...content, voxels: layer.voxels }

  const fieldShape = getFieldShape(row)
  const field = getBufferFromVoxels({ fieldShape, voxels: base.voxels })!
  const additions = getBufferFromVoxels({ fieldShape, voxels: layer.voxels })!
  for (let i = 0; i < field.data.length; i++) field.data[i] ||= additions.data[i]!
  content.voxels = getVoxelsFromBuffer(field.data.buffer)
  return content
}

export function patchCommons(row: any, patch: any) {
  if (!patch || !Object.keys(patch).length || Object.keys(patch).some((key) => key !== 'features' && key !== 'voxels')) throw new Error('The base build settings are locked')
  const layer = { ...row.commons }
  if (patch.features) {
    const base = new Set(row.content?.features?.map((f: any) => f?.uuid))
    const features = new Map<string, any>((layer.features || []).map((f: any) => [f.uuid, f]))
    for (const [uuid, value] of Object.entries<any>(patch.features)) {
      if (base.has(uuid)) throw new Error('This feature belongs to the base build')
      if (!value) features.delete(uuid)
      else {
        if (!features.has(uuid) && !value.type) throw new Error('Unknown commons feature')
        value.uuid = uuid
        delete value.children
        features.set(uuid, { ...features.get(uuid), ...value })
      }
    }
    layer.features = [...features.values()]
  }
  if ('voxels' in patch) {
    const { positions, value } = patch.voxels || {}
    if (!Array.isArray(positions) || !Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Edit individual commons voxels')
    const fieldShape = getFieldShape(row)
    const base = getBufferFromVoxels({ fieldShape, voxels: row.content?.voxels })
    const field = getBufferFromVoxels({ fieldShape, voxels: layer.voxels }) || ndarray(new Uint16Array(fieldShape[0] * fieldShape[1] * fieldShape[2]), fieldShape)
    for (const pos of positions) {
      if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((v, i) => Number.isInteger(v) && v >= 0 && v < fieldShape[i]!)) throw new Error('Outside the common parcel')
      const [x, y, z] = pos
      if (base?.get(x, y, z)) throw new Error('This voxel belongs to the base build')
      field.set(x, y, z, value)
    }
    layer.voxels = getVoxelsFromBuffer(field.data.buffer)
  }
  return layer
}
