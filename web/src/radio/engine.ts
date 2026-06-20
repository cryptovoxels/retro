import { MUSIC_URI, Track, trackTitle } from '../../../common/soundtracks'

// Mirrors server/lib/radio.ts output (kept local: that lib is server-only).
export interface Segment extends Track {
  startsAt: number
}
export interface Spot {
  id: string
  atOffset: number
  kind: 'en' | 'ar'
  url?: string
  summary?: string
  parcelId?: number
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

const clamp = (v: number) => Math.max(0, Math.min(1, v || 0))

function num(key: string, def: number): number {
  try {
    const v = parseFloat(localStorage.getItem(key) ?? '')
    return isNaN(v) ? def : v
  } catch {
    return def
  }
}

function save(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v))
  } catch {}
}

// synthetic reverb tail - decaying stereo noise, no asset fetch
let ir: AudioBuffer | null = null
function impulse(ctx: AudioContext): AudioBuffer {
  if (ir && ir.sampleRate === ctx.sampleRate) return ir
  const len = ctx.sampleRate * 2
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
  }
  ir = buf
  return buf
}

/*
 * The one global station. Deterministic per UTC day, so everyone tuning in
 * hears the same track at the same second. The schedule + generated spots
 * stream in over SSE (/api/radio/live); the server owns generation. Plays on
 * its own AudioContext on the homepage, or plugs into the in-world music bus
 * when handed a destination.
 */
export class VoxelRadioEngine {
  ctx: AudioContext
  master: GainNode
  music: GainNode
  duckGain: GainNode
  filter: BiquadFilterNode
  convolver: ConvolverNode
  dry: GainNode
  wet: GainNode
  trackVol: GainNode
  spotVol: GainNode
  analyser: AnalyserNode

  schedule: Schedule | null = null
  track: Track | null = null
  el: HTMLAudioElement | null = null
  source: MediaElementAudioSourceNode | null = null
  es: EventSource | null = null
  next: ReturnType<typeof setTimeout> | null = null
  watch: ReturnType<typeof setInterval> | null = null
  started = false

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
    this.filter = this.ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 20000
    this.convolver = this.ctx.createConvolver()
    this.convolver.buffer = impulse(this.ctx)
    this.dry = this.ctx.createGain()
    this.wet = this.ctx.createGain()
    this.wet.gain.value = 0
    this.trackVol = this.ctx.createGain()
    this.spotVol = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256

    // music -> filter -> (dry + reverb wet) -> trackVol -> duck -> master -> dest
    this.music.connect(this.filter)
    this.filter.connect(this.dry)
    this.filter.connect(this.convolver)
    this.convolver.connect(this.wet)
    this.dry.connect(this.trackVol)
    this.wet.connect(this.trackVol)
    this.trackVol.connect(this.duckGain)
    this.duckGain.connect(this.master)
    this.master.connect(dest)
    this.master.connect(this.analyser) // tap for the visualiser

    // spots ride over the (ducked) music at their own volume
    this.spotVol.connect(this.master)

    this.loadSettings()
  }

  private loadSettings() {
    this.setTrackVolume(num('radio.track', 1))
    this.setSpotVolume(num('radio.spot', 1))
    this.setFilter(num('radio.filter', 0))
  }

  setTrackVolume(v: number) {
    this.trackVol.gain.value = clamp(v)
    save('radio.track', clamp(v))
  }

  setSpotVolume(v: number) {
    this.spotVol.gain.value = clamp(v)
    save('radio.spot', clamp(v))
  }

  // dj-style bipolar filter: -1 = lowpass, 0 = clean, +1 = highpass.
  // resonance and reverb climb as you leave centre for that sweep feel.
  setFilter(f: number) {
    f = Math.max(-1, Math.min(1, f || 0))
    const a = Math.abs(f)
    if (f < 0) {
      this.filter.type = 'lowpass'
      this.filter.frequency.value = 20000 * Math.pow(300 / 20000, a) // 20k -> 300hz
    } else {
      this.filter.type = 'highpass'
      this.filter.frequency.value = 20 * Math.pow(5000 / 20, a) // 20hz -> 5k
    }
    this.filter.Q.value = a * 6 // resonant peak grows off centre
    this.wet.gain.value = 0.5 * a
    this.dry.gain.value = 1 - 0.3 * a
    save('radio.filter', f)
  }

  get trackVolume() {
    return this.trackVol.gain.value
  }
  get spotVolume() {
    return this.spotVol.gain.value
  }
  get filterAmount() {
    return num('radio.filter', 0)
  }

  get title() {
    return this.track ? trackTitle(this.track) : ''
  }

  start() {
    // autoplay may be blocked until a gesture; resume on the first one.
    if (this.ctx.state === 'suspended') {
      const resume = () => this.ctx.resume()
      window.addEventListener('pointerdown', resume, { passive: true })
      window.addEventListener('keydown', resume, { passive: true })
    }

    this.es = new EventSource('/api/radio/live')
    this.es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'snapshot') this.applySchedule(msg.schedule)
      } catch {}
    }
  }

  private applySchedule(sched: Schedule) {
    this.schedule = sched
    if (!this.started) {
      this.started = true
      this.sync()
      this.watch = setInterval(() => this.tickSpots(), 2000)
    }
    this.onChange?.()
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

    el.play().catch(() => {
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

  // prefetch generated spots and fire them dead on the clock
  private tickSpots() {
    if (!this.schedule) return
    const s = sec()
    for (const spot of this.schedule.spots) {
      if (!spot.url) continue // not generated yet
      if (this.played.has(spot.id) || this.spots.has(spot.id)) continue
      const until = spot.atOffset - s
      if (until <= PREFETCH && until > -2) this.prefetch(spot)
    }
  }

  private async prefetch(spot: Spot) {
    this.spots.set(spot.id, null as any) // claim it so we don't double-fetch
    try {
      const audio = await this.load(spot)
      const delay = Math.max(0, spot.atOffset - sec())
      setTimeout(() => this.air(spot, audio), delay * 1000)
    } catch {
      this.spots.delete(spot.id) // let a later tick retry
    }
  }

  private async load(spot: Spot): Promise<AudioBuffer> {
    const have = this.spots.get(spot.id)
    if (have) return have
    if (!spot.url) throw new Error('spot not ready')
    const raw = await fetch(spot.url).then((x) => x.arrayBuffer())
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
    src.connect(this.spotVol) // spots ride over the (ducked) music at their own volume
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
    if (!spot.url) return
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
    this.es?.close()
    this.es = null
    this.next = null
    this.watch = null
    this.teardownTrack()
    this.onChange = null
  }
}
