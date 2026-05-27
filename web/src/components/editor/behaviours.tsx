import { throttle } from 'lodash'
import * as luaparse from 'luaparse'
import { Component, createRef } from 'preact'
import Feature from '../../../../src/features/feature'
import type { BehaviourAttachment, Connection } from '../../../../common/messages/feature'
import CodeFlask from '../../../../vendor/codeflask/codeflask'
import 'prismjs/components/prism-lua'
import { app } from '../../state'

type ParseError = { message: string; line?: number; column?: number }

const validateLua = (code: string): ParseError | null => {
  try {
    luaparse.parse(code)
    return null
  } catch (err: any) {
    return { message: err?.message ?? String(err), line: err?.line, column: err?.column }
  }
}

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
      description: name,
      public: false,
      image_url: '/img/blank.png',
      content: [{ script: stub, signals: [], slots: [], params: [] }],
    }
    let r: Response
    try {
      r = await fetch('/api/library/add', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err: any) {
      alert('could not create behaviour: ' + (err?.message || 'network error'))
      return
    }
    let j: any = null
    try {
      j = await r.json()
    } catch {}
    if (!r.ok || !j?.success || !j?.id) {
      alert('could not create behaviour (' + r.status + '): ' + (j?.message || j?.err?.message || 'unknown'))
      return
    }
    // Skip the round-trip; we already know everything about the freshly-made stub.
    const meta: BehaviourAssetMeta = { id: j.id, name, signals: [], slots: [], params: [], script: stub }
    const params: Record<string, number | string | boolean> = {}
    const attached = [...this.state.attached, { id: j.id, params }]
    const idx = attached.length - 1
    this.setState({
      attached,
      metas: { ...this.state.metas, [j.id]: meta },
      parcelMetas: new Map(this.state.parcelMetas).set(j.id, meta),
      attachOpen: false,
      attachInput: '',
      editing: idx,
    })
    this.props.feature.set({ behaviours: attached } as any)
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
                <button onClick={() => this.setState({ editing: idx })}>edit</button>
                <button onClick={() => this.remove(idx)}>x</button>
              </div>
              {open && meta && this.renderExpanded(att, idx, meta)}
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
        {this.state.editing != null && this.state.attached[this.state.editing] && metas[this.state.attached[this.state.editing].id] && (
          <BehaviourScriptModal
            meta={metas[this.state.attached[this.state.editing].id]}
            onClose={() => this.setState({ editing: null })}
            onMetaUpdated={(m) =>
              this.setState({
                metas: { ...this.state.metas, [m.id]: m },
                parcelMetas: new Map(this.state.parcelMetas).set(m.id, m),
              })
            }
          />
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

type ModalProps = { meta: BehaviourAssetMeta; onClose: () => void; onMetaUpdated: (m: BehaviourAssetMeta) => void }
type ModalState = { status: string; agentPrompt: string; agentBusy: boolean; history: string[]; future: string[]; parseError: ParseError | null }

class BehaviourScriptModal extends Component<ModalProps, ModalState> {
  containerRef = createRef<HTMLDivElement>()
  flask: CodeFlask | null = null
  save: (code: string) => void = () => {}
  state: ModalState = { status: '', agentPrompt: '', agentBusy: false, history: [], future: [], parseError: null }

  componentDidMount() {
    if (!this.containerRef.current) return
    this.flask = new CodeFlask(this.containerRef.current, { language: 'lua', lineNumbers: true, defaultTheme: true, readonly: false })
    this.flask.updateCode(this.props.meta.script)
    this.setState({ parseError: validateLua(this.props.meta.script) })
    this.save = throttle(
      async (code: string) => {
        // Don't push broken Lua to the server - it'll just bounce off the AST validator there too.
        if (validateLua(code)) {
          this.setState({ status: '' })
          return
        }
        this.setState({ status: 'saving...' })
        let r: Response
        try {
          r = await fetch('/api/library/update', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: this.props.meta.id, script: code }),
          })
        } catch (e: any) {
          this.setState({ status: 'offline' })
          return
        }
        let j: any = null
        try {
          j = await r.json()
        } catch {}
        if (!r.ok || j?.success === false) {
          this.setState({ status: 'error: ' + (j?.message || r.status) })
          return
        }
        this.setState({ status: 'saved' })
        const fresh = await fetchAssetMeta(this.props.meta.id)
        if (fresh) {
          this.props.meta.signals = fresh.signals
          this.props.meta.slots = fresh.slots
          this.props.meta.params = fresh.params
          this.props.meta.script = fresh.script
          this.props.onMetaUpdated(fresh)
        }
      },
      800,
      { trailing: true },
    )
    this.flask.onUpdate((code) => {
      this.props.meta.script = code
      this.setState({ parseError: validateLua(code) })
      this.save(code)
    })
  }

  componentWillUnmount() {
    this.flask = null
  }

  // Push current source to history before replacing it. Used by agent + undo/redo.
  private replaceCode(next: string, side: 'history' | 'future') {
    if (!this.flask) return
    const current = this.props.meta.script
    if (next === current) return
    if (side === 'history') {
      this.setState({ history: [...this.state.history, current], future: [] })
    } else {
      this.setState({ future: [...this.state.future, current] })
    }
    this.props.meta.script = next
    this.flask.updateCode(next)
    this.setState({ parseError: validateLua(next) })
    this.save(next)
  }

  private undo = () => {
    const hist = this.state.history.slice()
    const prev = hist.pop()
    if (prev === undefined || !this.flask) return
    const current = this.props.meta.script
    this.setState({ history: hist, future: [...this.state.future, current] })
    this.props.meta.script = prev
    this.flask.updateCode(prev)
    this.setState({ parseError: validateLua(prev) })
    this.save(prev)
  }

  private redo = () => {
    const fut = this.state.future.slice()
    const next = fut.pop()
    if (next === undefined || !this.flask) return
    const current = this.props.meta.script
    this.setState({ future: fut, history: [...this.state.history, current] })
    this.props.meta.script = next
    this.flask.updateCode(next)
    this.setState({ parseError: validateLua(next) })
    this.save(next)
  }

  private askAgent = async () => {
    const prompt = this.state.agentPrompt.trim()
    if (!prompt || this.state.agentBusy) return
    this.setState({ agentBusy: true, status: 'thinking...' })
    let r: Response
    try {
      r = await fetch('/api/models/behaviour', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, script: this.props.meta.script }),
      })
    } catch (e: any) {
      this.setState({ agentBusy: false, status: 'agent offline' })
      return
    }
    let j: any = null
    try {
      j = await r.json()
    } catch {}
    if (!r.ok || !j?.script) {
      this.setState({ agentBusy: false, status: 'agent failed: ' + (j?.error || r.status) })
      return
    }
    this.replaceCode(j.script, 'history')
    this.setState({ agentBusy: false, agentPrompt: '', status: 'agent applied' })
  }

  render() {
    const err = this.state.parseError
    const overlay = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' } as any
    const win = { width: '80vw', height: '80vh', background: '#222', display: 'flex', flexDirection: 'column' } as any
    const bar = { padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#eee', borderBottom: '1px solid #333' } as any
    const grow = { flex: 1, minWidth: 0 } as any
    const promptInput = { flex: 1, minWidth: '12rem' } as any
    const bodyStyle = { flex: 1, minHeight: 0, position: 'relative', boxShadow: err ? 'inset 0 0 0 2px #c0392b' : 'none' } as any
    const codeStyle = { position: 'absolute', inset: 0 } as any
    const errBar = { padding: '0.25rem 1rem', background: '#3a1816', color: '#f5b7b1', fontFamily: 'monospace', fontSize: '0.85rem' } as any
    const canUndo = this.state.history.length > 0
    const canRedo = this.state.future.length > 0
    return (
      <div style={overlay} onClick={() => this.props.onClose()}>
        <div style={win} onClick={(e) => e.stopPropagation()}>
          <div style={bar}>
            <strong>{this.props.meta.name}.lua</strong>
            <button onClick={this.undo} disabled={!canUndo} title="undo last agent edit">
              {'<'} undo
            </button>
            <button onClick={this.redo} disabled={!canRedo} title="redo">
              redo {'>'}
            </button>
            <input
              style={promptInput}
              type="text"
              placeholder="ask the agent... (e.g. 'add an unlock slot')"
              value={this.state.agentPrompt}
              disabled={this.state.agentBusy}
              onInput={(e) => this.setState({ agentPrompt: e.currentTarget.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') this.askAgent()
              }}
            />
            <button onClick={this.askAgent} disabled={this.state.agentBusy || !this.state.agentPrompt.trim()}>
              ask
            </button>
            <span style={grow} />
            <small>{this.state.status}</small>
            <button onClick={() => this.props.onClose()}>close</button>
          </div>
          {err && (
            <div style={errBar}>
              syntax error{err.line != null ? ` [${err.line}:${err.column ?? 0}]` : ''}: {err.message.replace(/^\[\d+:\d+\]\s*/, '')}
            </div>
          )}
          <div style={bodyStyle}>
            <div style={codeStyle} ref={this.containerRef} />
          </div>
        </div>
      </div>
    )
  }
}
