import { throttle } from 'lodash'
import { Component, createRef } from 'preact'
import Feature from '../../../../src/features/feature'
import type { BehaviourAttachment, Connection } from '../../../../common/messages/feature'
import CodeFlask from '../../../../vendor/codeflask/codeflask'
import 'prismjs/components/prism-lua'
import { app } from '../../state'

type BehaviourAssetMeta = {
  id: string
  name: string
  signals: string[]
  slots: string[]
  params: Array<{ name: string; type: 'number' | 'string' | 'boolean'; default: number | string | boolean; min?: number; max?: number; step?: number }>
  script: string
}

type BehavioursState = {
  attached: BehaviourAttachment[]
  metas: Record<string, BehaviourAssetMeta>
  expanded: Record<number, boolean>
  editing: number | null
  attachOpen: boolean
  attachInput: string
  parcelMetas: Map<string, BehaviourAssetMeta> // assetId -> meta for ALL behaviours used anywhere in this parcel
}

const fetchAssetMeta = async (id: string): Promise<BehaviourAssetMeta | null> => {
  try {
    const r = await fetch(`/api/library/asset/${id}`, { method: 'POST', credentials: 'include' })
    if (!r.ok) return null
    const j: any = await r.json()
    const c = j?.asset?.content?.[0] ?? j?.content?.[0]
    if (!c) return null
    return {
      id,
      name: j?.asset?.name ?? j?.name ?? id,
      signals: c.signals ?? [],
      slots: c.slots ?? [],
      params: c.params ?? [],
      script: c.script ?? '',
    }
  } catch {
    return null
  }
}

export class Behaviours extends Component<{ feature: Feature }, BehavioursState> {
  state: BehavioursState = {
    attached: [],
    metas: {},
    expanded: {},
    editing: null,
    attachOpen: false,
    attachInput: '',
    parcelMetas: new Map(),
  }

  async componentDidMount() {
    const attached: BehaviourAttachment[] = (this.props.feature.description as any).behaviours ?? []
    this.setState({ attached })
    const metas: Record<string, BehaviourAssetMeta> = {}
    for (const att of attached) {
      const m = await fetchAssetMeta(att.id)
      if (m) metas[att.id] = m
    }
    // Also gather metas for every behaviour used anywhere in the parcel - drives the wiring dropdowns.
    const parcelMetas = await this.collectParcelMetas()
    this.setState({ metas, parcelMetas })
  }

  private async collectParcelMetas(): Promise<Map<string, BehaviourAssetMeta>> {
    const acc = new Map<string, BehaviourAssetMeta>()
    const seen = new Set<string>()
    for (const f of this.props.feature.parcel.featuresList) {
      const list: BehaviourAttachment[] = (f.description as any).behaviours ?? []
      for (const a of list) {
        if (seen.has(a.id)) continue
        seen.add(a.id)
        const m = await fetchAssetMeta(a.id)
        if (m) acc.set(a.id, m)
      }
    }
    return acc
  }

  private save() {
    this.props.feature.set({ behaviours: this.state.attached } as any)
  }

  private toggle(idx: number) {
    this.setState({ expanded: { ...this.state.expanded, [idx]: !this.state.expanded[idx] } })
  }

  private remove(idx: number) {
    const attached = this.state.attached.slice()
    attached.splice(idx, 1)
    this.setState({ attached })
    this.props.feature.set({ behaviours: attached } as any)
  }

  private async attach() {
    const id = this.state.attachInput.trim()
    if (!id) return
    const meta = await fetchAssetMeta(id)
    if (!meta) {
      alert('behaviour not found')
      return
    }
    const params: Record<string, number | string | boolean> = {}
    for (const p of meta.params) params[p.name] = p.default
    const attached = [...this.state.attached, { id, params }]
    this.setState({
      attached,
      metas: { ...this.state.metas, [id]: meta },
      attachInput: '',
      attachOpen: false,
    })
    this.props.feature.set({ behaviours: attached } as any)
  }

  private async createNew() {
    const name = prompt('behaviour name?')
    if (!name) return
    const stub = `behaviour "${name}" {\n  params = {},\n  state = {},\n  signals = {},\n  slots = {},\n}\n`
    const body = {
      type: 'behaviour',
      author: app.state.wallet ?? '',
      category: 'random',
      name,
      description: '',
      public: false,
      image_url: '/img/blank.png',
      content: [{ script: stub, signals: [], slots: [], params: [] }],
    }
    const r = await fetch('/api/library/add', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j: any = await r.json()
    if (!j?.success || !j?.id) {
      alert('could not create behaviour: ' + (j?.message || 'unknown'))
      return
    }
    this.setState({ attachInput: j.id }, () => this.attach())
  }

  private setParam(idx: number, name: string, value: number | string | boolean) {
    const attached = this.state.attached.slice()
    attached[idx] = { ...attached[idx], params: { ...attached[idx].params, [name]: value } }
    this.setState({ attached })
    if (!this.throttledSave) this.throttledSave = throttle(() => this.save(), 200, { trailing: true })
    this.throttledSave()
  }
  private throttledSave?: () => void

  private addConnectionToFeature(targetFeature: Feature, conn: Connection) {
    const cur: Connection[] = ((targetFeature.description as any).connections ?? []).slice()
    cur.push(conn)
    targetFeature.set({ connections: cur } as any)
  }

  private removeConnectionFromFeature(targetFeature: Feature, predicate: (c: Connection) => boolean) {
    const cur: Connection[] = ((targetFeature.description as any).connections ?? []).slice()
    const next = cur.filter((c) => !predicate(c))
    targetFeature.set({ connections: next } as any)
  }

  private allOtherFeatures(): Feature[] {
    return this.props.feature.parcel.featuresList.filter((f) => f.uuid !== this.props.feature.uuid)
  }

  private allSlotTargets(): Array<{ feature: Feature; behaviourIdx: number; slot: string; assetId: string }> {
    const out: Array<{ feature: Feature; behaviourIdx: number; slot: string; assetId: string }> = []
    for (const f of this.props.feature.parcel.featuresList) {
      const list: BehaviourAttachment[] = (f.description as any).behaviours ?? []
      list.forEach((att, idx) => {
        const meta = this.state.parcelMetas.get(att.id)
        if (!meta) return
        for (const slot of meta.slots) out.push({ feature: f, behaviourIdx: idx, slot, assetId: att.id })
      })
    }
    return out
  }

  private allSignalSources(): Array<{ feature: Feature; signal: string }> {
    const out: Array<{ feature: Feature; signal: string }> = []
    for (const f of this.allOtherFeatures()) {
      const list: BehaviourAttachment[] = (f.description as any).behaviours ?? []
      for (const att of list) {
        const meta = this.state.parcelMetas.get(att.id)
        if (!meta) continue
        for (const sig of meta.signals) out.push({ feature: f, signal: sig })
      }
    }
    return out
  }

  private connectionsForThisFeature(): Connection[] {
    return ((this.props.feature.description as any).connections ?? []) as Connection[]
  }

  private outboundConnections(): Array<{ targetFeature: Feature; conn: Connection }> {
    // Connections where some other feature's `from.featureId === this.uuid`.
    const out: Array<{ targetFeature: Feature; conn: Connection }> = []
    for (const f of this.allOtherFeatures()) {
      const conns: Connection[] = (f.description as any).connections ?? []
      for (const c of conns) {
        if (c.from.featureId === this.props.feature.uuid) out.push({ targetFeature: f, conn: c })
      }
    }
    return out
  }

  render() {
    const { attached, metas, expanded } = this.state
    return (
      <div className="behaviours">
        <label>behaviours</label>
        {attached.length === 0 && <small>no behaviours attached</small>}
        {attached.map((att, idx) => {
          const meta = metas[att.id]
          const open = !!expanded[idx]
          return (
            <div className="behaviour-row" key={att.id + ':' + idx}>
              <div className="f">
                <button onClick={() => this.toggle(idx)}>{open ? '-' : '+'}</button>
                <strong>{meta?.name || att.id.slice(0, 8)}</strong>
                <button onClick={() => this.setState({ editing: this.state.editing === idx ? null : idx })}>edit</button>
                <button onClick={() => this.remove(idx)}>x</button>
              </div>
              {open && meta && this.renderExpanded(att, idx, meta)}
              {this.state.editing === idx && meta && <BehaviourScriptEditor meta={meta} />}
            </div>
          )
        })}
        <div className="f">
          <button onClick={() => this.setState({ attachOpen: !this.state.attachOpen })}>+ attach</button>
          <button onClick={() => this.createNew()}>+ new</button>
        </div>
        {this.state.attachOpen && (
          <div className="f">
            <input type="text" placeholder="behaviour asset uuid" value={this.state.attachInput} onInput={(e) => this.setState({ attachInput: e.currentTarget.value })} />
            <button onClick={() => this.attach()}>attach</button>
          </div>
        )}
      </div>
    )
  }

  private renderExpanded(att: BehaviourAttachment, idx: number, meta: BehaviourAssetMeta) {
    const incoming = this.connectionsForThisFeature()
    const outgoing = this.outboundConnections()
    return (
      <div className="behaviour-expanded">
        {meta.params.length > 0 && (
          <div className="behaviour-params">
            <small>params</small>
            {meta.params.map((p) => this.renderParam(att, idx, p))}
          </div>
        )}
        {meta.signals.length > 0 && (
          <div className="behaviour-signals">
            <small>signals</small>
            {meta.signals.map((sig) =>
              this.renderSignalRow(
                sig,
                outgoing.filter((o) => o.conn.from.signal === sig),
              ),
            )}
          </div>
        )}
        {meta.slots.length > 0 && (
          <div className="behaviour-slots">
            <small>slots</small>
            {meta.slots.map((slot) =>
              this.renderSlotRow(
                slot,
                incoming.filter((c) => c.slot === slot),
              ),
            )}
          </div>
        )}
      </div>
    )
  }

  private renderParam(att: BehaviourAttachment, idx: number, p: BehaviourAssetMeta['params'][number]) {
    const v = att.params?.[p.name] ?? p.default
    if (p.type === 'boolean') {
      return (
        <div className="f" key={p.name}>
          <label>{p.name}</label>
          <input type="checkbox" checked={!!v} onChange={(e) => this.setParam(idx, p.name, e.currentTarget.checked)} />
        </div>
      )
    }
    if (p.type === 'number') {
      return (
        <div className="f" key={p.name}>
          <label>{p.name}</label>
          <input type="number" value={Number(v)} min={p.min} max={p.max} step={p.step ?? 1} onInput={(e) => this.setParam(idx, p.name, Number(e.currentTarget.value))} />
        </div>
      )
    }
    return (
      <div className="f" key={p.name}>
        <label>{p.name}</label>
        <input type="text" value={String(v)} onInput={(e) => this.setParam(idx, p.name, e.currentTarget.value)} />
      </div>
    )
  }

  private renderSignalRow(signal: string, existing: Array<{ targetFeature: Feature; conn: Connection }>) {
    return (
      <div className="f" key={signal}>
        <label>{signal}</label>
        {existing.map(({ targetFeature, conn }) => (
          <span>
            -&gt; {targetFeature.description.id || targetFeature.uuid.slice(0, 6)}/{conn.slot}
            <button onClick={() => this.removeConnectionFromFeature(targetFeature, (c) => c.from.featureId === this.props.feature.uuid && c.from.signal === signal && c.slot === conn.slot)}>x</button>
          </span>
        ))}
        <select
          onChange={(e) => {
            const val = e.currentTarget.value
            if (!val) return
            const [featureUuid, slot] = val.split('|')
            const target = this.props.feature.parcel.featuresList.find((f) => f.uuid === featureUuid)
            if (!target) return
            this.addConnectionToFeature(target, { from: { featureId: this.props.feature.uuid, signal }, slot })
            e.currentTarget.value = ''
          }}
        >
          <option value="">connect to slot...</option>
          {this.allSlotTargets().map((t) => (
            <option value={`${t.feature.uuid}|${t.slot}`}>
              {t.feature.description.id || t.feature.uuid.slice(0, 6)} / {t.slot}
            </option>
          ))}
        </select>
      </div>
    )
  }

  private renderSlotRow(slot: string, existing: Connection[]) {
    return (
      <div className="f" key={slot}>
        <label>{slot}</label>
        {existing.map((c) => {
          const fromFeature = this.props.feature.parcel.featuresList.find((f) => f.uuid === c.from.featureId)
          return (
            <span>
              &lt;- {fromFeature?.description.id || c.from.featureId.slice(0, 6)}/{c.from.signal}
              <button onClick={() => this.removeConnectionFromFeature(this.props.feature, (cc) => cc.from.featureId === c.from.featureId && cc.from.signal === c.from.signal && cc.slot === slot)}>x</button>
            </span>
          )
        })}
        <select
          onChange={(e) => {
            const val = e.currentTarget.value
            if (!val) return
            const [featureUuid, signal] = val.split('|')
            this.addConnectionToFeature(this.props.feature, { from: { featureId: featureUuid, signal }, slot })
            e.currentTarget.value = ''
          }}
        >
          <option value="">connect from signal...</option>
          {this.allSignalSources().map((s) => (
            <option value={`${s.feature.uuid}|${s.signal}`}>
              {s.feature.description.id || s.feature.uuid.slice(0, 6)} / {s.signal}
            </option>
          ))}
        </select>
      </div>
    )
  }
}

class BehaviourScriptEditor extends Component<{ meta: BehaviourAssetMeta }> {
  containerRef = createRef<HTMLDivElement>()
  flask: CodeFlask | null = null

  componentDidMount() {
    if (!this.containerRef.current) return
    this.flask = new CodeFlask(this.containerRef.current, { language: 'lua', lineNumbers: false, defaultTheme: true, readonly: false })
    this.flask.updateCode(this.props.meta.script)
    const save = throttle(
      async (code: string) => {
        await fetch('/api/library/update', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: this.props.meta.id, script: code }),
        }).catch(() => {})
      },
      800,
      { trailing: true },
    )
    this.flask.onUpdate((code) => {
      this.props.meta.script = code
      save(code)
    })
  }

  render() {
    return (
      <div className="behaviour-script-editor">
        <div className="codeflask-container" ref={this.containerRef} />
      </div>
    )
  }
}
