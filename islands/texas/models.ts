import pack from './artpack.json'

export function thriftModel(index: number, position: number[], size: number) {
  const model = pack.models[index % pack.models.length]
  return { type: 'vox-model', url: model.url, position, scale: [size, size, size], rotation: [0, 0, 0] }
}

const extents = new Map(pack.models.map((m) => [m.url, m.extent]))
export function modelExtent(url: string) {
  return extents.get(url) || 32
}
