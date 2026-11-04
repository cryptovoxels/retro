import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { voxReader, VoxData } from '../common/vox-import/vox-reader'
import { loadNineVox, nineVox } from '../src/utils/nine-vox'
import { freezeFeature, meshCandidates, thawFeature } from '../src/utils'

const importer = vi.hoisted(() => ({ import: vi.fn() }))
vi.mock('../common/vox-import/vox-import', () => ({ VOX_SCALE: 0.02, voxImporter: () => importer }))

let engine: BABYLON.NullEngine
let scene: BABYLON.Scene
let data: VoxData
let slab: NonNullable<Awaited<ReturnType<typeof loadNineVox>>>

beforeAll(async () => {
  const bytes = readFileSync('dist/models/frames/pinkframe.vox')
  data = await new Promise((resolve, reject) => {
    voxReader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true, false, (result) => (result instanceof Error ? reject(result) : resolve(result)))
  })
})

beforeEach(async () => {
  engine = new BABYLON.NullEngine()
  scene = new BABYLON.Scene(engine)
  importer.import.mockImplementation(async () => {
    const mesh = new BABYLON.Mesh('source', scene)
    mesh.setVerticesBuffer(new BABYLON.VertexBuffer(engine, data.positions, BABYLON.VertexBuffer.PositionKind, { size: 3, type: BABYLON.VertexBuffer.BYTE }))
    mesh.setVerticesBuffer(new BABYLON.VertexBuffer(engine, data.colors, BABYLON.VertexBuffer.ColorKind, { size: 4, type: BABYLON.VertexBuffer.UNSIGNED_BYTE, normalized: true }))
    mesh.setIndices(data.indices)
    return mesh
  })
  slab = (await loadNineVox('pink'))!
})

afterEach(() => {
  scene.dispose()
  engine.dispose()
})

function nft(width = 2, height = 2) {
  const mesh = BABYLON.MeshBuilder.CreatePlane('nft', {}, scene)
  mesh.scaling.set(width, height, 1)
  const feature: any = { mesh, scale: mesh.scaling, scene, type: 'nft-image', description: {}, disposed: false }
  ;(mesh as any).feature = feature
  freezeFeature(feature)
  return feature
}

test('late frames freeze, cull at 50m and stay out of offscreen candidates', () => {
  const feature = nft()
  const frame = nineVox(slab, feature)
  const camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, -60), scene)
  camera.setTarget(BABYLON.Vector3.Zero())
  scene.updateTransformMatrix(true)
  expect(frame.isWorldMatrixFrozen).toBe(true)
  expect(frame.getLOD(camera)).toBeNull()
  camera.position.z = -10
  camera.getViewMatrix(true)
  expect(frame.getLOD(camera)).toBe(frame)
  thawFeature(feature)
  feature.mesh.position.x = 200
  freezeFeature(feature)
  meshCandidates(scene)
  const candidates = scene.getActiveMeshCandidates()
  expect(candidates.data.slice(0, candidates.length)).not.toContain(frame)
})

test('frames follow edits without applying NFT scale twice', () => {
  const feature = nft(2, 3)
  const frame = nineVox(slab, feature)
  const size = frame.getBoundingInfo().boundingBox.extendSizeWorld.scale(2)
  expect(size.x).toBeCloseTo(2 + slab.border[0] * 0.04)
  expect(size.y).toBeCloseTo(3 + slab.border[1] * 0.04)
  thawFeature(feature)
  expect(frame.isWorldMatrixFrozen).toBe(false)
  feature.mesh.position.set(8, 2, 5)
  freezeFeature(feature)
  expect(frame.getBoundingInfo().boundingBox.centerWorld.x).toBeCloseTo(8)
  feature.mesh.dispose()
  expect(frame.isDisposed()).toBe(true)
})

test('matching sizes share geometry, keep packed colors and release it after the last frame', () => {
  const first = nineVox(slab, nft())
  const second = nineVox(slab, nft())
  const other = nineVox(slab, nft(3, 2))
  expect(second.geometry).toBe(first.geometry)
  expect(other.geometry).not.toBe(first.geometry)
  const colors = first.getVertexBuffer(BABYLON.VertexBuffer.ColorKind)!
  expect(colors.type).toBe(BABYLON.VertexBuffer.UNSIGNED_BYTE)
  expect(colors.normalized).toBe(true)
  const bytes = first.getTotalVertices() * (first.getVertexBuffer(BABYLON.VertexBuffer.PositionKind)!.byteStride + colors.byteStride) + data.indices.byteLength
  expect(bytes).toBe(42192)
  const shared = first.geometry!
  first.dispose()
  expect(shared.isDisposed()).toBe(false)
  expect(second.getTotalVertices()).toBe(2028)
  second.dispose()
  expect(shared.isDisposed()).toBe(true)
  expect(slab.geometries.get(scene)?.has('2:2')).toBe(false)
  const replacement = nineVox(slab, nft())
  expect(replacement.geometry).not.toBe(shared)
})
