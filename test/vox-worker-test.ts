import test from 'tape'
import { meshVoxBuffer } from '../src/monoworker/mesh'
import * as path from 'path'
import * as fs from 'fs'

require('babylonjs-loaders')
require('babylonjs-materials')

function mesh(buffer: Buffer, megavox: boolean) {
  return meshVoxBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), {
    flipX: false,
    megavox,
    wantCollider: false,
  })
}

function assertMeshBuf(t: test.Test, res: ReturnType<typeof meshVoxBuffer>) {
  const n = res.pos.length / 3
  let max = 0
  for (let i = 0; i < res.idx.length; i++) max = Math.max(max, res.idx[i])
  t.ok(max < n, 'indices fit pos buffer')
  t.equals(res.rgb.length / 3, n, 'rgb matches pos')
}

test('loading vox with one voxel', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'single_voxel.vox'))
  const res = mesh(buffer, false)

  t.equals(res.pos.length / 3, 11, 'vertices len matches')
  t.equals(res.idx.length, 36, 'indices len matches')
  t.equals(res.idx instanceof Uint16Array || res.idx instanceof Uint32Array, true, 'indices are typed array')
  t.equals(res.rgb.length / 3, 11, 'colors len matches')
  t.ok(res.rgb[0] > 0 || res.rgb[1] > 0 || res.rgb[2] > 0, 'vertex colors non-zero')
  t.equals(res.meta.scale, 0.02, 'vox scale')
  assertMeshBuf(t, res)
  t.same(res.size, [3, 3, 3], 'size matches')
  t.end()
})

test('loading 2_voxels_same_mat.vox', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', '2_voxels_same_mat.vox'))
  const res = mesh(buffer, false)

  t.equals(res.pos.length / 3, 17, 'vertices len matches')
  t.equals(res.idx.length, 60, 'indices len matches')
  t.equals(res.rgb.length / 3, 17, 'colors len matches')
  assertMeshBuf(t, res)
  t.same(res.size, [3, 3, 3], 'size matches')
  t.end()
})

test('loading 2_voxels_diff_mats.vox', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', '2_voxels_diff_mats.vox'))
  const res = mesh(buffer, false)

  t.equals(res.pos.length / 3, 23, 'vertices len matches')
  t.equals(res.idx.length, 60, 'indices len matches')
  t.equals(res.rgb.length / 3, 23, 'colors len matches')
  assertMeshBuf(t, res)
  t.same(res.size, [3, 3, 3], 'size matches')
  t.end()
})

test('loading small vox', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'green_cube.vox'))
  const res = mesh(buffer, false)

  t.ok(res.pos.length / 3 > 0, 'has vertices')
  t.ok(res.idx.length > 0, 'has indices')
  t.equals(res.rgb.length / 3, res.pos.length / 3, 'colors match verts')
  t.ok(res.rgb[0] > 0 || res.rgb[1] > 0 || res.rgb[2] > 0, 'vertex colors non-zero')
  assertMeshBuf(t, res)
  t.same(res.size, [32, 32, 32], 'size matches 32x32x32')
  t.end()
})

test('loading mega vox', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'mega.vox'))
  const res = mesh(buffer, true)

  t.ok(res.pos.length / 3 > 0, 'has vertices')
  t.ok(res.idx.length > 0, 'has indices')
  t.equals(res.rgb.length / 3, res.pos.length / 3, 'colors match verts')
  assertMeshBuf(t, res)
  t.same(res.size, [126, 126, 126], 'size matches 126x126x126')
  t.end()
})

test('loading menger vox', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'menger.vox'))
  const res = mesh(buffer, true)

  t.ok(res.pos.length / 3 > 0, 'has vertices')
  t.ok(res.idx.length > 0, 'has indices')
  t.equals(res.idx instanceof Uint32Array, true, 'indices are Uint32Array')
  t.equals(res.rgb.length / 3, res.pos.length / 3, 'colors match verts')
  assertMeshBuf(t, res)
  t.same(res.size, [81, 81, 81], 'size matches')
  t.end()
})
