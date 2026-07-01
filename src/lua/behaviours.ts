// Lua behaviour runtime - one instance per parcel.
// Behaviours act on their own feature only. A feature event (e.g. 'click') runs the
// matching on<Event> method on that feature's behaviours; self:animate("name", ms)
// plays a named method with t in [0,1] until now >= t1; self:emit fires an event on
// the same feature. Animation state syncs to peers; no cross-feature wiring (yet).

import { LuaEngine, LuaFactory } from 'wasmoon'
import * as messages from '../../common/messages'
import type { Behaviour } from '../../common/messages/feature'
import type Feature from '../features/feature'
import type Parcel from '../parcel'
import { DSL_PRELUDE } from './dsl'
import { clamp01 } from './state'

type BehaviourInstance = {
  feature: Feature
  behave: Behaviour
  idx: number
  specKey: string
  state: Record<string, unknown>
  selfName: string
  anim: string | null
  seq: number
  t0: number
  t1: number
}

const MAX_SIGNAL_DEPTH = 256
const TICK_BUDGET_MS = 4
const RAD_PER_DEG = Math.PI / 180
const DEG_PER_RAD = 180 / Math.PI

// Stable namespace key from inline source - identical code shares one compiled spec.
const hash = (s: string): string => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

let factory: LuaFactory | null = null

const ensureFactory = (): LuaFactory => {
  if (!factory) factory = new LuaFactory()
  return factory
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
  connected = false
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

  async init(features?: Feature[]): Promise<void> {
    if (this.disposed || this.connected) return
    try {
      this.engine = await ensureFactory().createEngine({ injectObjects: true })
      this.engine.global.set('now', () => Date.now())
      await this.engine.doString(DSL_PRELUDE)
    } catch (err) {
      console.error('[behaviours] failed to create engine', err)
      return
    }

    for (const feature of features ?? this.parcel.featuresList) {
      await this.attachFeature(feature)
    }

    this.startTicker()
    this.connected = true
  }

  // Drive tick() off the scene render loop. Adaptive: back off to 30/15Hz when a
  // tick blows the per-frame budget, recover when it's cheap again.
  private startTicker(): void {
    if (this.tickObserver) return
    const scene = this.parcel.scene
    if (!scene) return
    const obs = scene.onBeforeRenderObservable.add(() => {
      const now = Date.now()
      if (this.tickInterval && now - this.lastTickAt < this.tickInterval) return
      this.lastTickAt = now
      this.tick()
      const cost = Date.now() - now
      if (cost > TICK_BUDGET_MS) this.tickInterval = this.tickInterval === 0 ? 33 : 66
      else if (cost < TICK_BUDGET_MS / 2) this.tickInterval = this.tickInterval === 66 ? 33 : 0
    })
    this.tickObserver = { remove: () => scene.onBeforeRenderObservable.remove(obs) }
  }

  async attachFeature(feature: Feature): Promise<void> {
    if (!this.engine) return
    const list: Behaviour[] = (feature.description as any).behave ?? []
    for (let idx = 0; idx < list.length; idx++) {
      const b = list[idx]
      try {
        const specKey = hash(b.code)
        await this.ensureCompiled(specKey, b.code)
        await this.createInstance(feature, b, idx, specKey)
      } catch (err) {
        console.error(`[behaviours] attach ${b.name} on ${feature.uuid}`, err)
      }
    }
  }

  // Drop this feature's instances and rebuild them from its current behave list.
  // Called by the editor when behaviours are added/edited/removed live.
  async reattachFeature(feature: Feature): Promise<void> {
    this.behaviours = this.behaviours.filter((inst) => inst.feature.uuid !== feature.uuid)
    for (const key of [...this.byKey.keys()]) if (key.startsWith(`${feature.uuid}:`)) this.byKey.delete(key)
    await this.attachFeature(feature)
  }

  // Compile the script once per unique source: run it as an IIFE and stash its
  // explicit `return Spec` table in global __spec_<key>, live for method calls.
  private async ensureCompiled(specKey: string, source: string): Promise<void> {
    if (!this.engine) throw new Error('no engine')
    const ns = `__spec_${specKey}`
    if (this.engine.global.get(ns)) return
    await this.engine.doString(`${ns} = (function()\n${source}\nend)()`)
    if (!this.engine.global.get(ns)) throw new Error(`behaviour script ${specKey} returned nothing`)
  }

  private async createInstance(feature: Feature, behave: Behaviour, idx: number, specKey: string): Promise<void> {
    if (!this.engine) return
    const key = `${feature.uuid}:${idx}`
    const selfName = `__self_${key.replace(/[^A-Za-z0-9]/g, '_')}`

    // Initial state from the spec's `state` prototype table; deep-clone it so nested
    // tables aren't shared across instances of the same behaviour.
    const protoState = (this.engine.global.get(`__spec_${specKey}`) as any)?.state ?? {}
    const state = deepClone(protoState) as Record<string, unknown>

    const inst: BehaviourInstance = {
      feature,
      behave,
      idx,
      specKey,
      state,
      selfName,
      anim: null,
      seq: 0,
      t0: 0,
      t1: 0,
    }
    this.behaviours.push(inst)
    this.byKey.set(key, inst)

    this.installSelf(inst)

    try {
      const ns = `__spec_${specKey}`
      await this.engine.doString(`if type(${ns}.init) == 'function' then ${ns}.init(${selfName}) end`)
    } catch (err) {
      console.error(`[behaviours] init failed ${behave.name} on ${feature.uuid}`, err)
    }
  }

  // (Re)install the per-instance self table. Called once at create + every tick to refresh proxies.
  private installSelf(inst: BehaviourInstance): void {
    if (!this.engine) return
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
      state: inst.state,
      position,
      rotation,
      visible: feature.mesh?.isEnabled() ?? true,
      animate: (name: string, ms: number) => this.handleAnimate(inst, name, ms),
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

  // self:animate("name", ms) - play the named method over ms, stamp t0/t1, broadcast.
  private handleAnimate(inst: BehaviourInstance, name: string, ms: number): void {
    inst.anim = String(name).replace(/[^A-Za-z0-9_]/g, '')
    const now = Date.now()
    inst.t0 = now
    inst.t1 = now + Math.max(0, Number(ms) || 0)
    this.broadcastState(inst)
  }

  // Run on<signal> for every behaviour on this one feature. No cross-feature wiring.
  private dispatchSync(featureId: string, signal: string, data: unknown, depth: number): void {
    if (depth >= MAX_SIGNAL_DEPTH) {
      console.warn('[behaviours] dropping signal at depth', depth)
      return
    }
    for (const inst of this.behaviours) {
      if (inst.feature.uuid === featureId) this.runSlot(inst, signal, data, depth)
    }
  }

  private handleEmit(inst: BehaviourInstance, signal: string, data?: unknown): void {
    this.dispatchSync(inst.feature.uuid, signal, data, this.currentDepth + 1)
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
    const { __t0, __t1, __anim, ...rest } = payload as any
    Object.assign(inst.state, rest)
    if (typeof __t0 === 'number') inst.t0 = __t0
    if (typeof __t1 === 'number') inst.t1 = __t1
    if (typeof __anim === 'string') inst.anim = __anim
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
      state: { ...inst.state, __t0: inst.t0, __t1: inst.t1, __anim: inst.anim } as Record<string, unknown>,
      seq: inst.seq,
    }
    window.connector?.send(msg)
  }

  private runSlot(inst: BehaviourInstance, slot: string, data: unknown, depth: number): void {
    if (!this.engine) return
    const ns = `__spec_${inst.specKey}`
    const fn = `${ns}.on${slot.replace(/[^A-Za-z0-9_]/g, '')}`
    this.installSelf(inst)
    this.currentDepth = depth
    try {
      this.engine.global.set('__slot_arg', data ?? null)
      this.engine.doStringSync(`if type(${fn}) == 'function' then ${fn}(${inst.selfName}, __slot_arg) end`)
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
      if (!inst.anim) continue
      const dur = inst.t1 - inst.t0
      const done = now >= inst.t1
      const t = done || dur <= 0 ? 1 : clamp01((now - inst.t0) / dur)
      const fn = `__spec_${inst.specKey}.${inst.anim.replace(/[^A-Za-z0-9_]/g, '')}`
      this.installSelf(inst)
      try {
        this.engine.doStringSync(`if type(${fn}) == 'function' then ${fn}(${inst.selfName}, ${t}) end`)
        this.flushSelfWrites(inst)
      } catch (err) {
        console.error(`[behaviours] anim ${inst.anim}`, err)
      }
      if (done) inst.anim = null
    }
  }

  dispose(): void {
    this.disposed = true
    this.connected = false
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
