import { Component, createRef } from 'preact'
import { trackTitle } from '../../../common/soundtracks'
import { DAY, PedalId, Spot, VoxelRadioEngine } from '../radio/engine'
import { startVisualiser, Visualiser } from '../radio/visualiser'

type Props = { popped?: boolean }
type PanelMode = 'closed' | 'open'
type State = { viz: PanelMode; pl: PanelMode }

const sec = () => (Date.now() / 1000) % DAY

const clock = (off: number) => {
  const h = Math.floor(off / 3600) % 24
  const m = Math.floor((off % 3600) / 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function loadPanel(key: string, def: PanelMode): PanelMode {
  try {
    const v = localStorage.getItem(`radio.panel.${key}`)
    if (v === 'open' || v === 'closed') return v
    if (v === 'shade') return 'open'
  } catch {}
  return def
}

function savePanel(key: string, mode: PanelMode) {
  try {
    localStorage.setItem(`radio.panel.${key}`, mode)
  } catch {}
}

// 270deg gauge arc, gap at the bottom, 0 at top (12 o'clock)
const R = 13
const C = 16
const A0 = -135
const SPAN = 270
const pt = (deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180
  return [C + R * Math.cos(a), C + R * Math.sin(a)]
}
const arc = (to: number) => {
  const [x1, y1] = pt(A0)
  const [x2, y2] = pt(to)
  const big = to - A0 > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${big} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}
const FULL = arc(A0 + SPAN)

type KnobProps = { label: string; min: number; max: number; step: number; value: number; compact?: boolean; onWake?: () => void; onChange: (v: number) => void }

class Knob extends Component<KnobProps> {
  y = 0
  v = 0

  down = (e: PointerEvent) => {
    e.preventDefault()
    this.props.onWake?.()
    this.y = e.clientY
    this.v = this.props.value
    window.addEventListener('pointermove', this.move)
    window.addEventListener('pointerup', this.up)
  }
  move = (e: PointerEvent) => {
    const { min, max, step, onChange } = this.props
    let v = this.v + ((this.y - e.clientY) / 120) * (max - min)
    v = Math.max(min, Math.min(max, Math.round(v / step) * step))
    onChange(v)
  }
  up = () => {
    window.removeEventListener('pointermove', this.move)
    window.removeEventListener('pointerup', this.up)
  }

  render() {
    const { label, min, max, value, compact } = this.props
    const t = (value - min) / (max - min)
    const pct = compact ? Math.round(t * 100) : Math.round(value * 100)
    return (
      <div class={`vr-knob${compact ? ' mini' : ''}`} onPointerDown={this.down} title={label}>
        <svg viewBox="0 0 32 32">
          {compact && <circle class="face" cx={C} cy={C} r={R + 2} />}
          <path class="track" d={FULL} />
          <path class="val" d={arc(A0 + t * SPAN)} />
        </svg>
        {!compact && <span class="vr-knob-val">{pct}</span>}
        {!compact && <label>{label}</label>}
        {compact && <span class="vr-dial-label">{label}</span>}
      </div>
    )
  }
}

export default class VoxelRadio extends Component<Props, State> {
  radio: VoxelRadioEngine | null = null
  tick: ReturnType<typeof setInterval> | null = null
  canvas = createRef<HTMLCanvasElement>()
  viz: Visualiser | null = null

  constructor(props: Props) {
    super(props)
    this.state = {
      viz: loadPanel('viz', 'open'),
      pl: loadPanel('pl', 'closed'),
    }
  }

  componentDidMount() {
    this.radio = new VoxelRadioEngine()
    this.radio.onChange = () => this.forceUpdate()
    this.radio.start()
    this.syncViz()
    this.tick = setInterval(() => this.forceUpdate(), 1000)
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (prevState.viz !== this.state.viz) this.syncViz()
  }

  componentWillUnmount() {
    if (this.tick) clearInterval(this.tick)
    this.viz?.dispose()
    this.viz = null
    this.radio?.stop()
    this.radio = null
  }

  syncViz() {
    const want = this.state.viz === 'open'
    if (want && this.canvas.current && this.radio && !this.viz) {
      const canvas = this.canvas.current
      const analyser = this.radio.analyser
      const go = () => {
        if (!this.canvas.current || this.viz) return
        if (canvas.clientWidth < 1 || canvas.clientHeight < 1) {
          requestAnimationFrame(go)
          return
        }
        this.viz = startVisualiser(canvas, analyser, 0)
      }
      requestAnimationFrame(go)
    } else if (!want && this.viz) {
      this.viz.dispose()
      this.viz = null
    }
  }

  shuffleViz = () => {
    this.viz?.shuffle()
  }

  setPanel(id: 'viz' | 'pl', mode: PanelMode) {
    this.setState({ [id]: mode } as Pick<State, typeof id>, () => this.syncViz())
    savePanel(id, mode)
  }

  togglePanel(id: 'viz' | 'pl') {
    this.setPanel(id, this.state[id] === 'closed' ? 'open' : 'closed')
  }

  popout = () => {
    const w = window.open('/radio', 'voxelradio', 'width=480,height=560,menubar=no,toolbar=no,location=no')
    if (w && this.radio && !this.radio.muted) this.radio.toggle()
  }

  transport = () => {
    const r = this.radio
    if (!r) return
    if (r.muted || r.stalled) {
      if (r.muted) r.toggle()
      else r.wake()
    } else {
      r.toggle()
    }
    this.forceUpdate()
  }

  rows() {
    const r = this.radio
    const sched = r?.schedule
    if (!sched) return null
    const now = sec()

    const items: { at: number; label: string; spot?: Spot }[] = []
    sched.segments.forEach((g) => items.push({ at: g.startsAt, label: trackTitle(g) }))
    sched.spots.forEach((s) => items.push({ at: s.atOffset, label: s.summary || (s.kind === 'ar' ? 'فاصل' : 'spot'), spot: s }))
    items.sort((a, b) => a.at - b.at)

    let cur = 0
    for (let i = 0; i < items.length; i++) if (items[i].at <= now) cur = i

    const from = Math.max(0, cur - 6)
    return items.slice(from, cur + 14).map((it) => {
      const live = it === items[cur]
      const kind = it.spot ? 'spot' : 'music'
      const when = live ? 'live' : it.at <= now ? 'past' : ''
      const parcelId = it.spot?.parcelId
      const name = parcelId ? (
        <a href={`/parcels/${parcelId}/play`} class="vr-name">
          {it.label}
        </a>
      ) : (
        <span class="vr-name">{it.label}</span>
      )
      return (
        <li key={`${it.at}-${it.label}`} class={[when, kind].filter(Boolean).join(' ')} onClick={it.spot && !parcelId ? () => r?.previewSpot(it.spot!) : undefined}>
          {live && <span class="vr-now">now</span>}
          <span class="vr-time">{clock(it.at)}</span>
          {name}
        </li>
      )
    })
  }

  dialGrid(r: VoxelRadioEngine) {
    const dials: { id: 'vol' | PedalId; min: number; max: number }[] = [
      { id: 'vol', min: 0, max: 1 },
      { id: 'eq', min: -1, max: 1 },
      { id: 'bit', min: 0, max: 1 },
      { id: 'dly', min: 0, max: 1 },
      { id: 'wob', min: 0, max: 1 },
    ]
    return dials.map(({ id, min, max }) => (
      <div class="vr-dial" key={id}>
        <Knob
          compact
          label={id}
          min={min}
          max={max}
          step={id === 'eq' ? 0.03 : 0.04}
          value={id === 'vol' ? r.trackVolume : r.pedalAmount(id)}
          onWake={() => r.wake()}
          onChange={(v) => {
            if (id === 'vol') r.setTrackVolume(v)
            else {
              if (!r.chain.includes(id)) r.addPedal(id)
              r.setPedal(id, v)
            }
            this.forceUpdate()
          }}
        />
      </div>
    ))
  }

  panel(id: 'viz' | 'pl', title: string, body: preact.ComponentChildren) {
    if (this.state[id] === 'closed') return null
    return (
      <div class="vr-panel">
        <div class="vr-panel-head">
          <span class="vr-panel-title">{title}</span>
          {id === 'viz' && (
            <span class="vr-panel-arrows">
              <button type="button" class="vr-panel-btn" onClick={this.shuffleViz} title="random viz">
                &lt;
              </button>
              <button type="button" class="vr-panel-btn" onClick={this.shuffleViz} title="random viz">
                &gt;
              </button>
            </span>
          )}
        </div>
        <div class={`vr-panel-body${id === 'pl' ? ' vr-playlist' : ''}`}>{body}</div>
      </div>
    )
  }

  playlistBody(r: VoxelRadioEngine | null, pct: number) {
    return (
      <>
        <small class="vr-day">
          {clock(sec())} utc / day {pct}%
        </small>
        <div class="vr-controls">
          <Knob
            label="track"
            min={0}
            max={1}
            step={0.05}
            value={r?.trackVolume ?? 1}
            onChange={(v) => {
              r?.setTrackVolume(v)
              this.forceUpdate()
            }}
          />
          <Knob
            label="spot"
            min={0}
            max={1}
            step={0.05}
            value={r?.spotVolume ?? 1}
            onChange={(v) => {
              r?.setSpotVolume(v)
              this.forceUpdate()
            }}
          />
        </div>
        <ul>{this.rows()}</ul>
      </>
    )
  }

  render() {
    const r = this.radio
    const muted = r?.muted ?? false
    const showPlay = !r || muted || r.stalled
    const onAir = r?.onAir ?? false
    const text = onAir ? 'dj on the mic...' : r?.title || 'tuning in...'
    const pct = Math.round((sec() / DAY) * 100)
    const compact = !this.props.popped
    const { viz, pl } = this.state

    return (
      <div class={`voxel-radio-wrap${this.props.popped ? ' popped' : ''}${pl === 'open' ? ' pl-open' : ''}`}>
        <div class={`voxel-radio${onAir ? ' on-air' : ''}${compact ? ' compact' : ''}`} onPointerDown={() => this.radio?.wake()}>
          <div class="vr-stack">
            <div class="vr-main">
              {compact ? (
                <>
                  <div class="vr-calc-head">
                    <div class="vr-key-row">
                      <button type="button" class="vr-key fn" onClick={this.transport} title={showPlay ? 'play' : 'stop'}>
                        {showPlay ? '>' : '||'}
                      </button>
                      <button type="button" class={`vr-key fn${pl !== 'closed' ? ' on' : ''}`} onClick={() => this.togglePanel('pl')} title="playlist">
                        PL
                      </button>
                      <button type="button" class={`vr-key fn${viz !== 'closed' ? ' on' : ''}`} onClick={() => this.togglePanel('viz')} title="voxelizr">
                        VZ
                      </button>
                      <button type="button" class="vr-key fn" onClick={this.popout} title="pop out">
                        ^
                      </button>
                    </div>
                    <div class="vr-calc-display">
                      <span class="vr-brand">voxels radio{onAir ? ' *' : ''}</span>
                      <span class="vr-track">
                        <span>{text}</span>
                      </span>
                    </div>
                  </div>
                  {r && <div class="vr-dial-grid">{this.dialGrid(r)}</div>}
                </>
              ) : (
                <>
                  <div class="vr-calc-head popped-head">
                    <div class="vr-screen">
                      <span class="vr-label">voxels radio{onAir ? ' / on air' : ''}</span>
                      <span class="vr-track">
                        <span>{text}</span>
                      </span>
                    </div>
                    <div class="vr-transport">
                      <button type="button" class="vr-toggle" onClick={this.transport} title={showPlay ? 'play' : 'stop'}>
                        {showPlay ? 'play' : 'stop'}
                      </button>
                      <button type="button" class={`vr-btn${pl !== 'closed' ? ' active' : ''}`} onClick={() => this.togglePanel('pl')} title="playlist">
                        pl
                      </button>
                      <button type="button" class={`vr-btn${viz !== 'closed' ? ' active' : ''}`} onClick={() => this.togglePanel('viz')} title="voxelizr">
                        vz
                      </button>
                    </div>
                  </div>
                  <div class="vr-progress vr-progress-main">
                    <span style={`width:${pct}%`} />
                  </div>
                </>
              )}
            </div>

            {this.panel(
              'viz',
              'voxelizr',
              <div class="vr-viz-box">
                <canvas ref={this.canvas} class="vr-viz" />
              </div>,
            )}

            {this.panel('pl', 'playlist', this.playlistBody(r, pct))}
          </div>
        </div>
      </div>
    )
  }
}
