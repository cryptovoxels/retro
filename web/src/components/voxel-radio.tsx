import { Component } from 'preact'
import { trackTitle } from '../../../common/soundtracks'
import { DAY, Spot, VoxelRadioEngine } from '../radio/engine'
import { ensureRadio, getRadio, onRadioChange } from '../radio/global'

type Props = { popped?: boolean }
type PanelMode = 'closed' | 'open'
type State = { pl: PanelMode }

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
  } catch { }
  return def
}

function savePanel(key: string, mode: PanelMode) {
  try {
    localStorage.setItem(`radio.panel.${key}`, mode)
  } catch { }
}

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

type KnobProps = { label: string; min: number; max: number; step: number; value: number; small?: boolean; onWake?: () => void; onChange: (v: number) => void }

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
    const { label, min, max, value, small } = this.props
    const t = (value - min) / (max - min)
    const size = small ? '1.5rem' : '2rem'
    return (
      <div onPointerDown={this.down} title={label}>
        <svg viewBox="0 0 32 32" width={size} height={size}>
          {small && <circle cx={C} cy={C} r={R + 2} fill="none" stroke="currentColor" stroke-width="1" />}
          <path fill="none" stroke="currentColor" stroke-width="2" opacity="0.35" d={FULL} />
          <path fill="none" stroke="currentColor" stroke-width="2" d={arc(A0 + t * SPAN)} />
        </svg>
        {!small && <label>{label}</label>}
      </div>
    )
  }
}

export default class VoxelRadio extends Component<Props, State> {
  radio: VoxelRadioEngine | null = null
  tick: ReturnType<typeof setInterval> | null = null
  off: (() => void) | null = null

  constructor(props: Props) {
    super(props)
    this.state = {
      pl: props.popped ? 'open' : loadPanel('pl', 'closed'),
    }
  }

  componentDidMount() {
    this.radio = getRadio() ?? ensureRadio()
    this.off = onRadioChange(() => this.forceUpdate())
    this.tick = setInterval(() => this.forceUpdate(), 1000)
  }

  componentWillUnmount() {
    if (this.tick) clearInterval(this.tick)
    this.off?.()
    this.off = null
    this.radio = null
  }

  wake = () => {
    this.radio?.wake()
  }

  setPanel(mode: PanelMode) {
    this.setState({ pl: mode })
    savePanel('pl', mode)
  }

  togglePanel = () => {
    this.setPanel(this.state.pl === 'closed' ? 'open' : 'closed')
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
      const parcelId = it.spot?.parcelId
      const name = parcelId ? <a href={`/parcels/${parcelId}/play`}>{it.label}</a> : <span>{it.label}</span>
      return (
        <li key={`${it.at}-${it.label}`} onClick={it.spot && !parcelId ? () => r?.previewSpot(it.spot!) : undefined}>
          {live && <span>now</span>}
          <span>{clock(it.at)}</span>
          {name}
        </li>
      )
    })
  }

  render() {
    const r = this.radio
    const muted = r?.muted ?? false
    const showPlay = !r || muted || r.stalled
    const onAir = r?.onAir ?? false
    const text = onAir ? 'dj on the mic...' : r?.title || 'tuning in...'
    const pct = Math.round((sec() / DAY) * 100)
    const compact = !this.props.popped
    const { pl } = this.state

    if (compact) {
      return (
        <div class="voxel-radio" onPointerDown={this.wake}>
          <button type="button" onClick={this.transport} title={showPlay ? 'play' : 'pause'}>
            {showPlay ? '\u25B6' : '\u23F8'}
          </button>
          <a href="/radio">{text}</a>
          {r && (
            <Knob
              small
              label="vol"
              min={0}
              max={1}
              step={0.03}
              value={r.trackVolume}
              onWake={() => r.wake()}
              onChange={(v) => {
                r.setTrackVolume(v)
                this.forceUpdate()
              }}
            />
          )}
        </div>
      )
    }

    return (
      <div class="voxel-radio" style={{ flexDirection: 'column', alignItems: 'stretch' }} onPointerDown={this.wake}>
        <span>{onAir ? 'Radio / on air' : 'Radio'}</span>
        <span>{text}</span>
        <button type="button" onClick={this.transport} title={showPlay ? 'play' : 'stop'}>
          {showPlay ? 'play' : 'stop'}
        </button>
        <button type="button" onClick={this.togglePanel} title="playlist">
          pl
        </button>
        <div style={{ height: '0.25rem', background: 'var(--tinge)' }}>
          <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--bright)' }} />
        </div>
        {pl !== 'closed' && (
          <>
            <strong>playlist</strong>
            <small>
              {clock(sec())} utc / day {pct}%
            </small>
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
            <ul>{this.rows()}</ul>
          </>
        )}
      </div>
    )
  }
}
