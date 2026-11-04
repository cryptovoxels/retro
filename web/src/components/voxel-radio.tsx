import { transport, useRadio } from '../radio/ui'
import { truncate } from '../lib/string-utils'

// mini radio in the header nav
export default function VoxelRadio() {
  const [r, refresh] = useRadio()
  const showPlay = !r || r.muted || r.stalled
  const text = truncate(r?.title || 'tuning in...', 15)

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
      {(r?.pinned || r?.duckSrc) && (
        <button type="button" onClick={() => (r.pinned ? r.unpin() : r.pin())} title={r.pinned ? 'back to voxels radio' : 'keep playing this when you walk away'}>
          {r.pinned ? 'unpin' : 'pin'}
        </button>
      )}
    </div>
  )
}
