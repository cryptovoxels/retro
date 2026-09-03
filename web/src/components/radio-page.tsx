import { useState } from 'preact/hooks'
import { trackTitle } from '../../../common/soundtracks'
import { DAY, Spot, VoxelRadioEngine } from '../radio/engine'
import { clock, Knob, sec, transport, useRadio } from '../radio/ui'
import { truncate } from '../lib/string-utils'

function rows(r: VoxelRadioEngine | null) {
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

// full radio at /radio
export default function RadioPage() {
  const [r, refresh] = useRadio()
  const showPlay = !r || r.muted || r.stalled
  const onAir = r?.onAir ?? false
  const ducked = !!r?.userDucked && !!r?.duckTitle
  const text = truncate(onAir ? 'dj on the mic...' : ducked ? r!.duckTitle! : r?.title || 'tuning in...', 15)
  const pct = Math.round((sec() / DAY) * 100)

  return (
    <div>
      <h1>Radio</h1>
      <p>
        <span>{onAir ? 'Radio / on air' : 'Radio'}</span>
        <span>{text}</span>
      </p>

      <button
        type="button"
        onClick={() => {
          transport(r)
          refresh()
        }}
        title={showPlay ? 'play' : 'stop'}
      >
        {showPlay ? 'play' : 'stop'}
      </button>
      <div style={{ height: '0.25rem', background: 'var(--tinge)' }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--bright)' }} />
      </div>

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
          refresh()
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
          refresh()
        }}
      />

      <h3>playlist</h3>

      <ul>{rows(r)}</ul>
    </div>
  )
}
