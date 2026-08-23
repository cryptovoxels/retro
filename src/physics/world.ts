import RAPIER from '@dimforge/rapier3d-compat'
import { VoxelSize } from '../../common/voxels/constants'

export type Vec3 = { x: number; y: number; z: number }
export type ColliderTag = 'parcel' | 'island' | 'ocean' | 'avatar' | 'yeet'

export const GROUP_TARGET = (0x0002 << 16) | 0x0004
export const GROUP_YEET = (0x0004 << 16) | 0xffff
export const PLAYER_QUERY = (0x0008 << 16) | 0x0001

const YEET_CELL = 0.04
const YEET_MASS = 0.3

export type Entry = {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  tag: ColliderTag
  id: string
}

export type ContactHit = {
  yeetId: string
  other: Entry
  pos: Vec3
  normal: Vec3
}

let world: RAPIER.World | null = null
let eventQueue: RAPIER.EventQueue | null = null
const entries = new Map<string, Entry>()
const byHandle = new Map<number, Entry>()
const hits: ContactHit[] = []
const noHits: ContactHit[] = []
let accumulator = 0
const STEP = 1 / 60

function tagFromKey(key: string): ColliderTag {
  if (key.startsWith('parcel-')) return 'parcel'
  if (key.startsWith('island-')) return 'island'
  if (key.startsWith('ocean-')) return 'ocean'
  if (key.startsWith('avatar-')) return 'avatar'
  if (key.startsWith('yeet-')) return 'yeet'
  return 'parcel'
}

function register(key: string, entry: Entry) {
  entries.set(key, entry)
  byHandle.set(entry.collider.handle, entry)
}

function unregister(key: string) {
  const e = entries.get(key)
  if (!e) return
  byHandle.delete(e.collider.handle)
  entries.delete(key)
}

export function physics(): RAPIER.World | null {
  return world
}

export function lookupCollider(handle: number): Entry | null {
  return byHandle.get(handle) ?? null
}

/** all yeet contacts since the last call; consumed by yeetable every frame */
export function takeHits(): ContactHit[] {
  return hits.length ? hits.splice(0) : noHits
}

export async function initPhysics() {
  if (world) return
  await RAPIER.init()
  world = new RAPIER.World({ x: 0, y: -10.8, z: 0 })
  eventQueue = new RAPIER.EventQueue(false)
}

function contactPoint(h1: number, h2: number): { pos: Vec3; normal: Vec3 } | null {
  if (!world) return null
  let pos: Vec3 | null = null
  let normal: Vec3 = { x: 0, y: 1, z: 0 }
  world.narrowPhase.contactPair(h1, h2, world.bodies, (m) => {
    if (m.numSolverContacts() < 1) return
    const p = m.solverContactPoint(0)
    const n = m.normal()
    if (!p) return
    pos = { x: p.x, y: p.y, z: p.z }
    normal = { x: n.x, y: n.y, z: n.z }
  })
  return pos ? { pos, normal } : null
}

function drainContacts() {
  if (!eventQueue || !world) return
  eventQueue.drainCollisionEvents((h1, h2, started) => {
    if (!started) return
    const e1 = byHandle.get(h1)
    const e2 = byHandle.get(h2)
    if (!e1 || !e2) return
    let yeet: Entry | null = null
    let other: Entry | null = null
    if (e1.tag === 'yeet') {
      yeet = e1
      other = e2
    } else if (e2.tag === 'yeet') {
      yeet = e2
      other = e1
    } else return
    // the manifold can be empty by the time we drain (bounce/CCD): fall back to the body position
    const c = contactPoint(h1, h2)
    const t = yeet.body.translation()
    hits.push({
      yeetId: yeet.id,
      other,
      pos: c?.pos ?? { x: t.x, y: t.y, z: t.z },
      normal: c?.normal ?? { x: 0, y: 1, z: 0 },
    })
  })
}

export function stepPhysics(dtSec: number) {
  if (!world || !eventQueue) return
  accumulator += Math.min(dtSec, 0.05)
  while (accumulator >= STEP) {
    world.step(eventQueue)
    drainContacts()
    accumulator -= STEP
  }
}

function addVoxelsKeyed(key: string, coords: Int32Array, origin: Vec3, cellSize: number) {
  if (!world) return
  removeCollider(key)
  if (coords.length < 3) return

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(origin.x, origin.y, origin.z))
  const desc = RAPIER.ColliderDesc.voxels(coords, { x: cellSize, y: cellSize, z: cellSize })
  const collider = world.createCollider(desc, body)
  register(key, { body, collider, tag: tagFromKey(key), id: key.split('-').slice(1).join('-') })
}

export function addVoxels(key: string, coords: Int32Array, origin: Vec3) {
  addVoxelsKeyed(key, coords, origin, VoxelSize)
}

export function addCuboid(key: string, half: Vec3, center: Vec3) {
  if (!world) return
  removeCollider(key)
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
  const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
  const collider = world.createCollider(desc, body)
  register(key, { body, collider, tag: tagFromKey(key), id: key.split('-').slice(1).join('-') })
}

function yeetDesc(coords: Int32Array | null | undefined) {
  const events = RAPIER.ActiveEvents.COLLISION_EVENTS
  const groups = GROUP_YEET
  const inertia = { x: 0.01, y: 0.01, z: 0.01 }
  const frame = { w: 1, x: 0, y: 0, z: 0 }
  if (coords && coords.length >= 3) {
    return RAPIER.ColliderDesc.voxels(coords, { x: YEET_CELL, y: YEET_CELL, z: YEET_CELL }).setActiveEvents(events).setCollisionGroups(groups).setMassProperties(YEET_MASS, { x: 0, y: 0, z: 0 }, inertia, frame)
  }
  return RAPIER.ColliderDesc.ball(0.2).setActiveEvents(events).setCollisionGroups(groups)
}

export function addYeet(id: string, origin: Vec3, coords?: Int32Array | null): RAPIER.RigidBody | null {
  if (!world) return null
  const key = `yeet-${id}`
  removeCollider(key)
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(origin.x, origin.y, origin.z).setCcdEnabled(true))
  const collider = world.createCollider(yeetDesc(coords), body)
  register(key, { body, collider, tag: 'yeet', id })
  return body
}

export function syncAvatar(uuid: string, pos: Vec3) {
  if (!world) return
  const key = `avatar-${uuid}`
  const existing = entries.get(key)
  if (existing) {
    existing.body.setNextKinematicTranslation(pos)
    return
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z))
  const collider = world.createCollider(RAPIER.ColliderDesc.cylinder(0.6, 0.2).setCollisionGroups(GROUP_TARGET), body)
  register(key, { body, collider, tag: 'avatar', id: uuid })
}

export function removeAvatar(uuid: string) {
  removeCollider(`avatar-${uuid}`)
}

export function removeCollider(key: string) {
  if (!world) return
  const e = entries.get(key)
  if (!e) return
  world.removeCollider(e.collider, true)
  world.removeRigidBody(e.body)
  unregister(key)
}

export function hasCollider(key: string) {
  return entries.has(key)
}
