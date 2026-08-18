import { runCompute } from './mono-pool'
import { physics, RAPIER } from './physics/world'
import { TransformQueue } from './utils/transform'
import { voxImporter } from '../common/vox-import/vox-import'
import { cameraPosition, cameraRotation } from './utils/camera'
import { Animations } from './avatar-animations'

type LocalObj = {
  id: string
  wid: string
  mesh: BABYLON.Mesh
  body: any
  owned: true
}

type RemoteObj = {
  id: string
  wid: string
  mesh: BABYLON.Mesh | null
  queue: TransformQueue
  owned: false
  loading?: boolean
}

const locals = new Map<string, LocalObj>()
const remotes = new Map<string, RemoteObj>()
let seq = 0
let hooked = false
let emitInterval: any = null

function ensureHooks(scene: BABYLON.Scene) {
  if (hooked) return
  hooked = true
  scene.onBeforeRenderObservable.add(() => {
    for (const o of locals.values()) {
      const t = o.body.translation()
      const r = o.body.rotation()
      o.mesh.position.set(t.x, t.y, t.z)
      if (!o.mesh.rotationQuaternion) o.mesh.rotationQuaternion = BABYLON.Quaternion.Identity()
      o.mesh.rotationQuaternion.set(r.x, r.y, r.z, r.w)
    }
    const now = Date.now()
    for (const o of remotes.values()) {
      if (!o.mesh) continue
      const t = o.queue.get(now - 200)
      if (!t) continue
      o.mesh.position.copyFrom(t.position)
      if (!o.mesh.rotationQuaternion) o.mesh.rotationQuaternion = BABYLON.Quaternion.Identity()
      o.mesh.rotationQuaternion.copyFrom(t.orientation)
    }
  })
}

function clientUUID() {
  return window.connector?.persona?.uuid || 'local'
}

export async function emitWearable(wid: string) {
  const scene = window.scene
  const w = physics()
  if (!scene || !w) return
  ensureHooks(scene)

  const url = `/api/collectibles/${wid}/vox`
  let mesh: BABYLON.Mesh
  try {
    mesh = await voxImporter().import(url, { signal: new AbortController().signal })
  } catch {
    return
  }

  const points = await runCompute((worker) => worker.hullPointsFromVox(url))
  const hull = points.length >= 9 ? RAPIER.ColliderDesc.convexHull(points) : RAPIER.ColliderDesc.ball(0.25)
  if (!hull) return

  const eye = cameraPosition(scene)
  const rot = cameraRotation(scene)
  const q = BABYLON.Quaternion.FromEulerAngles(rot.x, rot.y, rot.z)
  const forward = new BABYLON.Vector3(0, 0, 1)
  forward.rotateByQuaternionToRef(q, forward)
  const origin = eye.add(forward.scale(0.8))

  const body = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setLinvel(forward.x * 12, forward.y * 12 + 3, forward.z * 12)
      .setAngvel({ x: Math.random() * 4 - 2, y: Math.random() * 4 - 2, z: Math.random() * 4 - 2 }),
  )
  w.createCollider(hull, body)

  mesh.parent = window.connector?.controls?.worldOffset || null
  mesh.position.copyFrom(origin)
  if (!mesh.rotationQuaternion) mesh.rotationQuaternion = BABYLON.Quaternion.Identity()

  const id = `${clientUUID()}-${++seq}`
  locals.set(id, { id, wid, mesh, body, owned: true })

  window.connector?.sendEmit?.({
    id,
    wid,
    position: [origin.x, origin.y, origin.z],
    orientation: [mesh.rotationQuaternion.x, mesh.rotationQuaternion.y, mesh.rotationQuaternion.z, mesh.rotationQuaternion.w],
  })

  startEmitState()
}

function startEmitState() {
  if (emitInterval) return
  emitInterval = setInterval(() => {
    if (!locals.size) return
    const objects: any[] = []
    for (const o of locals.values()) {
      const t = o.body.translation()
      const r = o.body.rotation()
      objects.push([o.id, t.x, t.y, t.z, r.x, r.y, r.z, r.w])
    }
    window.connector?.sendEmitState?.(objects)
  }, 200)
}

export async function onRemoteEmit(msg: { uuid: string; id: string; wid: string; position: [number, number, number]; orientation: [number, number, number, number] }) {
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

  let mesh: BABYLON.Mesh
  try {
    mesh = await voxImporter().import(`/api/collectibles/${msg.wid}/vox`, { signal: new AbortController().signal })
  } catch {
    remotes.delete(msg.id)
    return
  }
  if (!remotes.has(msg.id)) {
    mesh.dispose()
    return
  }
  mesh.parent = window.connector?.controls?.worldOffset || null
  mesh.position.fromArray(msg.position)
  mesh.rotationQuaternion = new BABYLON.Quaternion(msg.orientation[0], msg.orientation[1], msg.orientation[2], msg.orientation[3])
  remote.mesh = mesh
  remote.loading = false
  remote.queue.add({
    timestamp: Date.now(),
    position: BABYLON.Vector3.FromArray(msg.position),
    orientation: mesh.rotationQuaternion.clone(),
    animation: Animations.Idle,
  })
}

export function onRemoteEmitState(msg: { uuid: string; objects: any[] }) {
  if (msg.uuid === clientUUID()) return
  const now = Date.now()
  for (const row of msg.objects || []) {
    const [id, x, y, z, qx, qy, qz, qw] = row
    const remote = remotes.get(id)
    if (!remote) continue
    remote.queue.add({
      timestamp: now,
      position: new BABYLON.Vector3(x, y, z),
      orientation: new BABYLON.Quaternion(qx, qy, qz, qw),
      animation: Animations.Idle,
    })
  }
}

export function disposeEmitsForUuid(uuid: string) {
  for (const [id, o] of remotes) {
    if (!id.startsWith(uuid)) continue
    o.mesh?.dispose()
    remotes.delete(id)
  }
  for (const [id, o] of locals) {
    if (!id.startsWith(uuid)) continue
    const w = physics()
    if (w) w.removeRigidBody(o.body)
    o.mesh.dispose()
    locals.delete(id)
  }
}
