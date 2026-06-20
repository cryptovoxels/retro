import { MUSIC_URI, Track, trackTitle } from '../../../common/soundtracks'

// Mirrors server/lib/radio.ts output (kept local: that lib is server-only).
export interface Segment extends Track {
  startsAt: number
}
export interface Spot {
  id: string
  atOffset: number
  kind: 'event' | 'parcel' | 'vibe'
}
export interface Schedule {
  utcDay: number
  daySeconds: number
  musicUri: string
  segments: Segment[]
  spots: Spot[]
}

export const DAY = 86400
const PREFETCH = 300 // grab the spot audio 5 min before it airs
const USER_DUCK = 0.15 // parcel audio playing
const SPOT_DUCK = 0.25 // DJ talking over the track

const sec = () => (Date.now() / 1000) % DAY

let opus: boolean | null = null
function canOpus() {
  if (opus === null) {
    const a = document.createElement('audio')
    opus = !!a.canPlayType('audio/webm; codecs="opus"')
  }
  return opus
}

/*
 * The one global station. Deterministic per UTC day, so everyone tuning in
 * hears the same track at the same second. Plays on its own AudioContext on
 * the homepage, or plugs into the in-world music bus when handed a destination.
 */
export class VoxelRadioEngine {
  ctx: AudioContext
  master: GainNode
  music: GainNode
  duckGain: GainNode

  schedule: Schedule | null = null
  track: Track | null = null
  el: HTMLAudioElement | null = null
  source: MediaElementAudioSourceNode | null = null
  next: ReturnType<typeof setTimeout> | null = null
  watch: ReturnType<typeof setInterval> | null = null

  spots = new Map<string, AudioBuffer>()
  played = new Set<string>()
  userDucked = false
  spotDucked = false

  muted = false
  onAir = false
  onChange: (() => void) | null = null

  constructor(destination?: AudioNode) {
    const dest = destination ?? new AudioContext().destination
    this.ctx = dest.context as AudioContext

    this.master = this.ctx.createGain()
    this.duckGain = this.ctx.createGain()
    this.music = this.ctx.createGain()

    this.music.connect(this.duckGain)
    this.duckGain.connect(this.master)
    this.master.connect(dest)
  }

  get title() {
    return this.track ? trackTitle(this.track) : ''
  }

  async start() {
    try {
      const r = await fetch('/api/radio/today.json')
      this.schedule = await r.json()
    } catch (e) {
      console.error('[radio] no schedule', e)
      return
    }

    // autoplay may be blocked until a gesture; resume on the first one.
    if (this.ctx.state === 'suspended') {
      const resume = () => this.ctx.resume()
      window.addEventListener('pointerdown', resume, { passive: true })
      window.addEventListener('keydown', resume, { passive: true })
    }

    this.sync()
    this.watch = setInterval(() => this.tickSpots(), 2000)
  }

  // play whatever the clock says should be playing right now
  private sync() {
    if (!this.schedule) return
    const s = sec()
    const seg = this.schedule.segments.find((g) => g.startsAt <= s && s < g.startsAt + g.duration) ?? this.schedule.segments[0]

    this.playSegment(seg, s - seg.startsAt)

    // re-sync exactly when this track ends -> picks up the next segment
    const remaining = Math.max(0.1, seg.startsAt + seg.duration - s)
    if (this.next) clearTimeout(this.next)
    this.next = setTimeout(() => this.sync(), remaining * 1000)
  }

  private playSegment(seg: Segment, offset: number) {
    this.teardownTrack()

    const file = !canOpus() && seg.fallback ? seg.fallback : seg.fileName
    const el = document.createElement('audio')
    el.crossOrigin = 'anonymous'
    el.src = `${MUSIC_URI}/${file}`
    el.currentTime = Math.max(0, offset)

    this.source = this.ctx.createMediaElementSource(el)
    this.source.connect(this.music)
    this.music.gain.value = seg.volume ?? 1

    el.play().catch((err) => {
      // blocked until a gesture; retry once the user interacts
      const retry = () => {
        el.play().catch(() => {})
        window.removeEventListener('pointerdown', retry)
        window.removeEventListener('keydown', retry)
      }
      window.addEventListener('pointerdown', retry, { passive: true })
      window.addEventListener('keydown', retry, { passive: true })
    })

    this.el = el
    this.track = seg
    this.onChange?.()
  }

  private teardownTrack() {
    if (this.el) {
      this.el.pause()
      this.el.remove()
      this.el = null
    }
    this.source?.disconnect()
    this.source = null
  }

  // prefetch upcoming spots and fire them dead on the clock
  private tickSpots() {
    if (!this.schedule) return
    const s = sec()
    for (const spot of this.schedule.spots) {
      if (this.played.has(spot.id) || this.spots.has(spot.id)) continue
      const until = spot.atOffset - s
      if (until <= PREFETCH && until > -2) this.prefetch(spot, s)
    }
  }

  private async prefetch(spot: Spot, at: number) {
    this.spots.set(spot.id, null as any) // claim it so we don't double-fetch
    try {
      const audio = await this.load(spot)
      const delay = Math.max(0, spot.atOffset - sec())
      setTimeout(() => this.air(spot, audio), delay * 1000)
    } catch (e) {
      this.spots.delete(spot.id) // let a later tick retry
    }
  }

  private async load(spot: Spot): Promise<AudioBuffer> {
    const have = this.spots.get(spot.id)
    if (have) return have
    const r = await fetch(`/api/radio/spot/${spot.id}.json`)
    const data = await r.json()
    if (!data.ok) throw new Error('spot not ready')
    const raw = await fetch(data.url).then((x) => x.arrayBuffer())
    const audio = await this.ctx.decodeAudioData(raw)
    this.spots.set(spot.id, audio)
    return audio
  }

  // scheduled airing - fires once, on the clock, for everyone
  private air(spot: Spot, buf: AudioBuffer) {
    if (this.played.has(spot.id)) return
    this.played.add(spot.id)
    this.ring(buf)
  }

  // duck the music and play a spot over the top
  private ring(buf: AudioBuffer) {
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.master) // spots ride over the (ducked) music
    src.onended = () => {
      this.spotDucked = false
      this.applyDuck()
      this.onAir = false
      this.onChange?.()
    }

    this.spotDucked = true
    this.applyDuck()
    this.onAir = true
    this.onChange?.()
    src.start()
  }

  // playlist click: play a spot for this listener now, over the music,
  // without touching the track playhead or the global schedule
  async previewSpot(spot: Spot) {
    try {
      const buf = await this.load(spot)
      this.ring(buf)
    } catch (e) {
      console.error('[radio] preview failed', e)
    }
  }

  private applyDuck() {
    const target = this.spotDucked ? SPOT_DUCK : this.userDucked ? USER_DUCK : 1
    this.duckGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2)
  }

  // parcel audio (boombox/video/etc) ducks the radio under it via the in-world AudioEngine
  duck() {
    this.userDucked = true
    this.applyDuck()
  }

  unduck() {
    this.userDucked = false
    this.applyDuck()
  }

  toggle() {
    this.muted = !this.muted
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05)
    if (!this.muted && this.ctx.state === 'suspended') this.ctx.resume()
    this.onChange?.()
  }

  stop() {
    if (this.next) clearTimeout(this.next)
    if (this.watch) clearInterval(this.watch)
    this.next = null
    this.watch = null
    this.teardownTrack()
    this.onChange = null
  }
}
