// Lua behaviour runtime - one instance per parcel.
// Replaces ParcelScript. Loads wasmoon, evaluates the DSL prelude + each
// attached behaviour's source, runs init/tick/slot callbacks, syncs state
// over the multiplayer relay.

import { LuaEngine, LuaFactory } from 'wasmoon'
import * as messages from '../../common/messages'
import type { BehaviourAttachment, Connection } from '../../common/messages/feature'
import type Feature from '../features/feature'
import type Parcel from '../parcel'
import { DSL_PRELUDE } from './dsl'
import type { BehaviourMeta } from './parse-metadata'
import { parseBehaviourMeta } from './parse-metadata'
import { AnimateDesc, AnyDesc, isDesc, reanchorAnimate, resolveDesc, resolveRng } from './state'

type BehaviourSpec = {
  name: string
  state: Record<string, AnyDesc | unknown>
  params: Record<string, { default: unknown }>
  signals: string[]
  slots: Record<string, true>
  hasTick: boolean
}

type BehaviourInstance = {
  feature: Feature
  attachment: BehaviourAttachment
  idx: number
  assetId: string
  spec: BehaviourSpec
  state: Record<string, AnyDesc | unknown>
  selfName: string
  seq: number
}

type QueuedSignal = {
  featureId: string
  signal: string
  data?: unknown
  depth: number
}

const MAX_SIGNAL_DEPTH = 256
const TICK_BUDGET_MS = 4

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

export default class LuaBehaviours {
  parcel: Parcel
  engine: LuaEngine | null = null
  connected = false
  disposed = false
  private behaviours: BehaviourInstance[] = []
  private byKey: Map<string, BehaviourInstance> = new Map() // featureId:idx -> instance
  private queue: QueuedSignal[] = []
  private rafHandle: number | null = null
  private sessionToken = Math.random().toString(36).slice(2)
  private lastTickAt = 0
  private tickInterval = 0 // 0 = every frame; bumps to 33ms / 66ms under load
  private nextSeq = 1
  private currentDepth = 0

  constructor(parcel: Parcel) {
    this.parcel = parcel
  }

  async init(): Promise<void> {
    if (this.connected || this.disposed) return
    try {
      this.engine = await ensureFactory().createEngine({ injectObjects: true })
      this.engine.global.set('now', () => Date.now())
      await this.engine.doString(DSL_PRELUDE)
    } catch (err) {
      console.error('[behaviours] failed to create engine', err)
      return
    }

    // Load all behaviours attached to features in this parcel.
    const tasks: Promise<void>[] = []
    for (const feature of this.parcel.featuresList) {
      tasks.push(this.attachFeature(feature))
    }
    await Promise.allSettled(tasks)
    this.connected = true
    this.startRaf()
  }

  // Read attached behaviour assets for the feature, evaluate any not yet seen,
  // and create per-instance state/self bindings.
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
    // Already evaluated in this VM?
    const cached = this.engine.global.get(ns)
    if (cached) return cached as BehaviourSpec

    // Evaluate source (which calls behaviour "name" { ... } and pushes onto __behaviour_specs).
    await this.engine.doString(`__behaviour_specs = {}\n${source}\n${ns} = __behaviour_specs[1]`)
    const raw = this.engine.global.get(ns)
    if (!raw) throw new Error(`behaviour script for ${assetId} did not register`)

    const spec: BehaviourSpec = {
      name: meta.name,
      state: (raw as any).state ?? {},
      params: (raw as any).params ?? {},
      signals: meta.signals,
      slots: Object.fromEntries(meta.slots.map((s) => [s, true as const])),
      hasTick: typeof (raw as any).tick === 'function',
    }
    return spec
  }

  private async createInstance(feature: Feature, attachment: BehaviourAttachment, idx: number, spec: BehaviourSpec): Promise<void> {
    if (!this.engine) return
    const key = `${feature.uuid}:${idx}`
    const selfName = `__self_${key.replace(/[^A-Za-z0-9]/g, '_')}`

    // Per-instance state copy with rng resolved deterministically.
    const state: Record<string, AnyDesc | unknown> = {}
    for (const [k, v] of Object.entries(spec.state)) {
      state[k] = this.cloneAndResolveStateEntry(k, v as AnyDesc, feature.uuid)
    }

    const inst: BehaviourInstance = {
      feature,
      attachment,
      idx,
      assetId: attachment.id,
      spec,
      state,
      selfName,
      seq: 0,
    }
    this.behaviours.push(inst)
    this.byKey.set(key, inst)

    // Build the self table in Lua: state and params resolved, methods bound.
    const params = this.resolveParams(spec, attachment)
    const stateView = this.buildStateView(inst)

    // Install methods via a JS-backed "self" object the Lua side reads.
    this.engine.global.set(selfName, {
      params,
      state: stateView,
      play: (target: Record<string, unknown>) => this.handlePlay(inst, target),
      set: (target: Record<string, unknown>) => this.handleSet(inst, target),
      emit: (signal: string, data?: unknown) => this.handleEmit(inst, signal, data),
    })

    // Run init if defined.
    try {
      await this.engine.doString(`if type(__spec_${attachment.id.replace(/-/g, '_')}.init) == 'function' then __spec_${attachment.id.replace(/-/g, '_')}.init(${selfName}) end`)
    } catch (err) {
      console.error(`[behaviours] init failed ${attachment.id} on ${feature.uuid}`, err)
    }
  }

  // Resolve rng() at session boundary so all clients see the same number.
  private cloneAndResolveStateEntry(key: string, v: AnyDesc | unknown, featureId: string): AnyDesc | unknown {
    if (!isDesc(v)) return v
    if (v.__kind === 'rng') {
      const resolved = resolveRng(v.min, v.max, this.parcel.id, this.sessionToken, `${featureId}:${key}`)
      return { ...v, resolved }
    }
    if (v.__kind === 'persistent') {
      return { ...v, inner: this.cloneAndResolveStateEntry(key, v.inner, featureId) as AnyDesc }
    }
    return { ...v }
  }

  private resolveParams(spec: BehaviourSpec, attachment: BehaviourAttachment): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, def] of Object.entries(spec.params)) {
      out[k] = attachment.params?.[k] ?? def.default
    }
    return out
  }

  // Self.state proxy: reads return resolved values; the Lua side never sees descriptor objects.
  private buildStateView(inst: BehaviourInstance): Record<string, unknown> {
    const view: Record<string, unknown> = {}
    const now = Date.now()
    for (const [k, v] of Object.entries(inst.state)) {
      view[k] = resolveDesc(v as AnyDesc, now)
    }
    return view
  }

  // Refresh resolved view for an instance before calling Lua tick/slot.
  private refreshStateView(inst: BehaviourInstance, now: number): void {
    if (!this.engine) return
    const view = (this.engine.global.get(inst.selfName) as any)?.state
    if (!view) return
    for (const [k, v] of Object.entries(inst.state)) {
      view[k] = resolveDesc(v as AnyDesc, now)
    }
  }

  // self:play({ key = target }) - animate to target from current interpolated value.
  private handlePlay(inst: BehaviourInstance, target: Record<string, unknown>): void {
    const now = Date.now()
    for (const [k, v] of Object.entries(target)) {
      const current = inst.state[k]
      if (isDesc(current) && current.__kind === 'animate' && typeof v === 'number') {
        inst.state[k] = reanchorAnimate(current as AnimateDesc, now, v)
      } else if (isDesc(current) && current.__kind === 'value') {
        inst.state[k] = { __kind: 'value', value: v as any }
      } else {
        inst.state[k] = v as any
      }
    }
    this.broadcastState(inst)
  }

  // self:set({ key = val }) - instant assignment.
  private handleSet(inst: BehaviourInstance, target: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(target)) {
      const current = inst.state[k]
      if (isDesc(current) && current.__kind === 'value') {
        inst.state[k] = { __kind: 'value', value: v as any }
      } else {
        inst.state[k] = v as any
      }
    }
    this.broadcastState(inst)
  }

  private handleEmit(inst: BehaviourInstance, signal: string, data?: unknown): void {
    // Local fan-out: queue for all features in this parcel that have a connection
    // listening to (inst.feature.uuid, signal). Carry depth across hops.
    this.queue.push({ featureId: inst.feature.uuid, signal, data, depth: this.currentDepth + 1 })
    // Cross-feature delivery via MP (same parcel) so peers' runtimes also fire.
    this.sendSignal(inst.feature.uuid, signal, data)
  }

  // Public entry: external interactions (clicks, triggers) post a signal as if
  // the feature had emitted it. Slot connections handle local routing.
  dispatch(featureId: string, signal: string, data?: unknown): void {
    if (!this.connected) return
    this.queue.push({ featureId, signal, data, depth: 1 })
  }

  // Incoming MP signal from a peer.
  onSignal(featureId: string, signal: string, data?: unknown): void {
    if (!this.connected) return
    this.queue.push({ featureId, signal, data, depth: 1 })
  }

  // Incoming MP state update from a peer - last-write-wins via seq.
  onStateUpdate(featureId: string, idx: number, state: Record<string, unknown>, seq: number): void {
    const inst = this.byKey.get(`${featureId}:${idx}`)
    if (!inst) return
    if (seq <= inst.seq) return
    inst.seq = seq
    Object.assign(inst.state, state)
  }

  private broadcastState(inst: BehaviourInstance): void {
    inst.seq = ++this.nextSeq
    if (typeof this.parcel.id !== 'number') return // spaces use string ids - skip MP for now
    const msg: messages.BehaviourStateMessage = {
      type: messages.MessageType.behaviourState,
      parcelId: this.parcel.id,
      featureId: inst.feature.uuid,
      behaviourIdx: inst.idx,
      state: inst.state as Record<string, unknown>,
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

  // Walk every feature's incoming connections and find slots listening to (featureId, signal).
  private findSlotsForSignal(featureId: string, signal: string): Array<{ inst: BehaviourInstance; slot: string }> {
    const out: Array<{ inst: BehaviourInstance; slot: string }> = []
    for (const inst of this.behaviours) {
      const conns: Connection[] = (inst.feature.description as any).connections ?? []
      for (const c of conns) {
        if (c.from.featureId === featureId && c.from.signal === signal && inst.spec.slots[c.slot]) {
          out.push({ inst, slot: c.slot })
        }
      }
    }
    return out
  }

  private async runSlot(inst: BehaviourInstance, slot: string, data: unknown, depth: number): Promise<void> {
    if (!this.engine) return
    const ns = `__spec_${inst.assetId.replace(/-/g, '_')}`
    this.refreshStateView(inst, Date.now())
    this.currentDepth = depth
    try {
      this.engine.global.set('__slot_arg', data ?? null)
      await this.engine.doString(`if ${ns}.slots and ${ns}.slots.${slot} then ${ns}.slots.${slot}(${inst.selfName}, __slot_arg) end`)
    } catch (err) {
      console.error(`[behaviours] slot ${slot} on ${inst.feature.uuid}`, err)
    } finally {
      this.currentDepth = 0
    }
  }

  private async flushQueue(): Promise<void> {
    const batch = this.queue
    this.queue = []
    for (const item of batch) {
      if (item.depth >= MAX_SIGNAL_DEPTH) {
        console.warn('[behaviours] dropping signal at depth', item.depth)
        continue
      }
      const targets = this.findSlotsForSignal(item.featureId, item.signal)
      for (const { inst, slot } of targets) {
        await this.runSlot(inst, slot, item.data, item.depth)
      }
    }
  }

  private startRaf(): void {
    const tick = (now: number) => {
      if (this.disposed) return
      if (now - this.lastTickAt >= this.tickInterval) {
        const start = performance.now()
        this.flushQueue().catch((err) => console.error('[behaviours] flush', err))
        this.runTicks(now)
        const elapsed = performance.now() - start
        // Adaptive: above budget, slow tick rate; below, ramp back up.
        if (elapsed > TICK_BUDGET_MS) {
          this.tickInterval = this.tickInterval === 0 ? 33 : this.tickInterval === 33 ? 66 : 66
        } else if (elapsed < TICK_BUDGET_MS / 2 && this.tickInterval > 0) {
          this.tickInterval = this.tickInterval === 66 ? 33 : 0
        }
        this.lastTickAt = now
      }
      this.rafHandle = requestAnimationFrame(tick)
    }
    this.rafHandle = requestAnimationFrame(tick)
  }

  private runTicks(now: number): void {
    if (!this.engine) return
    for (const inst of this.behaviours) {
      if (!inst.spec.hasTick) continue
      this.refreshStateView(inst, now)
      const ns = `__spec_${inst.assetId.replace(/-/g, '_')}`
      try {
        this.engine.doStringSync(`${ns}.tick(${inst.selfName})`)
      } catch (err) {
        console.error(`[behaviours] tick ${inst.assetId}`, err)
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.connected = false
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle)
    this.rafHandle = null
    try {
      this.engine?.global.close()
    } catch (err) {
      console.error('[behaviours] dispose', err)
    }
    this.engine = null
    this.behaviours = []
    this.byKey.clear()
    this.queue = []
  }
}
