import { trackTitle } from '../../../common/soundtracks'
import { VoxelRadioEngine } from '../radio/engine'
import { clock, sec, transport, useRadio } from '../radio/ui'

function rows(r: VoxelRadioEngine | null) {
  const sched = r?.schedule
  if (!sched) return null
  const now = sec()

  const items = sched.segments.map((g) => ({ at: g.startsAt, label: trackTitle(g) }))

  let cur = 0
  for (let i = 0; i < items.length; i++) if (items[i].at <= now) cur = i

  const from = Math.max(0, cur - 6)
  return items.slice(from, cur + 14).map((it) => {
    const live = it === items[cur]
    return (
      <li key={`${it.at}-${it.label}`} class={live ? 'selected' : ''} aria-current={live ? 'true' : undefined}>
        <time>{clock(it.at)}</time>
        <span>{it.label}</span>
      </li>
    )
  })
}

// full radio at /radio
export default function RadioPage() {
  const [r, refresh] = useRadio()
  const showPlay = !r || r.muted || r.stalled
  const text = r?.title || 'tuning in...'

  return (
    <section class="radio-page">
      <h1>Radio</h1>
      <div class="radio-transport">
        <div>
          <small>now playing</small>
          <strong>{text}</strong>
        </div>
        <button
          type="button"
          onClick={() => {
            transport(r)
            refresh()
          }}
        >
          {showPlay ? 'Play' : 'Pause'}
        </button>
      </div>

      <h3>
        playlist <small>{clock(sec())} UTC</small>
      </h3>

      <ul>{rows(r)}</ul>
    </section>
  )
}
