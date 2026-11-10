import pack from './texas-thrift.json'

export function thriftModel(index: number, position: number[], size: number) {
  const model = pack.models[index % pack.models.length]
  return { type: 'vox-model', url: model.url, position, scale: [size, size, size], rotation: [0, 0, 0] }
}
