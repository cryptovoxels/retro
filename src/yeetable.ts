import { effect } from '@preact/signals'
import RAPIER from '@dimforge/rapier3d-compat'
import { physics, addYeet, removeCollider, takeHits, syncAvatar, removeAvatar, type ContactHit } from './physics/world'
import { TransformQueue } from './utils/transform'
import { voxImporter } from '../common/vox-import/vox-import'
import { cameraPosition, cameraRotation } from './utils/camera'
import { Animations } from './avatar-animations'
import { equippedWid } from './store'
import { emote } from './utils/emote'
import { disposeGhost, ghostSegmentHit } from './ghosts'
import { runCompute } from './mono-pool'
import type Controls from './controls/controls'
import type { NerfMessage } from '../common/messages'
import { Mesh, SceneContext, Vec3, onBeforeRender } from '@babylonjs/lite'
import { quat, vec3 } from 'wgpu-matrix'

type LocalObj = {
  id: string
  wid: string
  mesh: Mesh
  body: RAPIER.RigidBody
  owned: true
  thrownAt: number
  lastPos: Vec3
  nerfed?: boolean
}

type RemoteObj = {
  id: string
  wid: string
  mesh: Mesh | null
  queue: TransformQueue
  owned: false
  loading?: boolean
}

const locals = new Map<string, LocalObj>()
const remotes = new Map<string, RemoteObj>()
const heldMeshes = new Map<string, Mesh>()
const yeetMeshes = new Map<string, Mesh>()
const yeetCoords = new Map<string, Int32Array>()
let heldMesh: Mesh | null = null
let heldBobT = 0
let seq = 0
let hooked = false
let yeetInterval: any = null
const deadSignal = new AbortController().signal

function clientUUID() {
  return window.connector?.persona?.uuid || 'local'
}

function burstWorld(pos: Vec3) {
  const scene = window.scene
  if (!scene) return
  emote('💥', pos, scene)
  emote('🔥', pos, scene)
  emote('✨', pos, scene)
}

function respawn() {
  const parcels = window.grid?.getAllParcelsByDistance?.().slice(0, 4) || []
  if (!parcels.length) return
  const parcel = parcels[Math.floor(Math.random() * parcels.length)]
  const sp = parcel.featuresList.find((f: any) => f.type === 'spawn-point')
  const pos = sp ? sp.absolutePosition.clone() : parcel.transform.position.clone()
  window.persona?.teleportNoHistory({ position: pos })
}

function carveCrater(parcelId: string, center: Vec3) {
  const parcel = window.grid?.parcels?.get(Number(parcelId))
  if (!parcel?.voxelMesh || !parcel.field) return
  const vm = parcel.voxelMesh.position
  const tp = parcel.transform.position
  const local = center.subtract(tp).subtract(vm).scaleInPlace(2)
  const cx = Math.round(local.x - 1)
  const cy = Math.round(local.y - 2)
  const cz = Math.round(local.z - 1)
  const voxels: [number, number, number][] = []
  for (let x = cx - 1; x <= cx + 1; x++) {
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let z = cz - 1; z <= cz + 1; z++) {
        voxels.push([x, y, z])
      }
    }
  }
  parcel.carve(voxels)
}

function nerfAt(pos: Vec3, yeetId: string, kind: NerfMessage['kind'], target?: string) {
  console.log('nerfAt', `${pos.x},${pos.y},${pos.z}`)

  disposeYeet(yeetId)
  burstWorld(pos)
  window.connector?.sendNerf?.({
    yeetId,
    kind,
    target,
    position: [pos.x, pos.y, pos.z],
  })
}

function resolveHit(hit: ContactHit) {
  console.log('hit', hit)

  const local = locals.get(hit.yeetId)
  if (!local || local.nerfed) return

  local.nerfed = true
  const pos = vec3.fromValues(hit.pos.x, hit.pos.y, hit.pos.z)
  const normal = vec3.fromValues(hit.normal.x, hit.normal.y, hit.normal.z)

  if (hit.other.tag === 'avatar') {
    nerfAt(pos, hit.yeetId, 'avatar', hit.other.id)
    return
  }
  if (hit.other.tag === 'parcel') {
    const carveCenter = pos.subtract(normal.scale(0.25))
    console.log('carve!', carveCenter)
    carveCrater(hit.other.id, carveCenter)
    nerfAt(pos, hit.yeetId, 'field', hit.other.id)
    return
  }
  if (hit.other.tag === 'island' || hit.other.tag === 'ocean') {
    nerfAt(pos, hit.yeetId, 'field')
    return
  }
}

function syncAvatars() {
  const connector = window.connector
  if (!connector) return
  for (const [uuid, avatar] of connector.avatarsByUuid) {
    const p = avatar.position
    syncAvatar(uuid, { x: p.x, y: p.y, z: p.z })
  }
}

function ghostHits() {
  for (const o of locals.values()) {
    if (o.nerfed) continue
    const t = o.body.translation()
    const pos = vec3.fromValues(t.x, t.y, t.z)
    const from = o.lastPos
    const to = pos
    const ghost = ghostSegmentHit(from, to)
    if (!ghost) continue
    o.nerfed = true
    disposeGhost(ghost.ghostId)
    nerfAt(ghost.point, o.id, 'field')
  }
}

function ensureHooks(scene: SceneContext) {
  if (hooked) return
  hooked = true
  onBeforeRender(scene, () => {
    const dt = scene.getEngine().getDeltaTime() / 1000
    heldBobT += dt
    syncAvatars()
    for (const hit of takeHits()) resolveHit(hit)
    ghostHits()
    for (const o of locals.values()) {
      const t = o.body.translation()
      const r = o.body.rotation()
      const pos = vec3.fromValues(t.x, t.y, t.z)
      o.mesh.position.copyFrom(pos)
      if (!o.mesh.rotationQuaternion) o.mesh.rotationQuaternion = quat.identity()
      o.mesh.rotationQuaternion.set(r.x, r.y, r.z, r.w)

      if (!o.nerfed && Date.now() - o.thrownAt > 4000) {
        o.nerfed = true
        nerfAt(pos, o.id, 'field')
      }
      o.lastPos.copyFrom(pos)
    }
    const now = Date.now()
    for (const o of remotes.values()) {
      if (!o.mesh) continue
      const t = o.queue.get(now - 200)
      if (!t) continue
      o.mesh.position.copyFrom(t.position)
      if (!o.mesh.rotationQuaternion) o.mesh.rotationQuaternion = quat.identity()
      o.mesh.rotationQuaternion.copyFrom(t.orientation)
    }
    if (heldMesh) {
      const controls = window.connector?.controls
      const fp = !!controls?.firstPersonView
      heldMesh.setEnabled(fp)
      if (fp) {
        const hz = controls?.body?.motion?.hz || 0
        const bx = hz > 0.5 ? Math.sin(heldBobT * hz * 2) * 0.04 : 0
        const by = hz > 0.5 ? Math.cos(heldBobT * hz * 4) * 0.02 : 0
        heldMesh.position.set(bx, -0.25 + by, 0.55)
      }
    }
  })
}

export function disposeYeet(id: string) {
  removeCollider(`yeet-${id}`)
  const local = locals.get(id)
  if (local) {
    local.mesh.dispose()
    locals.delete(id)
  }
  const remote = remotes.get(id)
  if (remote) {
    remote.mesh?.dispose()
    remotes.delete(id)
  }
}

async function loadCoords(wid: string, url: string) {
  let coords = yeetCoords.get(wid)
  if (!coords) {
    coords = await runCompute((w) => w.wearVoxels(url))
    yeetCoords.set(wid, coords)
  }
  return coords
}

async function loadYeetMesh(wid: string, url: string): Promise<BABYLON.AbstractMesh | null> {
  let template = yeetMeshes.get(wid)
  if (!template) {
    try {
      template = await voxImporter().import(url, { signal: deadSignal })
      template.setEnabled(false)
      yeetMeshes.set(wid, template)
    } catch {
      return null
    }
  }
  return template.createInstance(`yeet-${wid}-${++seq}`)
}

export async function yeetWearable(wid: string) {
  const scene = window.scene
  if (!scene || !physics()) return
  ensureHooks(scene)

  const url = `/api/collectibles/${wid}/vox`
  const [mesh, coords] = await Promise.all([loadYeetMesh(wid, url), loadCoords(wid, url)])
  if (!mesh) return

  const eye = cameraPosition(scene)
  const rot = cameraRotation(scene)
  const q = quat.fromEuler(rot.x, rot.y, rot.z, 'yxz') /* todo(lite): verify euler order */
  const forward = vec3.fromValues(0, 0, 1)
  forward.rotateByQuaternionToRef(q, forward)
  const origin = eye.add(forward.scale(1))

  const id = `${clientUUID()}-${++seq}`
  const body = addYeet(id, { x: origin.x, y: origin.y, z: origin.z }, coords)
  if (!body) {
    mesh.dispose()
    return
  }
  body.setLinvel({ x: forward.x * 12, y: forward.y * 12 + 3, z: forward.z * 12 }, true)
  body.setAngvel({ x: Math.random() * 4 - 2, y: Math.random() * 4 - 2, z: Math.random() * 4 - 2 }, true)

  mesh.position.copyFrom(origin)
  if (!mesh.rotationQuaternion) mesh.rotationQuaternion = quat.identity()

  locals.set(id, { id, wid, mesh, body, owned: true, thrownAt: Date.now(), lastPos: origin.clone() })

  window.connector?.sendYeet?.({
    id,
    wid,
    position: [origin.x, origin.y, origin.z],
    orientation: [mesh.rotationQuaternion.x, mesh.rotationQuaternion.y, mesh.rotationQuaternion.z, mesh.rotationQuaternion.w],
  })

  window.persona?.audio?.playSound('build.place')
  startYeetState()
}

async function showHeld(wid: string) {
  const scene = window.scene
  const camera = window.connector?.controls?.camera
  if (!scene || !camera) return
  if (heldMesh) {
    heldMesh.parent = null
    heldMesh.setEnabled(false)
    heldMesh = null
  }
  if (!wid) return
  let mesh = heldMeshes.get(wid)
  if (!mesh) {
    try {
      mesh = await voxImporter().import(`/api/collectibles/${wid}/vox`, { signal: deadSignal })
      mesh.scaling.scaleInPlace(0.5)
      heldMeshes.set(wid, mesh)
    } catch {
      return
    }
  }
  heldMesh = mesh
  mesh.parent = camera
  mesh.position.set(0, -0.25, 0.55)
  mesh.rotationQuaternion = quat.identity()
  mesh.setEnabled(!!window.connector?.controls?.firstPersonView)
}

function startYeetState() {
  if (yeetInterval) return
  yeetInterval = setInterval(() => {
    if (!locals.size) return
    const objects: any[] = []
    for (const o of locals.values()) {
      const t = o.body.translation()
      const r = o.body.rotation()
      objects.push([o.id, t.x, t.y, t.z, r.x, r.y, r.z, r.w])
    }
    window.connector?.sendYeetState?.(objects)
  }, 200)
}

export function startYeet(scene: SceneContext, controls: Controls, canvas: HTMLCanvasElement) {
  ensureHooks(scene)
  effect(() => {
    void showHeld(equippedWid.value || '')
  })
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== canvas) return
    if (!equippedWid.value || !controls.firstPersonView) return
    void yeetWearable(equippedWid.value)
  })
}

export async function onRemoteYeet(msg: { uuid: string; id: string; wid: string; position: [number, number, number]; orientation: [number, number, number, number] }) {
  if (msg.uuid === clientUUID()) return
  if (locals.has(msg.id) || remotes.has(msg.id)) return
  const scene = window.scene
  if (!scene) return
  ensureHooks(scene)

  const remote: RemoteObj = {
    id: msg.id,
    wid: msg.wid,
    mesh: null,
    queue: new TransformQueue(200, 45),
    owned: false,
    loading: true,
  }
  remotes.set(msg.id, remote)

  const url = `/api/collectibles/${msg.wid}/vox`
  const mesh = await loadYeetMesh(msg.wid, url)
  if (!mesh) {
    remotes.delete(msg.id)
    return
  }
  if (!remotes.has(msg.id)) {
    mesh.dispose()
    return
  }
  mesh.position.fromArray(msg.position)
  mesh.rotationQuaternion = quat.fromValues(msg.orientation[0], msg.orientation[1], msg.orientation[2], msg.orientation[3])
  remote.mesh = mesh
  remote.loading = false
  remote.queue.add({
    timestamp: Date.now(),
    position: vec3.clone(msg.position as any),
    orientation: mesh.rotationQuaternion.clone(),
    animation: Animations.Idle,
  })
}

export function onRemoteYeetState(msg: { uuid: string; objects: any[] }) {
  if (msg.uuid === clientUUID()) return
  const now = Date.now()
  for (const row of msg.objects || []) {
    const [id, x, y, z, qx, qy, qz, qw] = row
    const remote = remotes.get(id)
    if (!remote) continue
    remote.queue.add({
      timestamp: now,
      position: vec3.fromValues(x, y, z),
      orientation: quat.fromValues(qx, qy, qz, qw),
      animation: Animations.Idle,
    })
  }
}

export function onRemoteNerf(msg: NerfMessage) {
  const pos = vec3.clone(msg.position as any)
  disposeYeet(msg.yeetId)
  burstWorld(pos)
  if (msg.kind === 'field' && msg.target) carveCrater(msg.target, pos)
  if (msg.kind === 'avatar' && msg.target === clientUUID()) respawn()
}

export function disposeYeetsForUuid(uuid: string) {
  for (const [id] of remotes) {
    if (!id.startsWith(uuid)) continue
    disposeYeet(id)
  }
  for (const [id] of locals) {
    if (!id.startsWith(uuid)) continue
    disposeYeet(id)
  }
}

export function disposeAvatarPhysics(uuid: string) {
  removeAvatar(uuid)
}
