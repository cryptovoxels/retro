import { rockProp, plantWind } from '../nature'
import { v7 as uuid } from 'uuid'
import { seeded } from '../../../common/helpers/utils'
import type ParcelBuilder from '../../../server/parcel-builder'
import { Animations } from '../../../src/avatar-animations'
import pack from '../artpack.json'

export function camp(b: ParcelBuilder, face: string, index: number) {
  const w = b.width,
    d = b.depth
  const north = face === 'n'
  const rand = seeded(index + b.parcel.x1 * 217 + b.parcel.z1)
  const features: any[] = []
  function prop(name: string, x: number, z: number, scale: [number, number, number], yaw = 0, seat = false) {
    const pivot = 0.08 * scale[0]
    features.push({
      uuid: uuid(),
      type: 'vox-model',
      ...(plantWind(name) && { animation: plantWind(name) }),
      ...(seat && { pose: { animation: Animations.Sitting, offset: [pivot, 0.18 * scale[1], 0] } }),
      url: pack.frames.path + name + '.vox',
      position: [0.25 + x - pivot * Math.cos(yaw), 0.75, 0.25 + z + pivot * Math.sin(yaw)],
      rotation: [0, yaw, 0],
      scale,
    })
  }
  const sign = north ? 1 : -1
  const z = sign * d * 0.085
  if (w >= 6) {
    prop(pack.camp.fire, 0, z, [2.4, 2.4, 2.4])
    for (const dir of [-1, 1]) prop(pack.camp.seat, dir * 1.3, z, [2.8, 2.6, 2.8], (-dir * Math.PI) / 2, true)
  }
  prop(pack.camp.lights, 0, sign * d * 0.18, [Math.min(7, (w / 2 - 0.6) / 0.64), 5, 3])
  for (let i = 0; i < 6; i++) {
    const species = (Math.abs(index) + i * 7) % pack.flora.length
    const scale = species >= 2 && species <= 6 ? 3.7 : 1.6 + rand() * 0.6
    prop(pack.flora[species], (i % 2 ? 1 : -1) * (w / 4 - 0.85), sign * (d * (0.01 + Math.floor(i / 2) * 0.075)), [scale, scale, scale], rand() * Math.PI * 2)
  }
  for (let i = 0; i < 8; i++) {
    const size = 0.8 + rand() * 1.4
    features.push({ uuid: uuid(), ...rockProp(pack.rocks[10 + Math.floor(rand() * 10)], 0.25 + (rand() - 0.5) * (w / 2 - 2), 0.75, 0.25 - sign * d * (0.06 + rand() * 0.15), rand() * 6, size) })
  }
  return { ...b.serialize, features, building: 'campfire commons' }
}
