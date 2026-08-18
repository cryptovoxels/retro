import RAPIER from '@dimforge/rapier3d-compat'
import { VoxelSize } from '../../common/voxels/constants'

export type Vec3 = { x: number; y: number; z: number }

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

export function addVoxels(key: string, coords: Int32Array, origin: Vec3) {
  if (!world) return
  removeCollider(key)
  if (coords.length < 3) return

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(origin.x, origin.y, origin.z))
  const desc = RAPIER.ColliderDesc.voxels(coords, { x: VoxelSize, y: VoxelSize, z: VoxelSize })
  const collider = world.createCollider(desc, body)
  entries.set(key, { body, collider })
}

export function addTrimesh(key: string, positions: Float32Array, indices: Uint32Array, origin?: Vec3) {
  if (!world) return
  removeCollider(key)
  if (positions.length < 9 || indices.length < 3) return

  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
  if (origin) bodyDesc.setTranslation(origin.x, origin.y, origin.z)
  const body = world.createRigidBody(bodyDesc)
  const desc = RAPIER.ColliderDesc.trimesh(positions, indices)
  const collider = world.createCollider(desc, body)
  entries.set(key, { body, collider })
}

export function removeCollider(key: string) {
  if (!world) return
  const e = entries.get(key)
  if (!e) return
  world.removeCollider(e.collider, true)
  world.removeRigidBody(e.body)
  entries.delete(key)
}

export function hasCollider(key: string) {
  return entries.has(key)
}

export { RAPIER }
