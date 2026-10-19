import { describe, expect, test } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { voxReader, VoxData } from '../common/vox-import/vox-reader'
import { packVoxelbr, unpackVoxelbr } from '../common/vox-import/voxelbr'

function read(file: string, flipX = true, megavox = false) {
  return new Promise<VoxData>((resolve, reject) => {
    voxReader(fs.readFileSync(path.join(__dirname, 'fixtures', file)), flipX, megavox, (res) => (res instanceof Error ? reject(res) : resolve(res)))
  })
}

function bounds(a: ArrayLike<number>, pad = 0) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < a.length; i++) {
    min[i % 3] = Math.min(min[i % 3], a[i])
    max[i % 3] = Math.max(max[i % 3], a[i] + pad)
  }
  return [min, max]
}

const cases: [string, boolean, number, number, number[]][] = [
  ['single_voxel.vox', false, 8, 36, [3, 3, 3]],
  ['2_voxels_same_mat.vox', false, 8, 36, [3, 3, 3]],
  ['2_voxels_diff_mats.vox', false, 16, 60, [3, 3, 3]],
  ['green_cube.vox', false, 74, 180, [32, 32, 32]],
  ['mega.vox', true, 34199, 135438, [126, 126, 126]],
  ['menger.vox', true, 321302, 1601640, [81, 81, 81]],
]

describe('vox reader', () => {
  test.each(cases)('%s meshes', async (file, megavox, verts, indices, size) => {
    const res = await read(file, true, megavox)
    expect(res.positions).toBeInstanceOf(Int8Array)
    expect(res.colors).toBeInstanceOf(Uint8Array)
    expect(res.positions.length / 3).toBe(verts)
    expect(res.colors.length / 4).toBe(verts)
    expect(res.indices.length).toBe(indices)
    expect(res.indices).toBeInstanceOf(verts < 65536 ? Uint16Array : Uint32Array)
    expect(res.size).toEqual(size)
  })

  // the rapier grid must sit exactly under the mesh, in both mirror modes
  test.each([
    ['single_voxel.vox', false, 1],
    ['green_cube.vox', false, 32768],
    ['menger.vox', true, 160000],
  ])('%s voxel grid covers the mesh', async (file, megavox, count) => {
    for (const flipX of [true, false]) {
      const res = await read(file, flipX, megavox)
      expect(res.voxels.length / 3).toBe(count)
      expect(bounds(res.voxels, 1)).toEqual(bounds(res.positions))
    }
  })

  test('voxelbr round trips the grid', async () => {
    const res = await read('green_cube.vox')
    const out = unpackVoxelbr(packVoxelbr(res).buffer as ArrayBuffer)
    expect(Array.from(out.voxels!)).toEqual(Array.from(res.voxels))
    expect(Array.from(out.indices)).toEqual(Array.from(res.indices))
    expect(Array.from(out.positions)).toEqual(Array.from(res.positions))
  })

  test('voxelbr without a grid still unpacks', async () => {
    const res = await read('single_voxel.vox')
    const packed = packVoxelbr(res)
    const old = packed.buffer.slice(0, packed.byteLength - 4 - res.voxels.byteLength) as ArrayBuffer
    const out = unpackVoxelbr(old)
    expect(out.voxels).toBeUndefined()
    expect(out.indices.length).toBe(res.indices.length)
  })
})
