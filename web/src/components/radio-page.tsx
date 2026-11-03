import { trackTitle } from '../../../common/soundtracks'
import { Spot, VoxelRadioEngine } from '../radio/engine'
import { clock, sec, transport, useRadio } from '../radio/ui'

function rows(r: VoxelRadioEngine | null) {
  const sched = r?.schedule
  if (!sched) return null
  const now = sec()

  const items: { at: number; label: string; spot?: Spot }[] = []
  sched.segments.forEach((g) => items.push({ at: g.startsAt, label: trackTitle(g) }))
  sched.spots.forEach((s) => items.push({ at: s.atOffset, label: s.summary || 'spot', spot: s }))
  items.sort((a, b) => a.at - b.at)

  let cur = 0
  for (let i = 0; i < items.length; i++) if (items[i].at <= now) cur = i

  const from = Math.max(0, cur - 6)
  return items.slice(from, cur + 14).map((it) => {
    const live = it === items[cur]
    const parcelId = it.spot?.parcelId
    const name = parcelId ? <a href={`/parcels/${parcelId}/play`}>{it.label}</a> : <span>{it.label}</span>
    return (
      <li key={`${it.at}-${it.label}`} class={live ? 'selected' : ''} aria-current={live ? 'true' : undefined} onClick={it.spot && !parcelId ? () => r?.previewSpot(it.spot!) : undefined}>
        <time>{clock(it.at)}</time>
        {name}
      </li>
    )
  })
}

// full radio at /radio
export default function RadioPage() {
  const [r, refresh] = useRadio()
  const showPlay = !r || r.muted || r.stalled
  const onAir = r?.onAir ?? false
  const ducked = !!r?.userDucked && !!r?.duckTitle
  const text = onAir ? 'dj on the mic...' : ducked ? r!.duckTitle! : r?.title || 'tuning in...'

  return (
    <section class="radio-page">
      <h1>Radio</h1>
      <div class="radio-transport">
        <div>
          <small>{onAir ? 'on air' : 'now playing'}</small>
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

      <h3>volume</h3>
      <dl class="props">
        <dt>
          <label for="radio-music">Music</label>
        </dt>
        <dd>
          <input
            id="radio-music"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={r?.trackVolume ?? 1}
            onInput={(e) => {
              r?.setTrackVolume(Number(e.currentTarget.value))
              refresh()
            }}
          />
        </dd>
        <dt>
          <label for="radio-spots">Announcements</label>
        </dt>
        <dd>
          <input
            id="radio-spots"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={r?.spotVolume ?? 1}
            onInput={(e) => {
              r?.setSpotVolume(Number(e.currentTarget.value))
              refresh()
            }}
          />
        </dd>
      </dl>

      <h3>
        playlist <small>{clock(sec())} UTC</small>
      </h3>

      <ul>{rows(r)}</ul>
    </section>
  )
}
