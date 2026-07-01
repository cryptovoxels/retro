import { throttle } from 'lodash'
import * as luaparse from 'luaparse'
import { Component, createRef, Fragment } from 'preact'
import Feature from '../../../../src/features/feature'
import type { Behaviour } from '../../../../common/messages/feature'
import { BEHAVIOUR_PRESETS } from '../../../../src/lua/presets'
import CodeFlask from '../../../../vendor/codeflask/codeflask'
import 'prismjs/components/prism-lua'

type ParseError = { message: string; line?: number; column?: number }

const validateLua = (code: string): ParseError | null => {
  try {
    luaparse.parse(code)
    return null
  } catch (err: any) {
    return { message: err?.message ?? String(err), line: err?.line, column: err?.column }
  }
}

const stub = (name: string) => `local B = Behave.new("${name}")
B.state = {}

function B:spin(t)
  self.rotation.y = t * 360
end

function B:onclick()
  self:animate("spin", 1000)
end

return B
`

type BehavioursState = {
  behave: Behaviour[]
  editing: number | null
  addOpen: boolean
}

export class Behaviours extends Component<{ feature: Feature }, BehavioursState> {
  state: BehavioursState = {
    behave: [],
    editing: null,
    addOpen: false,
  }

  componentDidMount() {
    this.setState({ behave: (this.props.feature.description as any).behave ?? [] })
  }

  private save(behave: Behaviour[]) {
    this.setState({ behave })
    this.props.feature.set({ behave } as any)
    this.props.feature.behaviours?.reattachFeature(this.props.feature)
  }

  private remove(idx: number) {
    const behave = this.state.behave.slice()
    behave.splice(idx, 1)
    this.save(behave)
  }

  private add(b: Behaviour, edit = false) {
    const behave = [...this.state.behave, b]
    this.save(behave)
    this.setState({ addOpen: false, editing: edit ? behave.length - 1 : this.state.editing })
  }

  private createNew() {
    const name = prompt('behaviour name?')
    if (!name) return
    this.add({ name, code: stub(name) }, true)
  }

  private setCode(idx: number, code: string) {
    const behave = this.state.behave.slice()
    if (!behave[idx]) return
    behave[idx] = { ...behave[idx], code }
    this.save(behave)
  }

  render() {
    const { behave } = this.state
    return (
      <>
        <dt>behaviours</dt>
        <dd>{behave.length === 0 && <small>no behaviours attached</small>}</dd>
        {behave.map((b, idx) => (
          <Fragment key={idx}>
            <dt>{b.name || 'behaviour'}</dt>
            <dd>
              <button onClick={() => this.setState({ editing: idx })}>edit</button>
              <button onClick={() => this.remove(idx)}>x</button>
            </dd>
          </Fragment>
        ))}
        <dt></dt>
        <dd>
          <button onClick={() => this.setState({ addOpen: !this.state.addOpen })}>+ add</button>
          <button onClick={() => this.createNew()}>+ new</button>
        </dd>
        {this.state.addOpen && (
          <dd class="full behaviour-add">
            {BEHAVIOUR_PRESETS.map((p) => (
              <button key={p.name} onClick={() => this.add({ name: p.name, code: p.code })}>
                {p.name}
              </button>
            ))}
          </dd>
        )}
        {this.state.editing != null && this.state.behave[this.state.editing] && (
          <BehaviourScriptModal
            name={this.state.behave[this.state.editing].name}
            code={this.state.behave[this.state.editing].code}
            onChange={(code) => this.setCode(this.state.editing as number, code)}
            onClose={() => this.setState({ editing: null })}
          />
        )}
      </>
    )
  }
}

type ModalProps = { name: string; code: string; onChange: (code: string) => void; onClose: () => void }
type ModalState = { status: string; agentPrompt: string; agentBusy: boolean; history: string[]; future: string[]; parseError: ParseError | null }

class BehaviourScriptModal extends Component<ModalProps, ModalState> {
  containerRef = createRef<HTMLDivElement>()
  flask: CodeFlask | null = null
  code = ''
  push: (code: string) => void = () => {}
  state: ModalState = { status: '', agentPrompt: '', agentBusy: false, history: [], future: [], parseError: null }

  componentDidMount() {
    if (!this.containerRef.current) return
    this.code = this.props.code
    this.flask = new CodeFlask(this.containerRef.current, { language: 'lua', lineNumbers: true, defaultTheme: true, readonly: false })
    this.flask.updateCode(this.code)
    this.setState({ parseError: validateLua(this.code) })
    this.push = throttle((code: string) => this.props.onChange(code), 400, { trailing: true })
    this.flask.onUpdate((code) => {
      this.code = code
      this.setState({ parseError: validateLua(code) })
      this.push(code)
    })
  }

  componentWillUnmount() {
    this.flask = null
  }

  private replaceCode(next: string, side: 'history' | 'future') {
    if (!this.flask || next === this.code) return
    if (side === 'history') this.setState({ history: [...this.state.history, this.code], future: [] })
    else this.setState({ future: [...this.state.future, this.code] })
    this.code = next
    this.flask.updateCode(next)
    this.setState({ parseError: validateLua(next) })
    this.props.onChange(next)
  }

  private undo = () => {
    const hist = this.state.history.slice()
    const prev = hist.pop()
    if (prev === undefined || !this.flask) return
    this.setState({ history: hist, future: [...this.state.future, this.code] })
    this.code = prev
    this.flask.updateCode(prev)
    this.setState({ parseError: validateLua(prev) })
    this.props.onChange(prev)
  }

  private redo = () => {
    const fut = this.state.future.slice()
    const next = fut.pop()
    if (next === undefined || !this.flask) return
    this.setState({ future: fut, history: [...this.state.history, this.code] })
    this.code = next
    this.flask.updateCode(next)
    this.setState({ parseError: validateLua(next) })
    this.props.onChange(next)
  }

  private askAgent = async () => {
    const prompt = this.state.agentPrompt.trim()
    if (!prompt || this.state.agentBusy) return
    this.setState({ agentBusy: true, status: 'thinking...' })
    let r: Response
    try {
      r = await fetch('/api/models/behaviour', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, script: this.code }) })
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
            <strong>{this.props.name}.lua</strong>
            <button onClick={this.undo} disabled={!canUndo} title="undo last agent edit">
              {'<'} undo
            </button>
            <button onClick={this.redo} disabled={!canRedo} title="redo">
              redo {'>'}
            </button>
            <input
              style={promptInput}
              type="text"
              placeholder="ask the agent... (e.g. 'add a slow spin')"
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
