import { Component, createRef } from 'preact'
import { trackTitle } from '../../../common/soundtracks'
import { DAY, Spot, VoxelRadioEngine } from '../radio/engine'
import { startVisualiser } from '../radio/visualiser'

type Props = { popped?: boolean }
type State = { open: boolean }

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

type KnobProps = { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }

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
    const { label, min, max, value } = this.props
    const t = (value - min) / (max - min)
    return (
      <div class="vr-knob" onPointerDown={this.down}>
        <svg viewBox="0 0 32 32">
          <path class="track" d={FULL} />
          <path class="val" d={arc(A0 + t * SPAN)} />
        </svg>
        <span class="vr-knob-val">{Math.round(value * 100)}</span>
        <label>{label}</label>
      </div>
    )
  }
}

export default class VoxelRadio extends Component<Props, State> {
  radio: VoxelRadioEngine | null = null
  tick: ReturnType<typeof setInterval> | null = null
  canvas = createRef<HTMLCanvasElement>()
  disposeViz: (() => void) | null = null
  state = { open: !!this.props.popped }

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
      return (
        <li key={`${it.at}-${it.label}`} class={`${live ? 'live' : it.at <= now ? 'past' : ''}${it.spot ? ' spot' : ''}`} onClick={it.spot ? () => r?.previewSpot(it.spot!) : undefined}>
          <span class="vr-time">{clock(it.at)}</span>
          <span class="vr-name">{it.label}</span>
        </li>
      )
    })
  }

  render() {
    const r = this.radio
    const muted = r?.muted ?? false
    const onAir = r?.onAir ?? false
    const text = onAir ? 'dj on the mic...' : r?.title || 'tuning in...'
    const pct = Math.round((sec() / DAY) * 100)

    return (
      <div class={`voxel-radio-wrap${this.props.popped ? ' popped' : ''}`}>
        <div class={`voxel-radio${onAir ? ' on-air' : ''}`}>
          <canvas ref={this.canvas} class="vr-viz" />
          <button class="vr-toggle" onClick={() => r?.toggle()}>
            {muted ? 'play' : 'stop'}
          </button>
          <div class="vr-screen">
            <span class="vr-label">voxels radio{onAir ? ' / on air' : ''}</span>
            <span class="vr-track">
              <span>{text}</span>
            </span>
          </div>
          <button class="vr-btn" onClick={() => this.setState({ open: !this.state.open })}>
            list
          </button>
          {!this.props.popped && (
            <button class="vr-btn" onClick={this.popout}>
              pop
            </button>
          )}
        </div>

        {this.state.open && (
          <div class="vr-playlist">
            <div class="vr-progress">
              <span style={`width:${pct}%`} />
            </div>
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
                label="filter"
                min={-1}
                max={1}
                step={0.05}
                value={r?.filterAmount ?? 0}
                onChange={(v) => {
                  r?.setFilter(v)
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
