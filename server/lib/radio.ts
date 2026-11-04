import { MUSIC_URI, tracks } from '../../common/soundtracks'
import { seededShuffle } from '../../common/helpers/utils'

const DAY = 86400
export interface Segment {
  fileName: string
  fallback?: string
  duration: number
  volume?: number
  startsAt: number
}

export interface Schedule {
  utcDay: number
  daySeconds: number
  musicUri: string
  segments: Segment[]
}

export function utcDay(): number {
  return Math.floor(Date.now() / 1000 / DAY)
}

// Deterministic per UTC day: same station for everyone, regenerates at midnight.
export function buildSchedule(day: number): Schedule {
  const order = seededShuffle(tracks.slice(), day + 1)

  const segments: Segment[] = []
  let t = 0
  let i = 0
  while (t < DAY) {
    const track = order[i % order.length]
    segments.push({ ...track, startsAt: t })
    t += track.duration
    i++
  }

  return { utcDay: day, daySeconds: DAY, musicUri: MUSIC_URI, segments }
}
