import * as test from 'tape'
import { voxReader } from '../common/vox-import/vox-reader'
import * as path from 'path'
import * as fs from 'fs'

require('babylonjs-loaders')
require('babylonjs-materials')

test('loading vox with one voxel', (t) => {
  const renderJob = 1
  const flipX = false //opt
  const megavox = false //opt

  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'single_voxel.vox'))

  voxReader(buffer, renderJob, flipX, megavox, false, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }

    t.equals(res.positions.length / 3, 8, 'vertices len matches')
    t.equals(res.indices.length, 36, 'indices len matches') // 6 faces * 2 tris/face * 3 indices/tri
    t.equals(res.indices instanceof Uint16Array, true, 'indices are Uint16Array')
    t.equals(res.colors.length / 4, 8, 'colors len matches')
    t.same(res.size, [3, 3, 3], 'size matches 32x32x32')
    t.end()
  })
})

test('loading 2_voxels_same_mat.vox', (t) => {
  const renderJob = 1
  const flipX = false //opt
  const megavox = false //opt

  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', '2_voxels_same_mat.vox'))

  voxReader(buffer, renderJob, flipX, megavox, false, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }

    // This should result in the same amount of data as single_voxel.vox, due to greedy meshing.
    // Each of the 6 faces should have its own 4 verts currently.
    t.equals(res.positions.length / 3, 8, 'vertices len matches')
    t.equals(res.indices.length, 36, 'indices len matches') // 6 faces * 2 tris/face * 3 indices/tri
    t.equals(res.indices instanceof Uint16Array, true, 'indices are Uint16Array')
    t.equals(res.colors.length / 4, 8, 'colors len matches')
    t.same(res.size, [3, 3, 3], 'size matches 32x32x32')
    t.end()
  })
})

// Test a vox model with 2 adjacent voxels, but with different materials.
test('loading 2_voxels_same_mat.vox', (t) => {
  const renderJob = 1
  const flipX = false //opt
  const megavox = false //opt

  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', '2_voxels_diff_mats.vox'))

  voxReader(buffer, renderJob, flipX, megavox, false, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }

    t.equals(res.positions.length / 3, 16, 'vertices len matches')
    t.equals(res.indices.length, 60, 'indices len matches') // 2 voxels * 5 faces/voxel * 2 tris/face * 3 indices/tri
    t.equals(res.indices instanceof Uint16Array, true, 'indices are Uint16Array')
    t.equals(res.colors.length / 4, 16, 'colors len matches')
    t.same(res.size, [3, 3, 3], 'size matches 32x32x32')
    t.end()
  })
})

test('loading small vox', (t) => {
  const renderJob = 1
  const flipX = false //opt
  const megavox = false //opt

  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'green_cube.vox'))

  voxReader(buffer, renderJob, flipX, megavox, false, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }
    // before : (180 vert pos * 3 * 32float) + (180 colors * 3 * 32float) + (180 normals * 3 * 32float) (180 idx * 32uint)
    // after  : (96 vert pos * 3 * 32float) + (96 colors * 3 * 32float) + (96 normals * 3 32float) + (180 idx + 32uint)
    // after  : (74 vert pos * 3 * 32float) + (74 colors * 3 * 32float) + (180 idx + 32uint)
    t.equals(res.positions.length / 3, 74, 'vertices len matches')
    t.equals(res.indices.length, 180, 'indices len matches')
    t.equals(res.indices instanceof Uint16Array, true, 'indices are Uint16Array')
    t.equals(res.colors.length / 4, 74, 'colors len matches')
    t.same(res.size, [32, 32, 32], 'size matches 32x32x32')
    t.end()
  })
})

test('loading mega vox', (t) => {
  const renderJob = 1
  const flipX = false //opt
  const megavox = true //opt

  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'mega.vox'))

  voxReader(buffer, renderJob, flipX, megavox, false, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }
    // before : (135438 vert pos * 3 * 32float) + (135438 colors * 3 * 32float) + (135438 normals * 3 * 32float) (135438 idx * 32uint)
    // after  : (61733 vert pos * 3 32float) + (61733 colors * 3 32float) + (61733 normals * 3 32float) + (135438 idx + 32uint)
    // after  : (34199 vert pos * 3 32float) + (34199 colors * 3 32float) + (135438 idx + 32uint)
    t.equals(res.positions.length / 3, 34199, 'vertices len matches')
    t.equals(res.indices.length, 135438, 'indices len matches')
    t.equals(res.indices instanceof Uint16Array, true, 'indices are Uint16Array')
    t.equals(res.colors.length / 4, 34199, 'colors len matches')
    t.same(res.size, [126, 126, 126], 'size matches 126x126x126')
    t.end()
  })
})

// I have no idea how many merged vertices this one should actually have, I just know that it's a lot
// This model is big enough that we need to use a Uint32Array array for indices. (E.g. final num verts >= 2^16)
test('loading menger vox', (t) => {
  const renderJob = 1
  const flipX = false //opt
  const megavox = true //opt

  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'menger.vox'))

  voxReader(buffer, renderJob, flipX, megavox, false, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }
    t.equals(res.positions.length / 3, 321302, 'vertices len matches')
    t.equals(res.indices.length, 1601640, 'indices len matches')
    t.equals(res.indices instanceof Uint32Array, true, 'indices are Uint32Array')
    t.equals(res.colors.length / 4, 321302, 'colors len matches')
    t.same(res.size, [81, 81, 81], 'size matches 126x126x126')
    t.end()
  })
})
