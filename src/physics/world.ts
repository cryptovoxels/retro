import RAPIER from '@dimforge/rapier3d-compat'
import { VoxelSize } from '../../common/voxels/constants'

export type Vec3 = { x: number; y: number; z: number }

export const PLAYER_QUERY = (0x0008 << 16) | 0x0001

type Entry = {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
}

let world: RAPIER.World | null = null
const entries = new Map<string, Entry>()
let accumulator = 0
const STEP = 1 / 60

export function physics(): RAPIER.World | null {
  return world
}

export async function initPhysics() {
  if (world) return
  await RAPIER.init()
  world = new RAPIER.World({ x: 0, y: -10.8, z: 0 })
}

export function stepPhysics(dtSec: number) {
  if (!world) return
  accumulator += Math.min(dtSec, 0.05)
  while (accumulator >= STEP) {
    world.step()
    accumulator -= STEP
  }
}

const PARCEL_CELL = { x: VoxelSize, y: VoxelSize, z: VoxelSize }

function addFixed(key: string, desc: RAPIER.ColliderDesc, origin: Vec3, rotation?: RAPIER.Rotation) {
  if (!world) return
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(origin.x, origin.y, origin.z)
  if (rotation) bodyDesc.setRotation(rotation)
  const body = world.createRigidBody(bodyDesc)
  const collider = world.createCollider(desc, body)
  entries.set(key, { body, collider })
}

export function addVoxels(key: string, coords: Int32Array, origin: Vec3, cell: Vec3 = PARCEL_CELL, rotation?: RAPIER.Rotation) {
  removeCollider(key)
  if (coords.length < 3) return
  addFixed(key, RAPIER.ColliderDesc.voxels(coords, cell), origin, rotation)
}

export function addCuboid(key: string, half: Vec3, center: Vec3, rotation?: RAPIER.Rotation) {
  removeCollider(key)
  addFixed(key, RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z), center, rotation)
}

export function addTrimesh(key: string, vertices: Float32Array, indices: Uint32Array, origin: Vec3) {
  removeCollider(key)
  if (!vertices.length || !indices.length) return
  addFixed(key, RAPIER.ColliderDesc.trimesh(vertices, indices), origin)
}

export function removeCollider(key: string) {
  if (!world) return
  const e = entries.get(key)
  if (!e) return
  world.removeCollider(e.collider, true)
  world.removeRigidBody(e.body)
  entries.delete(key)
}
