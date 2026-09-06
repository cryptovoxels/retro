// ABOUTME: Hand-rolled MagicaVoxel .vox parser. Replaces @sh-dave/format-vox on the hot path.

import type { ParsedVox, VoxPaletteColor, VoxVoxel } from './types'

const DEFAULT_PALETTE: number[] = [
  0, -1, -3342337, -6684673, -10027009, -13369345, -16711681, -13057, -3355393, -6697729, -10040065, -13382401, -16724737, -26113, -3368449, -6710785, -10053121, -13395457, -16737793, -39169, -3381505, -6723841, -10066177, -13408513,
  -16750849, -52225, -3394561, -6736897, -10079233, -13421569, -16763905, -65281, -3407617, -6749953, -10092289, -13434625, -16776961, -52, -3342388, -6684724, -10027060, -13369396, -16711732, -13108, -3355444, -6697780, -10040116,
  -13382452, -16724788, -26164, -3368500, -6710836, -10053172, -13395508, -16737844, -39220, -3381556, -6723892, -10066228, -13408564, -16750900, -52276, -3394612, -6736948, -10079284, -13421620, -16763956, -65332, -3407668, -6750004,
  -10092340, -13434676, -16777012, -103, -3342439, -6684775, -10027111, -13369447, -16711783, -13159, -3355495, -6697831, -10040167, -13382503, -16724839, -26215, -3368551, -6710887, -10053223, -13395559, -16737895, -39271, -3381607,
  -6723943, -10066279, -13408615, -16750951, -52327, -3394663, -6736999, -10079335, -13421671, -16764007, -65383, -3407719, -6750055, -10092391, -13434727, -16777063, -154, -3342490, -6684826, -10027162, -13369498, -16711834, -13210,
  -3355546, -6697882, -10040218, -13382554, -16724890, -26266, -3368602, -6710938, -10053274, -13395610, -16737946, -39322, -3381658, -6723994, -10066330, -13408666, -16751002, -52378, -3394714, -6737050, -10079386, -13421722, -16764058,
  -65434, -3407770, -6750106, -10092442, -13434778, -16777114, -205, -3342541, -6684877, -10027213, -13369549, -16711885, -13261, -3355597, -6697933, -10040269, -13382605, -16724941, -26317, -3368653, -6710989, -10053325, -13395661,
  -16737997, -39373, -3381709, -6724045, -10066381, -13408717, -16751053, -52429, -3394765, -6737101, -10079437, -13421773, -16764109, -65485, -3407821, -6750157, -10092493, -13434829, -16777165, -256, -3342592, -6684928, -10027264,
  -13369600, -16711936, -13312, -3355648, -6697984, -10040320, -13382656, -16724992, -26368, -3368704, -6711040, -10053376, -13395712, -16738048, -39424, -3381760, -6724096, -10066432, -13408768, -16751104, -52480, -3394816, -6737152,
  -10079488, -13421824, -16764160, -65536, -3407872, -6750208, -10092544, -13434880, -16776978, -16776995, -16777029, -16777046, -16777080, -16777097, -16777131, -16777148, -16777182, -16777199, -16716288, -16720640, -16729344, -16733696,
  -16742400, -16746752, -16755456, -16759808, -16768512, -16772864, -1179648, -2293760, -4521984, -5636096, -7864320, -8978432, -11206656, -12320768, -14548992, -15663104, -1118482, -2236963, -4473925, -5592406, -7829368, -8947849,
  -11184811, -12303292, -14540254, -15658735,
]

function colorFromInt(c: number): VoxPaletteColor {
  return { r: c & 255, g: (c >> 8) & 255, b: (c >> 16) & 255, a: (c >> 24) & 255 }
}

function defaultPalette(): VoxPaletteColor[] {
  return DEFAULT_PALETTE.map(colorFromInt)
}

function readString(view: DataView, off: { v: number }, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off.v++))
  return s
}

function readChunk(view: DataView, off: { v: number }, vox: ParsedVox, state: { modelIndex: number; sizeIndex: number }) {
  const id = readString(view, off, 4)
  const contentSize = view.getInt32(off.v, true)
  off.v += 4
  const childrenSize = view.getInt32(off.v, true)
  off.v += 4
  const contentEnd = off.v + contentSize
  const childrenEnd = contentEnd + childrenSize

  switch (id) {
    case 'SIZE':
      vox.sizes[state.sizeIndex++] = {
        x: view.getInt32(off.v, true),
        y: view.getInt32(off.v + 4, true),
        z: view.getInt32(off.v + 8, true),
      }
      break
    case 'XYZI': {
      const n = view.getInt32(off.v, true)
      const model: VoxVoxel[] = []
      let p = off.v + 4
      for (let i = 0; i < n; i++) {
        model.push({
          x: view.getUint8(p),
          y: view.getUint8(p + 1),
          z: view.getUint8(p + 2),
          colorIndex: view.getUint8(p + 3),
        })
        p += 4
      }
      vox.models[state.modelIndex++] = model
      break
    }
    case 'RGBA': {
      const palette = defaultPalette()
      for (let i = 0; i < 255; i++) palette[i + 1] = colorFromInt(view.getInt32(off.v + i * 4, true))
      palette[0] = colorFromInt(view.getInt32(off.v + 255 * 4, true))
      vox.palette = palette
      break
    }
    default:
      break
  }

  off.v = contentEnd
  while (off.v < childrenEnd) readChunk(view, off, vox, state)
  off.v = childrenEnd
}

export function parseVox(buffer: ArrayBuffer): ParsedVox {
  const view = new DataView(buffer)
  const off = { v: 0 }
  if (readString(view, off, 4) !== 'VOX ') throw new Error('Expected VOX header')
  const version = view.getInt32(off.v, true)
  off.v += 4
  if (version !== 150 && version !== 200) throw new Error(`Unsupported vox version ${version}`)

  const vox: ParsedVox = { sizes: [], models: [], palette: defaultPalette() }
  readChunk(view, off, vox, { modelIndex: 0, sizeIndex: 0 })
  if (!vox.models[0]?.length) throw new Error('No vox model')
  return vox
}

/** Upload validation - dimensions only */
export function voxMeta(buffer: ArrayBuffer): { megavox: boolean; sizeX: number; sizeY: number; sizeZ: number } {
  const vox = parseVox(buffer)
  const size = vox.sizes[0]
  return {
    megavox: Math.max(size.x, size.y, size.z) > 32,
    sizeX: size.x,
    sizeY: size.y,
    sizeZ: size.z,
  }
}
