import { MUSIC_URI, Track, trackTitle } from '../../../common/soundtracks'
import { isIOS, isTablet } from '../../../common/helpers/detector'

const appleTouch = () => isIOS() || isTablet()

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

export type PedalId = 'eq' | 'wob' | 'dly' | 'chp'
export const PEDALS: PedalId[] = ['eq', 'wob', 'dly', 'chp']

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
  return [...PEDALS]
}

function saveChain(chain: PedalId[]) {
  try {
    localStorage.setItem('radio.chain', JSON.stringify(chain))
  } catch {}
}

/*
 * The one global station. Deterministic per UTC day, so everyone tuning in
 * hears the same track at the same second. The schedule + generated spots
 * stream in over SSE (/api/radio/live); the server owns generation.
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

  // dly pedal
  dlyIn: GainNode
  dlyOut: GainNode
  dlyDry: GainNode
  dlyWet: GainNode
  dlyNode: DelayNode
  dlyFb: GainNode
  dlyLp: BiquadFilterNode

  // chp pedal - trance gate
  chpIn: GainNode
  chpOut: GainNode
  chpGain: GainNode
  chpLfo: OscillatorNode
  chpLfoGain: GainNode

  // wob pedal - serial filter, lfo on cutoff
  wobIn: GainNode
  wobOut: GainNode
  wobFilter: BiquadFilterNode
  wobLfo: OscillatorNode
  wobLfoGain: GainNode

  wobAmt = 0
  wobX = 0
  wobY = 0
  dlyAmt = 0
  dlyV = 0
  chpAmt = 0
  chpV = 0
  fx: Record<PedalId, number> = { eq: 0, wob: 0, dly: 0, chp: 0 }
  fxBytes = new Uint8Array(128)
  fxTd = new Uint8Array(256)
  fxWatch: ReturnType<typeof setInterval> | null = null

  private glide(param: AudioParam, val: number, s = 0.03) {
    if (this.ctx.state !== 'running') {
      try {
        param.cancelScheduledValues(0)
      } catch {}
      param.value = val
      return
    }
    const t = this.ctx.currentTime
    param.cancelScheduledValues(t)
    param.setTargetAtTime(val, t, s)
  }

  chain: PedalId[] = [...PEDALS]

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
    this.ctx = (destination?.context as AudioContext) ?? new AudioContext()
    const dest = destination ?? this.ctx.destination

    this.master = this.ctx.createGain()
    this.duckGain = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.trackVol = this.ctx.createGain()
    this.spotVol = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.smoothingTimeConstant = 0.55
    this.analyser.minDecibels = -85
    this.analyser.maxDecibels = -10

    this.eqIn = this.ctx.createGain()
    this.eqOut = this.ctx.createGain()
    this.eqFilter = this.ctx.createBiquadFilter()
    this.eqFilter.type = 'lowpass'
    this.eqFilter.frequency.value = 20000
    this.eqIn.connect(this.eqFilter)
    this.eqFilter.connect(this.eqOut)

    this.dlyIn = this.ctx.createGain()
    this.dlyOut = this.ctx.createGain()
    this.dlyDry = this.ctx.createGain()
    this.dlyWet = this.ctx.createGain()
    this.dlyNode = this.ctx.createDelay(1)
    this.dlyNode.delayTime.value = 0.28
    this.dlyFb = this.ctx.createGain()
    this.dlyLp = this.ctx.createBiquadFilter()
    this.dlyLp.type = 'lowpass'
    this.dlyLp.frequency.value = 20000
    this.dlyIn.connect(this.dlyDry)
    this.dlyIn.connect(this.dlyNode)
    this.dlyDry.connect(this.dlyOut)
    this.dlyNode.connect(this.dlyLp)
    this.dlyLp.connect(this.dlyWet)
    this.dlyWet.connect(this.dlyOut)
    this.dlyLp.connect(this.dlyFb)
    this.dlyFb.connect(this.dlyNode)

    this.chpIn = this.ctx.createGain()
    this.chpOut = this.ctx.createGain()
    this.chpGain = this.ctx.createGain()
    this.chpGain.gain.value = 1
    this.chpLfo = this.ctx.createOscillator()
    this.chpLfo.type = 'square'
    this.chpLfo.frequency.value = 4
    this.chpLfoGain = this.ctx.createGain()
    this.chpLfoGain.gain.value = 0
    this.chpLfo.connect(this.chpLfoGain)
    this.chpLfoGain.connect(this.chpGain.gain)
    this.chpIn.connect(this.chpGain)
    this.chpGain.connect(this.chpOut)
    this.chpLfo.start()

    this.wobIn = this.ctx.createGain()
    this.wobOut = this.ctx.createGain()
    this.wobFilter = this.ctx.createBiquadFilter()
    this.wobFilter.type = 'lowpass'
    this.wobFilter.frequency.value = 18000
    this.wobFilter.Q.value = 0.7
    this.wobLfo = this.ctx.createOscillator()
    this.wobLfo.type = 'sine'
    this.wobLfo.frequency.value = 2
    this.wobLfoGain = this.ctx.createGain()
    this.wobLfoGain.gain.value = 0
    this.wobLfo.connect(this.wobLfoGain)
    this.wobLfoGain.connect(this.wobFilter.frequency)
    this.wobIn.connect(this.wobFilter)
    this.wobFilter.connect(this.wobOut)
    this.wobLfo.start()

    this.trackVol.connect(this.duckGain)
    this.duckGain.connect(this.master)
    this.master.connect(this.analyser)
    this.analyser.connect(dest)
    this.spotVol.connect(this.master)

    this.loadSettings()
    this.fxWatch = setInterval(() => this.pumpFx(), 50)
  }

  private ensureSource() {
    if (this.source || !this.el) return
    try {
      this.source = this.ctx.createMediaElementSource(this.el)
    } catch (e) {
      console.error('[radio] media source failed', e)
      return
    }
    this.hookTrack()
  }

  private readBass() {
    if (appleTouch()) {
      this.analyser.getByteTimeDomainData(this.fxTd)
      let peak = 0
      let rms = 0
      for (let i = 0; i < this.fxTd.length; i++) {
        const v = (this.fxTd[i] - 128) / 128
        const a = Math.abs(v)
        if (a > peak) peak = a
        rms += v * v
      }
      return Math.min(1, Math.max(Math.sqrt(rms / this.fxTd.length) * 10, peak * 3))
    }

    this.analyser.getByteFrequencyData(this.fxBytes)
    let bass = 0
    for (let i = 0; i < 6; i++) bass += this.fxBytes[i]
    bass /= 6 * 255
    if (bass > 0.01) return bass

    this.analyser.getByteTimeDomainData(this.fxTd)
    let rms = 0
    for (let i = 0; i < this.fxTd.length; i++) {
      const v = (this.fxTd[i] - 128) / 128
      rms += v * v
    }
    return Math.min(1, Math.sqrt(rms / this.fxTd.length) * 3)
  }

  readLevel() {
    if (this.muted || this.stalled) return 0
    try {
      return this.readBass()
    } catch {
      return 0
    }
  }

  private pumpFx() {
    if (this.wobAmt < 0.02 && this.dlyAmt < 0.02 && this.chpAmt < 0.02) return
    const bass = this.readBass()
    let mid = 0
    if (this.dlyAmt > 0.02) {
      this.analyser.getByteFrequencyData(this.fxBytes)
      for (let i = 8; i < 22; i++) mid += this.fxBytes[i]
      mid /= 14 * 255
      if (mid < 0.01) mid = bass
    }
    if (this.wobAmt > 0.02) this.applyWob(this.wobAmt, bass)
    if (this.dlyAmt > 0.02) this.applyDly(this.dlyV, mid)
    if (this.chpAmt > 0.02) this.applyChp(this.chpV, bass)
  }

  private applyDly(v: number, mid = 0) {
    const a = Math.abs(v)
    const t = a * a
    if (t < 0.001) {
      this.glide(this.dlyWet.gain, 0, 0.02)
      this.glide(this.dlyDry.gain, 1, 0.02)
      this.glide(this.dlyFb.gain, 0, 0.02)
      this.glide(this.dlyLp.frequency, 20000, 0.02)
      return
    }
    const short = [0.07, 0.11, 0.16, 0.22]
    const long = [0.32, 0.48, 0.62, 0.78]
    const times = v < 0 ? short : long
    const slot = t * (times.length - 0.001)
    const i = Math.min(times.length - 2, Math.floor(slot))
    const time = times[i] + (times[i + 1] - times[i]) * (slot - i)
    this.glide(this.dlyWet.gain, 0.45 + t * 0.55, 0.02)
    this.glide(this.dlyDry.gain, 1 - t * 0.7, 0.02)
    this.glide(this.dlyFb.gain, 0.35 + t * 0.65 + mid * t * 0.4, 0.025)
    this.glide(this.dlyNode.delayTime, time, 0.03)
    if (v < 0) this.glide(this.dlyLp.frequency, 600 + (1 - t) * 2200, 0.025)
    else this.glide(this.dlyLp.frequency, 1800 + t * 8000, 0.025)
    this.glide(this.dlyLp.Q, v < 0 ? 1.2 + t * 2 : 0.6, 0.02)
  }

  private applyChp(v: number, bass = 0) {
    const a = Math.abs(v)
    const t = a * a
    if (t < 0.001) {
      this.glide(this.chpGain.gain, 1, 0.02)
      this.glide(this.chpLfoGain.gain, 0, 0.02)
      return
    }
    const hz = v < 0 ? 2.5 + t * 5 : 7 + t * 14
    this.glide(this.chpGain.gain, 0.5, 0.015)
    this.glide(this.chpLfoGain.gain, 0.5 * t, 0.015)
    this.glide(this.chpLfo.frequency, hz + bass * t * 5, 0.025)
  }

  private applyWob(v: number, bass = 0, x = this.wobX, y = this.wobY) {
    const t = v > 0.001 ? 1 - Math.pow(1 - v, 1.55) : 0
    const xf = (x + 1) / 2
    const yf = (y + 1) / 2
    this.glide(this.wobFilter.frequency, 400 + (1 - t) * (8000 + xf * 9000), 0.04)
    this.glide(this.wobFilter.Q, 1 + t * (8 + yf * 10), 0.03)
    this.glide(this.wobLfoGain.gain, t * (2000 + yf * 1400) + bass * v * 2000, 0.035)
    this.glide(this.wobLfo.frequency, 0.5 + t * (2 + yf * 6) + bass * 3.5, 0.04)
  }

  private applyEq(v: number) {
    const a = Math.abs(v)
    const t = a * a
    if (v < 0) {
      this.eqFilter.type = 'lowpass'
      this.glide(this.eqFilter.frequency, 20000 * Math.pow(180 / 20000, t), 0.025)
    } else if (v > 0) {
      this.eqFilter.type = 'highpass'
      this.glide(this.eqFilter.frequency, 20 * Math.pow(6000 / 20, t), 0.025)
    } else {
      this.eqFilter.type = 'lowpass'
      this.glide(this.eqFilter.frequency, 20000, 0.02)
    }
    this.glide(this.eqFilter.Q, 2 + t * 18, 0.02)
  }

  private pedalIn(id: PedalId) {
    if (id === 'eq') return this.eqIn
    if (id === 'wob') return this.wobIn
    if (id === 'dly') return this.dlyIn
    return this.chpIn
  }

  private pedalOut(id: PedalId) {
    if (id === 'eq') return this.eqOut
    if (id === 'wob') return this.wobOut
    if (id === 'dly') return this.dlyOut
    return this.chpOut
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
        output.disconnect()
      } catch {}
      node.connect(input)
      node = output
    }
    node.connect(this.trackVol)
    this.hookTrack()
  }

  private hookTrack() {
    if (!this.source) return
    try {
      this.source.disconnect()
    } catch {}
    this.source.connect(this.music)
  }

  private loadSettings() {
    this.setTrackVolume(num('radio.track', 1))
    this.setSpotVolume(num('radio.spot', 1))
    this.chain = loadChain()
    this.fx = { eq: 0, wob: 0, dly: 0, chp: 0 }
    for (const id of PEDALS) this.applyPedal(id, 0)
    this.applyWob(0, 0, 0, 0)
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
    return this.fx[id] ?? 0
  }

  setPedal(id: PedalId, v: number) {
    v = Math.max(-1, Math.min(1, v || 0))
    this.fx[id] = v
    this.applyPedal(id, v)
    if (this.ctx.state !== 'running') this.wake()
  }

  setWobPad(x: number, y: number) {
    x = Math.max(-1, Math.min(1, x || 0))
    y = Math.max(-1, Math.min(1, y || 0))
    this.wobX = x
    this.wobY = y
    this.wobAmt = Math.min(1, Math.hypot(x, y))
    this.applyWob(this.wobAmt, 0, x, y)
    if (this.ctx.state !== 'running') this.wake()
  }

  private refreshFx() {
    for (const id of PEDALS) this.applyPedal(id, this.pedalAmount(id))
  }

  private applyPedal(id: PedalId, v: number) {
    if (id === 'eq') {
      this.applyEq(v)
      return
    }
    const amt = Math.abs(v)
    if (id === 'wob') {
      this.wobAmt = amt
      this.wobX = 0
      this.wobY = amt > 0 ? 1 : 0
      this.applyWob(amt, 0, this.wobX, this.wobY)
      return
    }
    if (id === 'dly') {
      this.dlyAmt = amt
      this.dlyV = v
      this.applyDly(v)
      return
    }
    this.chpAmt = amt
    this.chpV = v
    this.applyChp(v)
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
    const reconnect = this.ctx.state !== 'running'
    const go = () => {
      if (!this.muted) this.master.gain.value = 1
      this.ensureSource()
      this.refreshFx()
      if (reconnect) this.connectChain()
      else if (this.source) this.hookTrack()
      this.el
        ?.play()
        .then(() => this.onChange?.())
        .catch(() => {})
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().then(go).catch(go)
    else go()
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
    el.preload = 'auto'
    el.src = `${MUSIC_URI}/${file}`
    el.style.display = 'none'
    document.body.appendChild(el)

    const dur = seg.duration || 0
    const t = dur > 0 ? Math.min(Math.max(0, offset), dur - 0.25) : Math.max(0, offset)

    this.el = el
    this.track = seg

    const start = () => {
      try {
        el.currentTime = t
      } catch {}
      this.music.gain.value = seg.volume ?? 1
      if (this.muted || this.ctx.state !== 'running') return
      this.ensureSource()
      el.play()
        .then(() => this.onChange?.())
        .catch(() => {
          const retry = () => {
            this.wake()
            window.removeEventListener('pointerdown', retry)
            window.removeEventListener('keydown', retry)
          }
          window.addEventListener('pointerdown', retry, { passive: true })
          window.addEventListener('keydown', retry, { passive: true })
        })
    }

    if (el.readyState >= 1) start()
    else el.addEventListener('loadedmetadata', start, { once: true })
    el.addEventListener(
      'error',
      () => {
        console.error('[radio] track load failed', file)
        this.onChange?.()
      },
      { once: true },
    )

    this.onChange?.()
  }

  private teardownTrack() {
    if (this.el) {
      this.el.pause()
      this.el.remove()
      this.el = null
    }
    if (this.source) {
      try {
        this.source.disconnect()
      } catch {}
      this.source = null
    }
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
    if (this.fxWatch) clearInterval(this.fxWatch)
    this.es?.close()
    this.es = null
    this.next = null
    this.watch = null
    this.fxWatch = null
    this.teardownTrack()
    this.onChange = null
  }
}
