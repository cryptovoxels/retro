import { Component, createRef } from 'preact'
import { trackTitle } from '../../../common/soundtracks'
import { DAY, PEDALS, PedalId, Spot, VoxelRadioEngine } from '../radio/engine'
import { startVisualiser } from '../radio/visualiser'

type Props = { popped?: boolean }
type State = { open: boolean; fx: boolean }

const sec = () => (Date.now() / 1000) % DAY

const clock = (off: number) => {
  const h = Math.floor(off / 3600) % 24
  const m = Math.floor((off % 3600) / 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
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

type SliderProps = {
  label: string
  min: number
  max: number
  step: number
  value: number
  center?: boolean
  accent?: boolean
  onChange: (v: number) => void
}

// winamp-style horizontal bar, drag left/right
class Slider extends Component<SliderProps> {
  el: HTMLElement | null = null

  set = (clientX: number) => {
    if (!this.el) return
    const { min, max, step, onChange } = this.props
    const rect = this.el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const v = min + t * (max - min)
    onChange(Math.max(min, Math.min(max, Math.round(v / step) * step)))
  }

  down = (e: PointerEvent) => {
    e.preventDefault()
    this.el = e.currentTarget as HTMLElement
    this.set(e.clientX)
    const move = (ev: PointerEvent) => this.set(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  render() {
    const { label, min, max, value, center } = this.props
    const t = (value - min) / (max - min)
    const mid = center ? (-min / (max - min)) * 100 : 0
    let fillLeft = 0
    let fillWidth = t * 100
    if (center) {
      if (value >= 0) {
        fillLeft = mid
        fillWidth = t * 100 - mid
      } else {
        fillLeft = t * 100
        fillWidth = mid - t * 100
      }
    }
    return (
      <div class="vr-slider" onPointerDown={this.down}>
        <span class="vr-slider-label">{label}</span>
        <div class="vr-slider-track">
          {center && <span class="vr-slider-mid" />}
          <span class={`vr-slider-fill${this.props.accent ? ' accent' : ''}`} style={`left:${fillLeft}%;width:${fillWidth}%`} />
        </div>
      </div>
    )
  }
}

type PadProps = {
  id: string
  min: number
  max: number
  step: number
  value: number
  active: boolean
  onChange: (v: number) => void
  onWake?: () => void
}

// vintage calc key: drag up/down, hold to punch in
class FxPad extends Component<PadProps> {
  el: HTMLElement | null = null
  y0 = 0
  v0 = 0
  moved = false
  punching = false
  punchT: ReturnType<typeof setTimeout> | null = null
  state = { lit: false, punch: false }

  setY = (clientY: number) => {
    if (!this.el) return
    const { min, max, step, onChange } = this.props
    const rect = this.el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
    const v = min + t * (max - min)
    onChange(Math.max(min, Math.min(max, Math.round(v / step) * step)))
  }

  punchVal = () => {
    const { id, max } = this.props
    if (id === 'eq') return max
    return max
  }

  down = (e: PointerEvent) => {
    e.preventDefault()
    this.props.onWake?.()
    this.el = e.currentTarget as HTMLElement
    this.y0 = e.clientY
    this.v0 = this.props.value
    this.moved = false
    this.setState({ lit: true, punch: false })
    this.setY(e.clientY)
    this.punchT = setTimeout(() => {
      if (!this.moved) {
        this.punching = true
        this.setState({ punch: true })
        this.props.onChange(this.punchVal())
      }
    }, 160)
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - this.y0) > 6) {
        this.moved = true
        if (this.punchT) clearTimeout(this.punchT)
        if (this.punching) this.props.onChange(this.v0)
        this.punching = false
        this.setState({ punch: false })
      }
      this.setY(ev.clientY)
    }
    const up = () => {
      if (this.punchT) clearTimeout(this.punchT)
      if (this.punching) this.props.onChange(this.v0)
      this.punching = false
      this.setState({ lit: false, punch: false })
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  render() {
    const { id, min, max, value, active } = this.props
    const t = (value - min) / (max - min)
    const mid = id === 'eq' ? 50 : 0
    let fillBottom = 0
    let fillHeight = t * 100
    if (id === 'eq') {
      if (value >= 0) {
        fillBottom = mid
        fillHeight = t * 100 - mid
      } else {
        fillBottom = t * 100
        fillHeight = mid - t * 100
      }
    }
    const hot = active && (Math.abs(value) > 0.08 || (id !== 'eq' && value > 0.08) || (id === 'vol' && value < 0.92))
    const digits = id === 'eq' ? `${value >= 0 ? '+' : ''}${Math.round(value * 100)}` : String(Math.round(t * 99)).padStart(2, '0')
    return (
      <div class={`vr-key op${active ? '' : ' off'}${hot ? ' hot' : ''}${this.state.lit ? ' lit' : ''}${this.state.punch ? ' punch' : ''}`} onPointerDown={this.down} title={`${id}: drag or hold`}>
        {id === 'eq' && <span class="vr-key-mid" />}
        <span class="vr-key-fill" style={`bottom:${fillBottom}%;height:${fillHeight}%`} />
        <span class="vr-key-label">{id}</span>
        <span class="vr-key-digits">{digits}</span>
      </div>
    )
  }
}

type KnobProps = { label: string; min: number; max: number; step: number; value: number; compact?: boolean; onChange: (v: number) => void }

// 2rem svg arc knob, drag up/down to turn
class Knob extends Component<KnobProps> {
  y = 0
  v = 0

  down = (e: PointerEvent) => {
    e.preventDefault()
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
  disposeViz: (() => void) | null = null
  state = { open: !!this.props.popped, fx: false }

  componentDidMount() {
    this.radio = new VoxelRadioEngine()
    this.radio.onChange = () => this.forceUpdate()
    this.radio.start()
    if (this.canvas.current) this.disposeViz = startVisualiser(this.canvas.current, this.radio.analyser)
    this.tick = setInterval(() => this.forceUpdate(), 1000)
  }

  componentWillUnmount() {
    if (this.tick) clearInterval(this.tick)
    this.disposeViz?.()
    this.disposeViz = null
    this.radio?.stop()
    this.radio = null
  }

  popout = () => {
    window.open('/radio', 'voxelradio', 'width=480,height=560,menubar=no,toolbar=no,location=no')
    // hand the audio to the popup so we're not playing twice
    if (this.radio && !this.radio.muted) this.radio.toggle()
  }

  // current track + everything coming up, tracks and spots interleaved by clock
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

    // show a little history above the live track, plus what's coming up
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

  pedals(r: VoxelRadioEngine) {
    return r.chain.map((id, i) => (
      <div class="vr-pedal" key={`${id}-${i}`}>
        <div class="vr-pedal-head">
          <span class="vr-pedal-name">{id}</span>
          <button type="button" class="vr-pedal-x" onClick={() => r.removePedal(id)} title="remove">
            x
          </button>
        </div>
        <Slider
          label={id}
          min={id === 'eq' ? -1 : 0}
          max={1}
          step={0.05}
          center={id === 'eq'}
          accent={id === 'eq'}
          value={r.pedalAmount(id)}
          onChange={(v) => {
            r.setPedal(id, v)
            this.forceUpdate()
          }}
        />
      </div>
    ))
  }

  padGrid(r: VoxelRadioEngine) {
    const pads: { id: 'vol' | PedalId; min: number; max: number }[] = [
      { id: 'vol', min: 0, max: 1 },
      { id: 'eq', min: -1, max: 1 },
      { id: 'rvb', min: 0, max: 1 },
      { id: 'dly', min: 0, max: 1 },
      { id: 'drv', min: 0, max: 1 },
    ]
    return pads.map(({ id, min, max }) => {
      const active = id === 'vol' || r.chain.includes(id)
      const value = id === 'vol' ? r.trackVolume : r.pedalAmount(id)
      return (
        <FxPad
          key={id}
          id={id}
          min={min}
          max={max}
          step={0.05}
          active={active}
          value={value}
          onWake={() => {
            if (id !== 'vol' && !r.chain.includes(id)) r.addPedal(id)
          }}
          onChange={(v) => {
            if (id === 'vol') r.setTrackVolume(v)
            else {
              if (!r.chain.includes(id)) r.addPedal(id)
              r.setPedal(id, v)
            }
            this.forceUpdate()
          }}
        />
      )
    })
  }

  render() {
    const r = this.radio
    const muted = r?.muted ?? false
    const onAir = r?.onAir ?? false
    const text = onAir ? 'dj on the mic...' : r?.title || 'tuning in...'
    const pct = Math.round((sec() / DAY) * 100)
    const compact = !this.props.popped

    const chain = r?.chain ?? []
    const spare = r ? PEDALS.filter((id) => !chain.includes(id)) : []

    return (
      <div class={`voxel-radio-wrap${this.props.popped ? ' popped' : ''}${this.state.open ? ' open' : ''}${this.state.fx ? ' fx' : ''}`}>
        <div class={`voxel-radio${onAir ? ' on-air' : ''}${compact ? ' compact' : ''}`}>
          {compact ? (
            <>
              <div class="vr-viz-box">
                <canvas ref={this.canvas} class="vr-viz" />
              </div>
              <div class="vr-calc-face">
                <span class="vr-brand">voxels radio{onAir ? ' *' : ''}</span>
                <div class="vr-calc-display">
                  <span class="vr-track">
                    <span>{text}</span>
                  </span>
                </div>
                <div class="vr-key-row">
                  <button type="button" class="vr-key fn" onClick={() => r?.toggle()} title={muted ? 'play' : 'stop'}>
                    {muted ? '>' : '||'}
                  </button>
                  <button type="button" class={`vr-key fn${this.state.open ? ' on' : ''}`} onClick={() => this.setState({ open: !this.state.open })} title="playlist">
                    PL
                  </button>
                  <button type="button" class={`vr-key fn${this.state.fx ? ' on' : ''}`} onClick={() => this.setState({ fx: !this.state.fx })} title="fx chain">
                    FX
                  </button>
                  <button type="button" class="vr-key fn" onClick={this.popout} title="pop out">
                    ^
                  </button>
                </div>
                {r && <div class="vr-key-grid">{this.padGrid(r)}</div>}
              </div>
              <div class="vr-progress vr-progress-main">
                <span style={`width:${pct}%`} />
              </div>
            </>
          ) : (
            <>
              <div class="vr-viz-box">
                <canvas ref={this.canvas} class="vr-viz" />
              </div>
              <div class="vr-screen">
                <span class="vr-label">voxels radio{onAir ? ' / on air' : ''}</span>
                <span class="vr-track">
                  <span>{text}</span>
                </span>
              </div>
              <div class="vr-transport">
                <button type="button" class="vr-toggle" onClick={() => r?.toggle()} title={muted ? 'play' : 'stop'}>
                  {muted ? 'play' : 'stop'}
                </button>
                <button type="button" class={`vr-btn${this.state.fx ? ' active' : ''}`} onClick={() => this.setState({ fx: !this.state.fx })} title="fx pedals">
                  fx
                </button>
                <button type="button" class="vr-btn" onClick={() => this.setState({ open: !this.state.open })} title="schedule">
                  list
                </button>
              </div>
            </>
          )}
        </div>

        {this.state.fx && r && (
          <div class="vr-pedals">
            <div class="vr-pl-title">fx chain</div>
            <div class="vr-pedal-chain">{this.pedals(r)}</div>
            {spare.length > 0 && (
              <div class="vr-pedal-add">
                {spare.map((id) => (
                  <button type="button" key={id} class="vr-btn" onClick={() => r.addPedal(id as PedalId)}>
                    +{id}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {this.state.open && (
          <div class="vr-playlist">
            {compact && <div class="vr-pl-title">playlist</div>}
            {!compact && (
              <div class="vr-progress">
                <span style={`width:${pct}%`} />
              </div>
            )}
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
          </div>
        )}
      </div>
    )
  }
}
