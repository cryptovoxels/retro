import { v7 as uuid } from 'uuid'
import { Animations } from './avatar-animations'
import Avatar, { LoadAvatar } from './avatar'
import type Connector from './connector'
import type Controls from './controls/controls'
import type Grid from './grid'

export const GhostType = {
  walk: 0,
  conga: 1,
  fly: 2,
  drive: 3,
} as const

export type GhostTypeId = (typeof GhostType)[keyof typeof GhostType]

const SAMPLE_MS = 200
const MOVE_EPS = 0.15
const IDLE_CAP_S = 10
const SPAWN_GATE_M = 1
const TELEPORT_M = 20
const MIN_PATH_M = 5
const MIN_PARCELS = 2
const MAX_SAMPLES = 240
const MAX_SPAN_S = 90
const MAX_GHOSTS = 10
const STRIDE = 4

type Sample = { t: number; x: number; y: number; z: number; parcel: number }

type GhostRow = {
  start_parcel: number
  end_parcel: number
  type: number
  path: string
}

function locomotionType(controls: Controls, connector: Connector): GhostTypeId {
  if (controls.getVehicleAvatarPayload()) return GhostType.drive
  if (controls.flying) return GhostType.fly
  if (connector.inConga) return GhostType.conga
  return GhostType.walk
}

function packSamples(samples: Sample[]): Float32Array {
  const out = new Float32Array(samples.length * STRIDE)
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const o = i * STRIDE
    out[o] = s.t
    out[o + 1] = s.x
    out[o + 2] = s.y
    out[o + 3] = s.z
  }
  return out
}

function pathLength(blob: Sample[]): number {
  let d = 0
  for (let i = 1; i < blob.length; i++) {
    const a = blob[i - 1]
    const b = blob[i]
    d += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
  }
  return d
}

function unpackPath(b64: string): Float32Array | null {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    if (bytes.byteLength % 16 !== 0 || bytes.byteLength < 32) return null
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  } catch {
    return null
  }
}

function animationFor(type: GhostTypeId, speed: number): Animations {
  if (type === GhostType.fly) return Animations.Floating
  if (type === GhostType.drive) return Animations.Sitting
  if (type === GhostType.conga) return Animations.Walk
  if (speed > 3) return Animations.Run
  if (speed > 0.5) return Animations.Walk
  return Animations.Idle
}

function applyGhostLook(avatar: Avatar) {
  avatar.nametag = false
  const m = avatar.material
  if (!m) return
  m.diffuseColor.set(0.25, 0.95, 0.35)
  m.emissiveColor.set(0.08, 0.35, 0.12)
  m.specularColor.set(0.1, 0.2, 0.1)
  m.alpha = 0.35
  m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND
  const collider = (avatar as any).collider
  if (collider) collider.isPickable = false
}

export function startGhosts(scene: BABYLON.Scene, parent: BABYLON.TransformNode, grid: Grid, controls: Controls, connector: Connector) {
  if (window.config.isBot) return

  let samples: Sample[] = []
  let parcelBudget = Math.random() < 0.5 ? 2 : 3
  let blobType: GhostTypeId | null = null
  let blobStartMs = 0
  let lastPos: BABYLON.Vector3 | null = null
  let gatePos: BABYLON.Vector3 | null = null
  let idleSinceMs: number | null = null
  let lastSampleAt = 0
  let fetchAt = Date.now() + 5000 + Math.random() * 5000
  let lastFetchParcel: number | null = null

  const playing = new Map<string, { avatar: Avatar; disposeAt: number }>()

  const resetBlob = (type: GhostTypeId | null) => {
    samples = []
    parcelBudget = Math.random() < 0.5 ? 2 : 3
    blobType = type
    blobStartMs = Date.now()
    lastPos = null
    idleSinceMs = null
  }

  const disarm = (pos: BABYLON.Vector3) => {
    resetBlob(null)
    gatePos = pos.clone()
  }

  const distinctParcels = (blob: Sample[] = samples) => {
    const set = new Set<number>()
    for (const s of blob) set.add(s.parcel)
    return set
  }

  const postBlob = (blob: Sample[], type: GhostTypeId) => {
    if (blob.length < 2) return
    if (distinctParcels(blob).size < MIN_PARCELS) return
    if (pathLength(blob) < MIN_PATH_M) return
    const startParcel = blob[0].parcel
    const endParcel = blob[blob.length - 1].parcel
    const packed = packSamples(blob)
    const delay = 2000 + Math.random() * 18000
    const bytes = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength)
    window.setTimeout(() => {
      try {
        fetch(`/api/ghosts?start_parcel=${startParcel}&end_parcel=${endParcel}&type=${type}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
          credentials: 'omit',
          keepalive: true,
        }).catch(() => {})
      } catch {}
    }, delay)
  }

  const flush = (keepCurrent: boolean) => {
    if (blobType == null || samples.length < 2) {
      if (keepCurrent) {
        resetBlob(locomotionType(controls, connector))
      } else {
        resetBlob(null)
      }
      return
    }
    const type = blobType
    const blob = samples.slice()
    postBlob(blob, type)
    if (keepCurrent) {
      const parcel = grid.currentParcel()?.id
      const pos = connector.persona.position
      resetBlob(locomotionType(controls, connector))
      if (parcel != null && pos) {
        blobStartMs = Date.now()
        samples.push({ t: 0, x: pos.x, y: pos.y, z: pos.z, parcel })
        lastPos = pos.clone()
      }
    } else {
      resetBlob(null)
    }
  }

  const sample = () => {
    const now = Date.now()
    if (now - lastSampleAt < SAMPLE_MS) return
    lastSampleAt = now

    const parcel = grid.currentParcel()?.id
    const pos = connector.persona.position
    if (parcel == null || !pos) return

    const type = locomotionType(controls, connector)

    if (gatePos == null) {
      gatePos = pos.clone()
      return
    }

    if (blobType == null) {
      if (BABYLON.Vector3.Distance(pos, gatePos) < SPAWN_GATE_M) return
      resetBlob(type)
      samples.push({ t: 0, x: pos.x, y: pos.y, z: pos.z, parcel })
      lastPos = pos.clone()
      return
    }

    if (type !== blobType) {
      flush(true)
      return
    }

    if (lastPos) {
      const dist = BABYLON.Vector3.Distance(pos, lastPos)
      if (dist > TELEPORT_M) {
        flush(false)
        disarm(pos)
        return
      }

      if (dist < MOVE_EPS) {
        if (idleSinceMs == null) idleSinceMs = now
        if ((now - idleSinceMs) / 1000 >= IDLE_CAP_S) {
          flush(false)
          disarm(pos)
        }
        return
      }

      idleSinceMs = null
    }

    const t = (now - blobStartMs) / 1000
    samples.push({ t, x: pos.x, y: pos.y, z: pos.z, parcel })
    lastPos = pos.clone()

    if (samples.length >= MAX_SAMPLES || t >= MAX_SPAN_S) {
      flush(true)
      return
    }

    if (distinctParcels().size >= parcelBudget) {
      flush(true)
    }
  }

  const disposeGhost = (id: string) => {
    const g = playing.get(id)
    if (!g) return
    try {
      g.avatar.emote('👻')
      g.avatar.disposeLocal()
    } catch {}
    playing.delete(id)
  }

  const playGhost = async (row: GhostRow) => {
    if (playing.size >= MAX_GHOSTS) return
    const path = unpackPath(row.path)
    if (!path) return
    const n = path.length / STRIDE
    if (n < 2) return

    const id = uuid()
    let avatar: Avatar
    try {
      avatar = await LoadAvatar(scene, parent, 0, id, { name: 'anon', wallet: null })
      await avatar.load()
    } catch {
      return
    }
    if (playing.size >= MAX_GHOSTS) {
      avatar.disposeLocal()
      return
    }

    applyGhostLook(avatar)

    const type = (row.type | 0) as GhostTypeId
    const startWall = Date.now()
    const t0 = path[0]
    const endT = path[(n - 1) * STRIDE]
    const durationMs = Math.max(0, (endT - t0) * 1000) + 500

    for (let i = 0; i < n; i++) {
      const o = i * STRIDE
      const t = path[o]
      const x = path[o + 1]
      const y = path[o + 2]
      const z = path[o + 3]
      let nx = x
      let nz = z
      if (i + 1 < n) {
        nx = path[(i + 1) * STRIDE + 1]
        nz = path[(i + 1) * STRIDE + 3]
      } else if (i > 0) {
        nx = x + (x - path[(i - 1) * STRIDE + 1])
        nz = z + (z - path[(i - 1) * STRIDE + 3])
      }
      const dx = nx - x
      const dz = nz - z
      const speed = i + 1 < n ? Math.hypot(dx, path[(i + 1) * STRIDE + 2] - y, dz) / Math.max(0.001, path[(i + 1) * STRIDE] - t) : 0
      const yaw = Math.atan2(dx, dz)
      avatar.move({
        position: new BABYLON.Vector3(x, y, z),
        orientation: BABYLON.Quaternion.FromEulerAngles(0, yaw, 0),
        animation: animationFor(type, speed),
        timestamp: startWall + (t - t0) * 1000,
      })
    }

    playing.set(id, { avatar, disposeAt: startWall + durationMs })
  }

  const fetchGhosts = async () => {
    const parcel = grid.currentParcel()?.id
    if (parcel == null) return
    lastFetchParcel = parcel
    try {
      const r = await fetch(`/api/ghosts?parcel=${parcel}`, { credentials: 'omit', cache: 'no-store' })
      if (!r.ok) return
      const json = (await r.json()) as { success?: boolean; ghosts?: GhostRow[] }
      if (!json?.success || !Array.isArray(json.ghosts)) return
      for (const row of json.ghosts) {
        if (playing.size >= MAX_GHOSTS) break
        void playGhost(row)
      }
    } catch {}
  }

  grid.parcel_events.addEventListener('parcel_entered', () => {
    fetchAt = Date.now() + 500 + Math.random() * 1500
  })

  scene.onBeforeRenderObservable.add(() => {
    try {
      sample()
    } catch {}

    const now = Date.now()
    for (const [id, g] of playing) {
      if (now >= g.disposeAt) disposeGhost(id)
    }

    if (now >= fetchAt) {
      fetchAt = now + 30000 + Math.random() * 60000
      const parcel = grid.currentParcel()?.id
      if (parcel != null && (playing.size < MAX_GHOSTS || parcel !== lastFetchParcel)) {
        void fetchGhosts()
      }
    }
  })
}
