import { Component } from 'preact'
import { ensureRadio, getRadio, onRadioChange } from '../radio/global'

type Props = { path: string }

export default class RadioMini extends Component<Props> {
  off: (() => void) | null = null

  componentDidMount() {
    ensureRadio()
    this.off = onRadioChange(() => this.forceUpdate())
  }

  componentWillUnmount() {
    this.off?.()
  }

  transport = () => {
    const r = getRadio()
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

  render() {
    const path = this.props.path.replace(/\?.*/, '')
    if (path === '/' || path === '/radio') return null

    const r = getRadio()
    const showPlay = !r || r.muted || r.stalled
    const onAir = r?.onAir ?? false
    const track = onAir ? 'dj on the mic...' : r?.title || 'tuning in...'

    return (
      <div class="radio-mini" onPointerDown={() => r?.wake()}>
        <button type="button" class="radio-mini-btn" onClick={this.transport} title={showPlay ? 'play' : 'pause'}>
          {showPlay ? '>' : '||'}
        </button>
        <span class="radio-mini-track" title={track}>
          {track}
        </span>
        <input
          type="range"
          class="radio-mini-vol"
          min={0}
          max={1}
          step={0.05}
          value={r?.trackVolume ?? 1}
          onInput={(e) => {
            r?.setTrackVolume(parseFloat((e.target as HTMLInputElement).value))
            this.forceUpdate()
          }}
        />
      </div>
    )
  }
}
