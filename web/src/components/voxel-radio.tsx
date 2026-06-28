import { Component, createRef } from 'preact'
import { isMobile } from '../../../common/helpers/detector'
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

type KaossProps = {
  label: string
  x: number
  y: number
  level?: () => number
  onWake?: () => void
  onChange: (x: number, y: number) => void
}

const KCOLS = 7
const KROWS = 7
const KDOTS = KCOLS * KROWS

const FxSw = ({ live, title, onTap }: { live: boolean; title: string; onTap: () => void }) => (
  <button
    type="button"
    class={`vr-fx-sw${live ? ' live' : ''}`}
    title={title}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => {
      e.stopPropagation()
      onTap()
    }}
  />
)

class KaossPad extends Component<KaossProps> {
  pad = createRef<HTMLDivElement>()
  dots: HTMLSpanElement[] = []
  held = false
  over = false
  idleT = 0
  raf = 0

  componentDidMount() {
    this.loop()
  }

  componentWillUnmount() {
    if (this.raf) cancelAnimationFrame(this.raf)
  }

  loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (this.over || this.held) return
    this.idleT += 0.016
    const lvl = this.props.level?.() ?? 0
    const orbit = 0.12 + lvl * 0.38
    const x = Math.sin(this.idleT * 1.15) * orbit
    const y = Math.cos(this.idleT * 0.92) * orbit
    this.light(x, y, 0.1 + lvl * 0.4)
  }

  enter = () => {
    this.over = true
    this.props.onWake?.()
  }

  down = (e: PointerEvent) => {
    e.preventDefault()
    this.held = true
    this.props.onWake?.()
    try {
      this.pad.current?.setPointerCapture(e.pointerId)
    } catch {}
    this.move(e)
  }

  move = (e: PointerEvent) => {
    const el = this.pad.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1))
    const y = Math.max(-1, Math.min(1, (1 - (e.clientY - r.top) / r.height) * 2 - 1))
    this.light(x, y)
    this.props.onChange(x, y)
  }

  up = (e: PointerEvent) => {
    this.held = false
    try {
      this.pad.current?.releasePointerCapture(e.pointerId)
    } catch {}
    this.reset()
  }

  leave = () => {
    this.over = false
    if (this.held) return
    this.reset()
  }

  reset = () => {
    this.props.onChange(0, 0)
  }

  light(x: number, y: number, boost = 0) {
    const amt = Math.min(1, Math.max(Math.hypot(x, y), boost))
    for (let i = 0; i < this.dots.length; i++) {
      const dot = this.dots[i]
      if (!dot) continue
      const col = i % KCOLS
      const row = Math.floor(i / KCOLS)
      const dx = x - ((col / (KCOLS - 1)) * 2 - 1) * 0.55
      const dy = y - ((1 - row / (KROWS - 1)) * 2 - 1) * 0.55
      const d = Math.hypot(dx, dy)
      const on = Math.max(0, 1 - d * 1.45) * (0.1 + amt * 0.9)
      dot.style.opacity = String(Math.min(1, on))
    }
  }

  render() {
    const { label } = this.props
    return (
      <>
        <div class="vr-kaoss-grid" ref={this.pad} onPointerEnter={this.enter} onPointerMove={this.move} onPointerLeave={this.leave} onPointerDown={this.down} onPointerUp={this.up} title={label}>
          {Array.from({ length: KDOTS }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                if (el) this.dots[i] = el
              }}
            />
          ))}
        </div>
        <div class="vr-dial-foot">
          <span class="vr-dial-label">{label}</span>
        </div>
      </>
    )
  }
}

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
      pl: props.popped ? 'open' : loadPanel('pl', 'closed'),
    }
  }

  componentDidMount() {
    this.radio = new VoxelRadioEngine()
    this.radio.onChange = () => this.forceUpdate()
    this.radio.start()
    this.syncViz()
    this.tick = setInterval(() => this.forceUpdate(), 1000)
    setTimeout(() => this.syncViz(), 100)
    setTimeout(() => this.syncViz(), 400)
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
      let tries = 0
      const go = () => {
        if (!this.canvas.current || this.viz) return
        tries++
        const r = canvas.getBoundingClientRect()
        if ((r.width < 1 || r.height < 1) && tries < 120) {
          requestAnimationFrame(go)
          return
        }
        this.viz = startVisualiser(canvas, analyser, 0)
        if (!this.viz.alive()) {
          this.viz.dispose()
          this.viz = null
          if (tries < 120) requestAnimationFrame(go)
        }
      }
      requestAnimationFrame(go)
    } else if (!want && this.viz) {
      this.viz.dispose()
      this.viz = null
    }
  }

  restartViz = () => {
    this.viz?.dispose()
    this.viz = null
    setTimeout(() => this.syncViz(), 80)
  }

  tapViz = (e: Event) => {
    e.stopPropagation()
    const r = this.radio
    if (!r) return
    const stalled = r.muted || r.stalled
    if (stalled) this.transport()
    else this.wakeViz()
    if (stalled) this.restartViz()
  }

  wakeViz = () => {
    const r = this.radio
    const needRestart = r && (r.ctx.state !== 'running' || r.stalled)
    r?.wake()
    if (this.state.viz !== 'open') return
    if (needRestart) this.restartViz()
    else if (!this.viz) this.syncViz()
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
    const stalled = r.muted || r.stalled
    if (stalled) {
      if (r.muted) r.toggle()
      else r.wake()
      if (this.state.viz === 'open') this.restartViz()
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
    const dials: { id: 'vol' | PedalId; label: string; min: number; max: number }[] = [
      { id: 'vol', label: 'vol', min: 0, max: 1 },
      { id: 'eq', label: 'eq', min: -1, max: 1 },
      { id: 'dly', label: 'tape', min: -1, max: 1 },
      { id: 'chp', label: 'gate', min: -1, max: 1 },
    ]
    return (
      <>
        {dials.map(({ id, label, min, max }) => (
          <div class={`vr-dial${id !== 'vol' && !r.fxOn(id as PedalId) ? ' fx-off' : ''}`} key={id}>
            <div class="vr-dial-body">
              <Knob
                compact
                label={label}
                min={min}
                max={max}
                step={0.03}
                value={id === 'vol' ? r.trackVolume : r.pedalAmount(id)}
                onWake={() => r.wake()}
                onChange={(v) => {
                  if (id === 'vol') r.setTrackVolume(v)
                  else r.setPedal(id, v)
                  this.forceUpdate()
                }}
              />
            </div>
            <div class="vr-dial-foot">
              <span class="vr-dial-label">{label}</span>
              {id !== 'vol' && (
                <FxSw
                  live={r.fxOn(id as PedalId)}
                  title={r.fxOn(id as PedalId) ? 'turn off' : 'turn on'}
                  onTap={() => {
                    r.toggleFx(id as PedalId)
                    this.forceUpdate()
                  }}
                />
              )}
            </div>
          </div>
        ))}
        <div class="vr-dial vr-dial-pad" key="wob">
          <KaossPad
            label="wob"
            x={r.wobX}
            y={r.wobY}
            level={() => r.readLevel()}
            onWake={() => r.wake()}
            onChange={(x, y) => {
              r.setWobPad(x, y)
              this.forceUpdate()
            }}
          />
        </div>
      </>
    )
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
        <div class={`voxel-radio${onAir ? ' on-air' : ''}${compact ? ' compact' : ''}`} onPointerDown={this.wakeViz}>
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
              <div class={`vr-viz-box${showPlay && isMobile() ? ' needs-tap' : ''}`} onClick={showPlay && isMobile() ? this.tapViz : undefined}>
                <canvas ref={this.canvas} class="vr-viz" />
                {showPlay && isMobile() && (
                  <button type="button" class="vr-viz-play" onClick={this.tapViz}>
                    tap to listen
                  </button>
                )}
              </div>,
            )}

            {this.panel('pl', 'playlist', this.playlistBody(r, pct))}
          </div>
        </div>
      </div>
    )
  }
}
