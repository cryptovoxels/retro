import { Component } from 'preact'
import { trackTitle } from '../../../common/soundtracks'
import { DAY, Spot, VoxelRadioEngine } from '../radio/engine'

type Props = { popped?: boolean }
type State = { open: boolean }

const sec = () => (Date.now() / 1000) % DAY

const clock = (off: number) => {
  const h = Math.floor(off / 3600) % 24
  const m = Math.floor((off % 3600) / 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

export default class VoxelRadio extends Component<Props, State> {
  radio: VoxelRadioEngine | null = null
  tick: ReturnType<typeof setInterval> | null = null
  state = { open: !!this.props.popped }

  componentDidMount() {
    this.radio = new VoxelRadioEngine()
    this.radio.onChange = () => this.forceUpdate()
    this.radio.start()
    this.tick = setInterval(() => this.forceUpdate(), 1000)
  }

  componentWillUnmount() {
    if (this.tick) clearInterval(this.tick)
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
            <ul>{this.rows()}</ul>
          </div>
        )}
      </div>
    )
  }
}
