import RAPIER from '@dimforge/rapier3d-compat'
import { BRICK, BRICK_BYTES, BRICK_WORDS, DIR_AXIS, LOD_CHUNK_WORLD, VOX_RES } from './bricks'
import { activeTerrain, pool, slotDirectory } from './terrain'

const AIR = 0xff
const VOX = 0.1
const CAPSULE_R = 0.35
const CAPSULE_HALF = 0.6
/** eye height above capsule center */
const EYE = 0.7
const WALK_SPEED = 4.5
const WALK_SPRINT = 2
const JUMP = 7
const GRAVITY = -20
const PHYS_RANGE = 2 // lod0 chunk columns around camera
const FALL_Y = -20

export type PhysMode = 'fly' | 'walk'

type ChunkCol = {
  key: string
  cx: number
  cy: number
  cz: number
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
}

let world: RAPIER.World | null = null
let body: RAPIER.RigidBody | null = null
let capsule: RAPIER.Collider | null = null
let controller: RAPIER.KinematicCharacterController | null = null
let ready = false
let vy = 0
let jumpLatch = false
const cols = new Map<string, ChunkCol>()
const pending: string[] = []
const pendingSet = new Set<string>()
/** scratch for Int32 grid coords — 64^3 * 3 */
const scratch = new Int32Array(VOX_RES * VOX_RES * VOX_RES * 3)

function chunkKey(cx: number, cy: number, cz: number) {
  return `0:${cx}:${cy}:${cz}`
}

function eyeToCenter(eye: { x: number; y: number; z: number }) {
  return { x: eye.x, y: eye.y - EYE, z: eye.z }
}

function centerToEye(c: { x: number; y: number; z: number }): [number, number, number] {
  return [c.x, c.y + EYE, c.z]
}

function fillCoords(slot: number, cx: number, cy: number, cz: number): number {
  const dir = slotDirectory(slot)
  let n = 0
  const ox = cx * VOX_RES
  const oy = cy * VOX_RES
  const oz = cz * VOX_RES
  for (let bz = 0; bz < DIR_AXIS; bz++) {
    for (let by = 0; by < DIR_AXIS; by++) {
      for (let bx = 0; bx < DIR_AXIS; bx++) {
        const id = dir[bx + by * DIR_AXIS + bz * DIR_AXIS * DIR_AXIS]
        if (!id) continue
        const base = id * BRICK_WORDS
        const bytes = new Uint8Array(pool.words.buffer, base * 4, BRICK_BYTES)
        for (let lz = 0; lz < BRICK; lz++) {
          for (let ly = 0; ly < BRICK; ly++) {
            for (let lx = 0; lx < BRICK; lx++) {
              if (bytes[lx + ly * BRICK + lz * BRICK * BRICK] === AIR) continue
              const i = n * 3
              scratch[i] = ox + bx * BRICK + lx
              scratch[i + 1] = oy + by * BRICK + ly
              scratch[i + 2] = oz + bz * BRICK + lz
              n++
            }
          }
        }
      }
    }
  }
  return n
}

function combineWithNeighbors(col: ChunkCol) {
  const shifts: [number, number, number, number, number, number][] = [
    [1, 0, 0, VOX_RES, 0, 0],
    [-1, 0, 0, -VOX_RES, 0, 0],
    [0, 1, 0, 0, VOX_RES, 0],
    [0, -1, 0, 0, -VOX_RES, 0],
    [0, 0, 1, 0, 0, VOX_RES],
    [0, 0, -1, 0, 0, -VOX_RES],
  ]
  for (const [dx, dy, dz, sx, sy, sz] of shifts) {
    const n = cols.get(chunkKey(col.cx + dx, col.cy + dy, col.cz + dz))
    if (!n) continue
    try {
      col.collider.combineVoxelStates(n.collider, sx, sy, sz)
    } catch {
      /* experimental api — fail soft */
    }
  }
}

function buildOne(key: string): boolean {
  if (!world) return false
  const parts = key.split(':').map(Number)
  const cx = parts[1]
  const cy = parts[2]
  const cz = parts[3]
  const slot = activeTerrain.find((t) => t.lod === 0 && t.cx === cx && t.cy === cy && t.cz === cz)?.slot
  if (slot == null) return false
  const n = fillCoords(slot, cx, cy, cz)
  if (!n) return false
  const coords = scratch.slice(0, n * 3)
  try {
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0))
    const desc = RAPIER.ColliderDesc.voxels(coords, { x: VOX, y: VOX, z: VOX })
    const collider = world.createCollider(desc, fixed)
    const col: ChunkCol = { key, cx, cy, cz, body: fixed, collider }
    cols.set(key, col)
    combineWithNeighbors(col)
    return true
  } catch (e) {
    console.error('raycast: voxel collider failed', key, e)
    return false
  }
}

function removeCol(key: string) {
  const col = cols.get(key)
  if (!col || !world) return
  world.removeRigidBody(col.body)
  cols.delete(key)
}

export async function initPhysics(eye: [number, number, number]) {
  try {
    await RAPIER.init()
    world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 })
    const c = eyeToCenter({ x: eye[0], y: eye[1], z: eye[2] })
    body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y, c.z))
    capsule = world.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_R), body)
    controller = world.createCharacterController(0.02)
    controller.enableAutostep(0.55, 0.2, false)
    controller.enableSnapToGround(0.3)
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
    controller.setSlideEnabled(true)
    ready = true
  } catch (e) {
    console.error('raycast: physics init failed', e)
    ready = false
  }
}

export function physicsReady() {
  return ready
}

export function colliderCount() {
  return cols.size
}

/** keep lod0 colliders near camera; build at most one per call */
export function updateColliders(cam: [number, number, number] | Float32Array) {
  if (!ready || !world) return
  const worldSize = LOD_CHUNK_WORLD[0]
  const camX = Math.floor(cam[0] / worldSize)
  const camY = Math.floor(cam[1] / worldSize)
  const camZ = Math.floor(cam[2] / worldSize)
  const desired = new Set<string>()
  for (const t of activeTerrain) {
    if (t.lod !== 0) continue
    if (Math.abs(t.cx - camX) > PHYS_RANGE) continue
    if (Math.abs(t.cz - camZ) > PHYS_RANGE) continue
    if (Math.abs(t.cy - camY) > PHYS_RANGE + 1) continue
    const key = chunkKey(t.cx, t.cy, t.cz)
    desired.add(key)
    if (!cols.has(key) && !pendingSet.has(key)) {
      pendingSet.add(key)
      pending.push(key)
    }
  }
  for (const key of [...cols.keys()]) {
    if (!desired.has(key)) removeCol(key)
  }
  // drop pending that left the window
  if (pending.length) {
    const keep: string[] = []
    for (const key of pending) {
      if (desired.has(key) && !cols.has(key)) keep.push(key)
      else pendingSet.delete(key)
    }
    pending.length = 0
    pending.push(...keep)
  }
  while (pending.length) {
    const key = pending.shift()!
    pendingSet.delete(key)
    if (!desired.has(key) || cols.has(key)) continue
    buildOne(key)
    break // one per frame
  }
}

export type MoveInput = {
  /** unit wish direction in world space (already includes fly/walk axes) */
  wish: [number, number, number]
  speed: number
  jump: boolean
  mode: PhysMode
}

/** apply character movement; returns new eye position. fail-soft if not ready. */
export function move(dt: number, eye: [number, number, number] | Float32Array, input: MoveInput): [number, number, number] {
  if (!ready || !world || !body || !capsule || !controller || dt <= 0) {
    return [eye[0] + input.wish[0] * input.speed * dt, eye[1] + input.wish[1] * input.speed * dt, eye[2] + input.wish[2] * input.speed * dt]
  }

  // sync body to eye in case something teleported us
  const cur = eyeToCenter({ x: eye[0], y: eye[1], z: eye[2] })
  const pos = body.translation()
  if (Math.abs(pos.x - cur.x) > 0.01 || Math.abs(pos.y - cur.y) > 0.01 || Math.abs(pos.z - cur.z) > 0.01) {
    body.setNextKinematicTranslation(cur)
    world.step()
  }

  let dx = input.wish[0] * input.speed * dt
  let dy = input.wish[1] * input.speed * dt
  let dz = input.wish[2] * input.speed * dt

  if (input.mode === 'walk') {
    dx = input.wish[0] * input.speed * dt
    dz = input.wish[2] * input.speed * dt
    if (input.jump && controller.computedGrounded() && !jumpLatch) {
      vy = JUMP
      jumpLatch = true
    }
    if (!input.jump) jumpLatch = false
    vy += GRAVITY * dt
    dy = vy * dt
  } else {
    vy = 0
    jumpLatch = false
  }

  controller.computeColliderMovement(capsule, { x: dx, y: dy, z: dz })
  const m = controller.computedMovement()
  if (input.mode === 'walk') {
    if (controller.computedGrounded() && vy < 0) vy = 0
    // if we hit a ceiling, kill upward velocity
    if (m.y < dy - 1e-4 && vy > 0) vy = 0
  }

  const next = {
    x: body.translation().x + m.x,
    y: body.translation().y + m.y,
    z: body.translation().z + m.z,
  }
  body.setNextKinematicTranslation(next)
  world.step()

  const out = centerToEye(body.translation())
  if (out[1] < FALL_Y) {
    // pop back up a bit and force fly — caller should flip mode
    out[1] = 4
    body.setNextKinematicTranslation(eyeToCenter({ x: out[0], y: out[1], z: out[2] }))
    world.step()
    vy = 0
  }
  return out
}

/** mirror a deleted voxel into the matching chunk collider (world meters). */
export function setVoxelRemoved(wx: number, wy: number, wz: number) {
  if (!ready) return
  const gx = Math.floor(wx / VOX)
  const gy = Math.floor(wy / VOX)
  const gz = Math.floor(wz / VOX)
  const cx = Math.floor(gx / VOX_RES)
  const cy = Math.floor(gy / VOX_RES)
  const cz = Math.floor(gz / VOX_RES)
  const col = cols.get(chunkKey(cx, cy, cz))
  if (!col) return
  try {
    col.collider.setVoxel(gx, gy, gz, false)
    const shifts: [number, number, number, number, number, number][] = [
      [1, 0, 0, VOX_RES, 0, 0],
      [-1, 0, 0, -VOX_RES, 0, 0],
      [0, 1, 0, 0, VOX_RES, 0],
      [0, -1, 0, 0, -VOX_RES, 0],
      [0, 0, 1, 0, 0, VOX_RES],
      [0, 0, -1, 0, 0, -VOX_RES],
    ]
    for (const [dx, dy, dz, sx, sy, sz] of shifts) {
      const n = cols.get(chunkKey(col.cx + dx, col.cy + dy, col.cz + dz))
      if (!n) continue
      col.collider.propagateVoxelChange(n.collider, gx, gy, gz, sx, sy, sz)
    }
  } catch (e) {
    console.error('raycast: setVoxel failed', e)
  }
}

export function fellBelow(): boolean {
  if (!body) return false
  return body.translation().y + EYE < FALL_Y
}
