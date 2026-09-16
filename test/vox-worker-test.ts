import * as test from 'tape'
import { voxReader } from '../common/vox-import/vox-reader'
import * as path from 'path'
import * as fs from 'fs'

require('babylonjs-loaders')
require('babylonjs-materials')

test('loading vox with one voxel', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'single_voxel.vox'))

  voxReader(buffer, false, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }

    t.equals(res.positions.length / 3, 8, 'vertices len matches')
    t.equals(res.indices.length, 36, 'indices len matches')
    t.equals(res.positions instanceof Int8Array, true, 'positions are Int8Array')
    t.equals(res.indices instanceof Uint16Array, true, 'indices are Uint16Array')
    t.equals(res.colors instanceof Uint8Array, true, 'colors are Uint8Array')
    t.equals(res.colors.length / 4, 8, 'colors len matches')
    t.same(res.size, [3, 3, 3], 'size matches')
    t.end()
  })
})

test('loading 2_voxels_same_mat.vox', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', '2_voxels_same_mat.vox'))

  voxReader(buffer, false, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }

    t.equals(res.positions.length / 3, 8, 'vertices len matches')
    t.equals(res.indices.length, 36, 'indices len matches')
    t.equals(res.positions instanceof Int8Array, true, 'positions are Int8Array')
    t.equals(res.indices instanceof Uint16Array, true, 'indices are Uint16Array')
    t.equals(res.colors.length / 4, 8, 'colors len matches')
    t.same(res.size, [3, 3, 3], 'size matches')
    t.end()
  })
})

test('loading 2_voxels_diff_mats.vox', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', '2_voxels_diff_mats.vox'))

  voxReader(buffer, false, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }

    t.equals(res.positions.length / 3, 16, 'vertices len matches')
    t.equals(res.indices.length, 60, 'indices len matches')
    t.equals(res.indices instanceof Uint16Array, true, 'indices are Uint16Array')
    t.equals(res.colors.length / 4, 16, 'colors len matches')
    t.same(res.size, [3, 3, 3], 'size matches')
    t.end()
  })
})

test('loading small vox', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'green_cube.vox'))

  voxReader(buffer, false, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }
    t.equals(res.positions.length / 3, 74, 'vertices len matches')
    t.equals(res.indices.length, 180, 'indices len matches')
    t.equals(res.positions instanceof Int8Array, true, 'positions are Int8Array')
    t.equals(res.indices instanceof Uint16Array, true, 'indices are Uint16Array')
    t.equals(res.colors instanceof Uint8Array, true, 'colors are Uint8Array')
    t.equals(res.colors.length / 4, 74, 'colors len matches')
    t.same(res.size, [32, 32, 32], 'size matches 32x32x32')
    t.end()
  })
})

test('loading mega vox', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'mega.vox'))

  voxReader(buffer, true, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }
    t.equals(res.positions.length / 3, 34199, 'vertices len matches')
    t.equals(res.indices.length, 135438, 'indices len matches')
    t.equals(res.positions instanceof Int8Array, true, 'positions are Int8Array')
    t.equals(res.indices instanceof Uint16Array, true, 'indices are Uint16Array')
    t.equals(res.colors.length / 4, 34199, 'colors len matches')
    t.same(res.size, [126, 126, 126], 'size matches 126x126x126')
    t.end()
  })
})

test('loading menger vox', (t) => {
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'menger.vox'))

  voxReader(buffer, true, (res) => {
    if (res instanceof Error) {
      t.fail(`Did not expect error: '${res.toString()}'`)
      t.end()
      return
    }
    t.equals(res.positions.length / 3, 321302, 'vertices len matches')
    t.equals(res.indices.length, 1601640, 'indices len matches')
    t.equals(res.positions instanceof Int8Array, true, 'positions are Int8Array')
    t.equals(res.indices instanceof Uint32Array, true, 'indices are Uint32Array')
    t.equals(res.colors.length / 4, 321302, 'colors len matches')
    t.same(res.size, [81, 81, 81], 'size matches')
    t.end()
  })
})
