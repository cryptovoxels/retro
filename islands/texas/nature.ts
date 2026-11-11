import type { Idling, VoxModelRecord } from '../../common/messages/feature'
import sizes from './rock-sizes.json'
import pack from './artpack.json'

const plants: Record<string, Idling> = {
  buttonbush: 'bush',
  'wax-myrtle': 'bush',
  'texas-sage': 'bush',
  'river-willow': 'tree',
  'bald-cypress': 'tree',
  'live-oak': 'tree',
  'honey-mesquite': 'tree',
  'texas-redbud': 'tree',
  'gulf-muhly': 'grass',
  bluebonnet: 'grass',
  'indian-paintbrush': 'grass',
  'red-yucca': 'grass',
  lechuguilla: 'grass',
}

export function plantWind(name: string) {
  return plants[name]
}

// Place by footprint centre and bottom, accounting for the VOX importer's mirrored pivot.
export function rockProp(name: string, x: number, y: number, z: number, yaw: number, size: number, tread?: [number, number, number]): VoxModelRecord {
  const [w, d, h] = sizes[name as keyof typeof sizes]
  const scale: [number, number, number] = tread ? [(50 * tread[0]) / w, (50 * tread[1]) / h, (50 * tread[2]) / d] : [size * 4, size * 4, size * 4]
  const dx = (4 + (w % 2) * 0.5) * 0.02 * scale[0],
    dz = -(d % 2) * 0.01 * scale[2]
  return { type: 'vox-model', url: pack.frames.path + name + '.vox', scale, rotation: [0, yaw, 0], ...(tread && { collidable: true }), position: [x - dx * Math.cos(yaw) - dz * Math.sin(yaw), y, z + dx * Math.sin(yaw) - dz * Math.cos(yaw)] }
}
