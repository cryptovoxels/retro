import { Knob, transport, useRadio } from '../radio/ui'
import { truncate } from '../lib/string-utils'

// mini radio in the header nav
export default function VoxelRadio() {
  const [r, refresh] = useRadio()
  const showPlay = !r || r.muted || r.stalled
  const ducked = !!r?.userDucked && !!r?.duckTitle
  const text = truncate(r?.onAir ? 'dj on the mic...' : ducked ? r!.duckTitle! : r?.title || 'tuning in...', 15)

  return (
    <div class="voxel-radio" onPointerDown={() => r?.wake()}>
      <button
        type="button"
        onClick={() => {
          transport(r)
          refresh()
        }}
        title={showPlay ? 'play' : 'pause'}
      >
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
            refresh()
          }}
        />
      )}
    </div>
  )
}
