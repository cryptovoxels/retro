// Lua behaviour runtime - one instance per parcel.
// Plain-state model: state is a Lua table of plain values. self:animate(target, ms)
// merges target into state and stamps t0/t1. While now < t1 the runtime calls
// spec.tick(self, t) every frame with t in [0,1]. After t1, behaviour stops
// ticking until the next animate.

import { LuaEngine, LuaFactory } from 'wasmoon'
import * as messages from '../../common/messages'
import type { BehaviourAttachment, Connection } from '../../common/messages/feature'
import type Feature from '../features/feature'
import type Parcel from '../parcel'
import { DSL_PRELUDE } from './dsl'
import type { BehaviourMeta } from './parse-metadata'
import { parseBehaviourMeta } from './parse-metadata'
import { clamp01 } from './state'

type BehaviourSpec = {
  name: string
  params: Record<string, { default: unknown }>
  slots: Record<string, true>
  hasTick: boolean
}

type BehaviourInstance = {
  feature: Feature
  attachment: BehaviourAttachment
  idx: number
  assetId: string
  spec: BehaviourSpec
  state: Record<string, unknown>
  selfName: string
  seq: number
  t0: number
  t1: number
}

const MAX_SIGNAL_DEPTH = 256
const TICK_BUDGET_MS = 4
const RAD_PER_DEG = Math.PI / 180
const DEG_PER_RAD = 180 / Math.PI

// Cache of (assetId -> { source, meta }) shared across parcel runtimes for the session.
const assetCache = new Map<string, { source: string; meta: BehaviourMeta }>()

let factory: LuaFactory | null = null

const ensureFactory = (): LuaFactory => {
  if (!factory) factory = new LuaFactory()
  return factory
}

const fetchAsset = async (assetId: string): Promise<{ source: string; meta: BehaviourMeta }> => {
  const hit = assetCache.get(assetId)
  if (hit) return hit
  const res = await fetch(`/api/library/asset/${assetId}`, { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error(`behaviour asset ${assetId} fetch failed`)
  const json: any = await res.json()
  const content = json?.asset?.content?.[0] ?? json?.content?.[0]
  const source: string = content?.script ?? ''
  if (!source) throw new Error(`behaviour asset ${assetId} has no script`)
  const meta = parseBehaviourMeta(source)
  const rec = { source, meta }
  assetCache.set(assetId, rec)
  return rec
}

// Build a JS object that looks like Vec3 to Lua: x/y/z fields readable and writable.
// Lua sees a plain table, sets fields, the wrapper writes them back to the feature.
const makeVec3Bridge = (read: () => [number, number, number], write: (v: [number, number, number]) => void) => {
  const cur = read()
  const obj: any = { x: cur[0], y: cur[1], z: cur[2] }
  // Wasmoon converts JS objects to Lua tables. Best we can do is sync on demand: the runtime
  // re-reads/writes from the table around tick() calls.
  return obj
}

const readPosition = (f: Feature): [number, number, number] => {
  const p = (f.description as any).position ?? [0, 0, 0]
  return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]
}

const readRotationDeg = (f: Feature): [number, number, number] => {
  const r = (f.description as any).rotation ?? [0, 0, 0]
  return [Number(r[0]) * DEG_PER_RAD, Number(r[1]) * DEG_PER_RAD, Number(r[2]) * DEG_PER_RAD]
}

// Recursive clone for plain values/arrays/objects. State is documented as plain values/tables,
// so we don't need Map/Set/Date support - reject anything else by falling back to original ref.
const deepClone = (v: unknown): unknown => {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(deepClone)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v as object)) out[k] = deepClone((v as any)[k])
  return out
}

export default class LuaBehaviours {
  parcel: Parcel
  engine: LuaEngine | null = null
  disposed = false
  private behaviours: BehaviourInstance[] = []
  private byKey: Map<string, BehaviourInstance> = new Map() // featureId:idx -> instance
  private tickObserver: { remove: () => void } | null = null
  private lastTickAt = 0
  private tickInterval = 0 // 0 = every frame; bumps to 33ms / 66ms under load
  private nextSeq = 1
  private currentDepth = 0

  constructor(parcel: Parcel) {
    this.parcel = parcel
  }

  async init(features: Feature[]): Promise<void> {
    if (this.disposed) return
    try {
      this.engine = await ensureFactory().createEngine({ injectObjects: true })
      this.engine.global.set('now', () => Date.now())
      await this.engine.doString(DSL_PRELUDE)
    } catch (err) {
      console.error('[behaviours] failed to create engine', err)
      return
    }

    console.log('engine', this.engine)

    for (const feature of this.parcel.featuresList) {
      await this.attachFeature(feature)
    }

    this.startTicker()
  }

  async attachFeature(feature: Feature): Promise<void> {
    if (!this.engine) return
    const list: BehaviourAttachment[] = (feature.description as any).behaviours ?? []
    for (let idx = 0; idx < list.length; idx++) {
      const att = list[idx]
      try {
        const { source, meta } = await fetchAsset(att.id)
        const spec = await this.ensureSpec(att.id, source, meta)
        await this.createInstance(feature, att, idx, spec)
      } catch (err) {
        console.error(`[behaviours] attach ${att.id} on ${feature.uuid}`, err)
      }
    }
  }

  private async ensureSpec(assetId: string, source: string, meta: BehaviourMeta): Promise<BehaviourSpec> {
    if (!this.engine) throw new Error('no engine')
    const ns = `__spec_${assetId.replace(/-/g, '_')}`
    const cached = this.engine.global.get(ns)
    if (cached) return cached as BehaviourSpec

    await this.engine.doString(`__behaviour_specs = {}\n${source}\n${ns} = __behaviour_specs[1]`)
    const raw = this.engine.global.get(ns)
    if (!raw) throw new Error(`behaviour script for ${assetId} did not register`)

    const spec: BehaviourSpec = {
      name: meta.name,
      params: (raw as any).params ?? {},
      slots: Object.fromEntries(meta.slots.map((s) => [s, true as const])),
      hasTick: typeof (raw as any).tick === 'function',
    }
    return spec
  }

  private async createInstance(feature: Feature, attachment: BehaviourAttachment, idx: number, spec: BehaviourSpec): Promise<void> {
    if (!this.engine) return
    const key = `${feature.uuid}:${idx}`
    const selfName = `__self_${key.replace(/[^A-Za-z0-9]/g, '_')}`

    // Initial state from spec defaults. Lua spec.state is the prototype table; deep-clone it
    // so nested tables aren't shared across instances of the same behaviour.
    const protoState = (this.engine.global.get(`__spec_${attachment.id.replace(/-/g, '_')}`) as any)?.state ?? {}
    const state = deepClone(protoState) as Record<string, unknown>

    const inst: BehaviourInstance = {
      feature,
      attachment,
      idx,
      assetId: attachment.id,
      spec,
      state,
      selfName,
      seq: 0,
      t0: 0,
      t1: 0,
    }
    this.behaviours.push(inst)
    this.byKey.set(key, inst)

    this.installSelf(inst)

    try {
      const ns = `__spec_${attachment.id.replace(/-/g, '_')}`
      await this.engine.doString(`if type(${ns}.init) == 'function' then ${ns}.init(${selfName}) end`)
    } catch (err) {
      console.error(`[behaviours] init failed ${attachment.id} on ${feature.uuid}`, err)
    }
  }

  // (Re)install the per-instance self table. Called once at create + every tick to refresh proxies.
  private installSelf(inst: BehaviourInstance): void {
    if (!this.engine) return
    const params = this.resolveParams(inst.spec, inst.attachment)
    const feature = inst.feature
    const position = makeVec3Bridge(
      () => readPosition(feature),
      (v) => feature.set({ position: v } as any),
    )
    const rotation = makeVec3Bridge(
      () => readRotationDeg(feature),
      (v) => feature.set({ rotation: [v[0] * RAD_PER_DEG, v[1] * RAD_PER_DEG, v[2] * RAD_PER_DEG] } as any),
    )

    this.engine.global.set(inst.selfName, {
      params,
      state: inst.state,
      position,
      rotation,
      visible: feature.mesh?.isEnabled() ?? true,
      animate: (target: Record<string, unknown>, ms: number) => this.handleAnimate(inst, target, ms),
      emit: (signal: string, data?: unknown) => this.handleEmit(inst, signal, data),
    })
  }

  // Read back position/rotation/visible writes that the Lua side made on the self table,
  // and apply them to the feature. Called after each tick / slot run.
  private flushSelfWrites(inst: BehaviourInstance): void {
    if (!this.engine) return
    const self = this.engine.global.get(inst.selfName) as any
    if (!self) return
    const feature = inst.feature
    const p = self.position
    if (p) {
      const [cx, cy, cz] = readPosition(feature)
      const nx = Number(p.x) || 0
      const ny = Number(p.y) || 0
      const nz = Number(p.z) || 0
      if (nx !== cx || ny !== cy || nz !== cz) {
        feature.set({ position: [nx, ny, nz] } as any)
      }
    }
    const r = self.rotation
    if (r) {
      const [cx, cy, cz] = readRotationDeg(feature)
      const nx = Number(r.x) || 0
      const ny = Number(r.y) || 0
      const nz = Number(r.z) || 0
      if (nx !== cx || ny !== cy || nz !== cz) {
        feature.set({ rotation: [nx * RAD_PER_DEG, ny * RAD_PER_DEG, nz * RAD_PER_DEG] } as any)
      }
    }
    if (typeof self.visible === 'boolean' && feature.mesh) {
      const cur = feature.mesh.isEnabled()
      if (self.visible !== cur) feature.mesh.setEnabled(self.visible)
    }
  }

  private resolveParams(spec: BehaviourSpec, attachment: BehaviourAttachment): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, def] of Object.entries(spec.params)) {
      out[k] = attachment.params?.[k] ?? def.default
    }
    return out
  }

  // self:animate({key=val, ...}, ms) - merge into state, stamp t0/t1, broadcast.
  private handleAnimate(inst: BehaviourInstance, target: Record<string, unknown>, ms: number): void {
    if (target && typeof target === 'object') Object.assign(inst.state, target)
    const now = Date.now()
    inst.t0 = now
    inst.t1 = now + Math.max(0, Number(ms) || 0)
    this.broadcastState(inst)
  }

  private dispatchSync(featureId: string, signal: string, data: unknown, depth: number): void {
    if (depth >= MAX_SIGNAL_DEPTH) {
      console.warn('[behaviours] dropping signal at depth', depth)
      return
    }
    for (const { inst, slot } of this.findSlotsForSignal(featureId, signal)) {
      this.runSlot(inst, slot, data, depth)
    }
  }

  private handleEmit(inst: BehaviourInstance, signal: string, data?: unknown): void {
    this.dispatchSync(inst.feature.uuid, signal, data, this.currentDepth + 1)
    this.sendSignal(inst.feature.uuid, signal, data)
  }

  dispatch(featureId: string, signal: string, data?: unknown): void {
    this.dispatchSync(featureId, signal, data, 1)
  }

  onSignal(featureId: string, signal: string, data?: unknown): void {
    this.dispatchSync(featureId, signal, data, 1)
  }

  // Incoming MP state update from a peer - last-write-wins via seq.
  // Peer sends state + t0/t1 so animation continues correctly across clients.
  onStateUpdate(featureId: string, idx: number, payload: Record<string, unknown>, seq: number): void {
    const inst = this.byKey.get(`${featureId}:${idx}`)
    if (!inst) return
    if (seq <= inst.seq) return
    inst.seq = seq
    const { __t0, __t1, ...rest } = payload as any
    Object.assign(inst.state, rest)
    if (typeof __t0 === 'number') inst.t0 = __t0
    if (typeof __t1 === 'number') inst.t1 = __t1
  }

  isActive(inst: BehaviourInstance): boolean {
    return Date.now() < inst.t1
  }

  // Diagnostic: how many instances are currently animating?
  activeCount(): number {
    const now = Date.now()
    let n = 0
    for (const inst of this.behaviours) if (now < inst.t1) n++
    return n
  }

  private broadcastState(inst: BehaviourInstance): void {
    inst.seq = ++this.nextSeq
    if (typeof this.parcel.id !== 'number') return
    const msg: messages.BehaviourStateMessage = {
      type: messages.MessageType.behaviourState,
      parcelId: this.parcel.id,
      featureId: inst.feature.uuid,
      behaviourIdx: inst.idx,
      state: { ...inst.state, __t0: inst.t0, __t1: inst.t1 } as Record<string, unknown>,
      seq: inst.seq,
    }
    window.connector?.send(msg)
  }

  private sendSignal(featureId: string, signal: string, data?: unknown): void {
    if (typeof this.parcel.id !== 'number') return
    const msg: messages.BehaviourSignalMessage = {
      type: messages.MessageType.behaviourSignal,
      parcelId: this.parcel.id,
      featureId,
      signal,
      data,
    }
    window.connector?.send(msg)
  }

  private findSlotsForSignal(featureId: string, signal: string): Array<{ inst: BehaviourInstance; slot: string }> {
    const out: Array<{ inst: BehaviourInstance; slot: string }> = []
    for (const inst of this.behaviours) {
      // Built-in: a feature's own dispatch ('click') runs same-named slots on its own behaviours, no wiring needed.
      if (inst.feature.uuid === featureId && inst.spec.slots[signal]) {
        out.push({ inst, slot: signal })
      }
      const conns: Connection[] = (inst.feature.description as any).connections ?? []
      for (const c of conns) {
        if (c.from.featureId === featureId && c.from.signal === signal && inst.spec.slots[c.slot]) {
          out.push({ inst, slot: c.slot })
        }
      }
    }
    return out
  }

  private runSlot(inst: BehaviourInstance, slot: string, data: unknown, depth: number): void {
    if (!this.engine) return
    const ns = `__spec_${inst.assetId.replace(/-/g, '_')}`
    this.installSelf(inst)
    this.currentDepth = depth
    try {
      this.engine.global.set('__slot_arg', data ?? null)
      this.engine.doStringSync(`if ${ns}.slots and ${ns}.slots.${slot} then ${ns}.slots.${slot}(${inst.selfName}, __slot_arg) end`)
      this.flushSelfWrites(inst)
    } catch (err) {
      console.error(`[behaviours] slot ${slot} on ${inst.feature.uuid}`, err)
    } finally {
      this.currentDepth = 0
    }
  }

  tick(): void {
    const now = Date.now()

    if (!this.engine) return
    for (const inst of this.behaviours) {
      if (!inst.spec.hasTick) continue
      if (now >= inst.t1) continue
      const dur = inst.t1 - inst.t0
      const t = dur <= 0 ? 1 : clamp01((now - inst.t0) / dur)
      const ns = `__spec_${inst.assetId.replace(/-/g, '_')}`
      this.installSelf(inst)
      try {
        this.engine.doStringSync(`${ns}.tick(${inst.selfName}, ${t})`)
        this.flushSelfWrites(inst)
      } catch (err) {
        console.error(`[behaviours] tick ${inst.assetId}`, err)
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.tickObserver?.remove()
    this.tickObserver = null
    try {
      this.engine?.global.close()
    } catch (err) {
      console.error('[behaviours] dispose', err)
    }
    this.engine = null
    this.behaviours = []
    this.byKey.clear()
  }
}
