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

export type PedalId = 'eq' | 'rvb' | 'dly' | 'drv'
export const PEDALS: PedalId[] = ['eq', 'rvb', 'dly', 'drv']

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

function loadChain(): PedalId[] {
  try {
    const raw = localStorage.getItem('radio.chain')
    if (!raw) return ['eq', 'rvb', 'dly', 'drv']
    const chain = JSON.parse(raw) as PedalId[]
    if (!Array.isArray(chain)) return ['eq']
    return chain.filter((id) => PEDALS.includes(id))
  } catch {
    return ['eq']
  }
}

function saveChain(chain: PedalId[]) {
  try {
    localStorage.setItem('radio.chain', JSON.stringify(chain))
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

let drive: Float32Array | null = null
function driveCurve(): Float32Array {
  if (drive) return drive
  const n = 256
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1
    c[i] = Math.tanh(x * 4)
  }
  drive = c
  return c
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
  trackVol: GainNode
  spotVol: GainNode
  analyser: AnalyserNode

  // eq pedal
  eqIn: GainNode
  eqOut: GainNode
  eqFilter: BiquadFilterNode

  // rvb pedal
  rvbIn: GainNode
  rvbOut: GainNode
  rvbDry: GainNode
  rvbWet: GainNode
  rvbConv: ConvolverNode

  // dly pedal
  dlyIn: GainNode
  dlyOut: GainNode
  dlyDry: GainNode
  dlyWet: GainNode
  dlyNode: DelayNode
  dlyFb: GainNode

  // drv pedal
  drvIn: GainNode
  drvOut: GainNode
  drvDry: GainNode
  drvWet: GainNode
  drvShape: WaveShaperNode

  chain: PedalId[] = ['eq']

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
    this.trackVol = this.ctx.createGain()
    this.spotVol = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256

    this.eqIn = this.ctx.createGain()
    this.eqOut = this.ctx.createGain()
    this.eqFilter = this.ctx.createBiquadFilter()
    this.eqFilter.type = 'lowpass'
    this.eqFilter.frequency.value = 20000
    this.eqIn.connect(this.eqFilter)
    this.eqFilter.connect(this.eqOut)

    this.rvbIn = this.ctx.createGain()
    this.rvbOut = this.ctx.createGain()
    this.rvbDry = this.ctx.createGain()
    this.rvbWet = this.ctx.createGain()
    this.rvbConv = this.ctx.createConvolver()
    this.rvbConv.buffer = impulse(this.ctx)
    this.rvbIn.connect(this.rvbDry)
    this.rvbIn.connect(this.rvbConv)
    this.rvbDry.connect(this.rvbOut)
    this.rvbConv.connect(this.rvbWet)
    this.rvbWet.connect(this.rvbOut)

    this.dlyIn = this.ctx.createGain()
    this.dlyOut = this.ctx.createGain()
    this.dlyDry = this.ctx.createGain()
    this.dlyWet = this.ctx.createGain()
    this.dlyNode = this.ctx.createDelay(1)
    this.dlyNode.delayTime.value = 0.28
    this.dlyFb = this.ctx.createGain()
    this.dlyIn.connect(this.dlyDry)
    this.dlyIn.connect(this.dlyNode)
    this.dlyDry.connect(this.dlyOut)
    this.dlyNode.connect(this.dlyWet)
    this.dlyWet.connect(this.dlyOut)
    this.dlyNode.connect(this.dlyFb)
    this.dlyFb.connect(this.dlyNode)

    this.drvIn = this.ctx.createGain()
    this.drvOut = this.ctx.createGain()
    this.drvDry = this.ctx.createGain()
    this.drvWet = this.ctx.createGain()
    this.drvShape = this.ctx.createWaveShaper()
    this.drvShape.curve = driveCurve()
    this.drvShape.oversample = '2x'
    this.drvIn.connect(this.drvDry)
    this.drvIn.connect(this.drvShape)
    this.drvDry.connect(this.drvOut)
    this.drvShape.connect(this.drvWet)
    this.drvWet.connect(this.drvOut)

    this.trackVol.connect(this.duckGain)
    this.duckGain.connect(this.master)
    this.master.connect(dest)
    this.master.connect(this.analyser)
    this.spotVol.connect(this.master)

    this.loadSettings()
  }

  private pedalIn(id: PedalId) {
    if (id === 'eq') return this.eqIn
    if (id === 'rvb') return this.rvbIn
    if (id === 'dly') return this.dlyIn
    return this.drvIn
  }

  private pedalOut(id: PedalId) {
    if (id === 'eq') return this.eqOut
    if (id === 'rvb') return this.rvbOut
    if (id === 'dly') return this.dlyOut
    return this.drvOut
  }

  connectChain() {
    try {
      this.music.disconnect()
    } catch {}
    let node: AudioNode = this.music
    for (const id of this.chain) {
      const input = this.pedalIn(id)
      const output = this.pedalOut(id)
      try {
        input.disconnect()
      } catch {}
      try {
        output.disconnect()
      } catch {}
      node.connect(input)
      node = output
    }
    node.connect(this.trackVol)
  }

  private loadSettings() {
    const legacy = localStorage.getItem('radio.filter')
    if (legacy != null && localStorage.getItem('radio.eq') == null) {
      save('radio.eq', num('radio.filter', 0))
    }
    this.setTrackVolume(num('radio.track', 1))
    this.setSpotVolume(num('radio.spot', 1))
    this.chain = loadChain()
    for (const id of PEDALS) this.applyPedal(id, this.pedalAmount(id))
    this.connectChain()
  }

  setTrackVolume(v: number) {
    this.trackVol.gain.value = clamp(v)
    save('radio.track', clamp(v))
  }

  setSpotVolume(v: number) {
    this.spotVol.gain.value = clamp(v)
    save('radio.spot', clamp(v))
  }

  pedalAmount(id: PedalId) {
    if (id === 'eq') return num('radio.eq', num('radio.filter', 0))
    return num(`radio.${id}`, 0)
  }

  setPedal(id: PedalId, v: number) {
    if (id === 'eq') v = Math.max(-1, Math.min(1, v || 0))
    else v = clamp(v)
    this.applyPedal(id, v)
    save(`radio.${id}`, v)
  }

  private applyPedal(id: PedalId, v: number) {
    if (id === 'eq') {
      const a = Math.abs(v)
      if (v < 0) {
        this.eqFilter.type = 'lowpass'
        this.eqFilter.frequency.value = 20000 * Math.pow(300 / 20000, a)
      } else {
        this.eqFilter.type = 'highpass'
        this.eqFilter.frequency.value = 20 * Math.pow(5000 / 20, a)
      }
      this.eqFilter.Q.value = a * 6
      return
    }
    if (id === 'rvb') {
      this.rvbWet.gain.value = v * 0.75
      this.rvbDry.gain.value = 1 - v * 0.35
      return
    }
    if (id === 'dly') {
      this.dlyWet.gain.value = v * 0.55
      this.dlyDry.gain.value = 1 - v * 0.25
      this.dlyFb.gain.value = v * 0.42
      this.dlyNode.delayTime.value = 0.15 + v * 0.35
      return
    }
    this.drvWet.gain.value = v * 0.85
    this.drvDry.gain.value = 1 - v * 0.55
  }

  addPedal(id: PedalId) {
    if (this.chain.includes(id) || this.chain.length >= 6) return
    this.chain.push(id)
    saveChain(this.chain)
    this.connectChain()
    this.onChange?.()
  }

  removePedal(id: PedalId) {
    this.chain = this.chain.filter((x) => x !== id)
    saveChain(this.chain)
    this.connectChain()
    this.onChange?.()
  }

  // old name, playlist still uses it
  setFilter(f: number) {
    this.setPedal('eq', f)
  }

  get trackVolume() {
    return this.trackVol.gain.value
  }
  get spotVolume() {
    return this.spotVol.gain.value
  }
  get filterAmount() {
    return this.pedalAmount('eq')
  }

  get title() {
    return this.track ? trackTitle(this.track) : ''
  }

  // waiting on a user gesture (autoplay policy) or not loaded yet
  get stalled() {
    return !this.muted && (!this.el || this.el.paused)
  }

  wake() {
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
    this.el?.play()
      .then(() => this.onChange?.())
      .catch(() => {})
  }

  start() {
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

  private sync() {
    if (!this.schedule) return
    const s = sec()
    const seg = this.schedule.segments.find((g) => g.startsAt <= s && s < g.startsAt + g.duration) ?? this.schedule.segments[0]

    this.playSegment(seg, s - seg.startsAt)

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
      const retry = () => {
        el.play()
          .then(() => this.onChange?.())
          .catch(() => {})
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

  private tickSpots() {
    if (!this.schedule) return
    const s = sec()
    for (const spot of this.schedule.spots) {
      if (!spot.url) continue
      if (this.played.has(spot.id) || this.spots.has(spot.id)) continue
      const until = spot.atOffset - s
      if (until <= PREFETCH && until > -2) this.prefetch(spot)
    }
  }

  private async prefetch(spot: Spot) {
    this.spots.set(spot.id, null as any)
    try {
      const audio = await this.load(spot)
      const delay = Math.max(0, spot.atOffset - sec())
      setTimeout(() => this.air(spot, audio), delay * 1000)
    } catch {
      this.spots.delete(spot.id)
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

  private air(spot: Spot, buf: AudioBuffer) {
    if (this.played.has(spot.id)) return
    this.played.add(spot.id)
    this.ring(buf)
  }

  private ring(buf: AudioBuffer) {
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.spotVol)
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
    if (!this.muted) this.wake()
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
