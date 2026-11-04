import { MUSIC_URI, Track, trackTitle } from '../../../common/soundtracks'
import { fetchShowboxRoomToken, LIVEKIT_URL } from '../../../common/helpers/showbox-broadcast-health'

// Mirrors server/lib/radio.ts output (kept local: that lib is server-only).
export interface Segment extends Track {
  startsAt: number
}
export interface Schedule {
  utcDay: number
  daySeconds: number
  musicUri: string
  segments: Segment[]
}

export const DAY = 86400
const USER_DUCK = 0.15 // parcel audio playing

const sec = () => (Date.now() / 1000) % DAY

let opus: boolean | null = null
function canOpus() {
  if (opus === null) {
    const a = document.createElement('audio')
    opus = !!a.canPlayType('audio/webm; codecs="opus"')
  }
  return opus
}

const clamp = (v: number) => Math.max(0, Math.min(4, v || 0))

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

// "https://x.com/my_cool-song.mp3?v=1" -> "my cool song"
function urlTitle(u: string) {
  try {
    const base = decodeURIComponent((u.split('?')[0].split('/').pop() || '').replace(/\.[^.]+$/, ''))
      .replace(/[-_]+/g, ' ')
      .trim()
    return base || 'audio'
  } catch {
    return 'audio'
  }
}

/*
 * The one global station. Deterministic per UTC day, so everyone tuning in
 * hears the same track at the same second. The schedule streams over SSE.
 */
export class VoxelRadioEngine {
  ctx: AudioContext
  master: GainNode
  music: GainNode
  duckGain: GainNode
  trackVol: GainNode
  schedule: Schedule | null = null
  track: Track | null = null
  el: HTMLAudioElement | null = null
  source: MediaElementAudioSourceNode | null = null
  es: EventSource | null = null
  next: ReturnType<typeof setTimeout> | null = null
  started = false

  userDucked = false

  muted = false
  duckTitle: string | null = null
  duckSrc: string | null = null
  pinned: string | null = null
  pinnedTitle = ''
  live: any = null // livekit Room for a pinned showbox
  liveSources = new Map<string, [MediaStreamAudioSourceNode, HTMLAudioElement]>()
  onChange: (() => void) | null = null

  constructor(destination?: AudioNode) {
    this.ctx = (destination?.context as AudioContext) ?? new AudioContext()
    const dest = destination ?? this.ctx.destination

    this.master = this.ctx.createGain()
    this.duckGain = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.trackVol = this.ctx.createGain()
    this.trackVol.connect(this.duckGain)
    this.duckGain.connect(this.master)
    this.master.connect(dest)
    this.music.connect(this.trackVol)
    this.muted = num('radio.muted', 0) === 1
    this.master.gain.value = this.muted ? 0 : 1
  }

  private ensureSource() {
    if (this.source || !this.el) return
    try {
      this.source = this.ctx.createMediaElementSource(this.el)
    } catch (e) {
      console.error('[radio] media source failed', e)
      return
    }
    this.source.connect(this.music)
  }

  setVolume(v: number) {
    this.trackVol.gain.value = clamp(v)
  }

  get title() {
    if (this.userDucked && this.duckTitle) return this.duckTitle
    if (this.pinned) return this.pinnedTitle
    return this.track ? trackTitle(this.track) : ''
  }

  // waiting on a user gesture (autoplay policy) or not loaded yet
  get stalled() {
    return !this.muted && (!this.el || this.el.paused)
  }

  wake() {
    const go = () => {
      if (!this.muted) this.master.gain.value = 1
      this.ensureSource()
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
    const changed = this.schedule?.utcDay !== sched.utcDay
    this.schedule = sched
    if (!this.started || changed) {
      this.started = true
      this.sync()
    }
    this.onChange?.()
  }

  private sync() {
    if (!this.schedule || this.pinned) return
    const s = sec()
    const seg = this.schedule.segments.find((g) => g.startsAt <= s && s < g.startsAt + g.duration) ?? this.schedule.segments[0]

    this.playSegment(seg, s - seg.startsAt)

    const remaining = Math.max(0.1, seg.startsAt + seg.duration - s)
    if (this.next) clearTimeout(this.next)
    this.next = setTimeout(() => this.sync(), remaining * 1000)
  }

  private playSegment(seg: Segment, offset: number) {
    const file = !canOpus() && seg.fallback ? seg.fallback : seg.fileName
    const dur = seg.duration || 0
    const t = dur > 0 ? Math.min(Math.max(0, offset), dur - 0.25) : Math.max(0, offset)
    this.track = seg
    this.playUrl(`${MUSIC_URI}/${file}`, t, seg.volume ?? 1)
  }

  private playUrl(src: string, t: number, volume: number) {
    this.teardownTrack()

    const el = document.createElement('audio')
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.loop = !!this.pinned
    el.src = src
    el.style.display = 'none'
    document.body.appendChild(el)

    this.el = el

    const start = () => {
      try {
        el.currentTime = t
      } catch {}
      this.music.gain.value = volume
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
        console.error('[radio] track load failed', src)
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

  private applyDuck() {
    // pinned track is a copy of the parcel audio, so go silent near the real thing
    const target = this.userDucked ? (this.pinned ? 0 : USER_DUCK) : 1
    this.duckGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2)
  }

  duck(src?: string | null, title?: string) {
    this.userDucked = true
    this.duckSrc = src || null
    this.duckTitle = title || (src ? urlTitle(src) : null)
    this.applyDuck()
    this.onChange?.()
  }

  unduck() {
    this.userDucked = false
    this.duckTitle = null
    this.duckSrc = null
    this.applyDuck()
    this.onChange?.()
  }

  // keep playing the parcel track after walking away
  pin() {
    if (!this.duckSrc) return
    this.dropLive()
    this.pinned = this.duckSrc
    this.pinnedTitle = this.duckTitle || urlTitle(this.pinned)
    if (this.next) clearTimeout(this.next)
    this.next = null
    if (this.pinned.startsWith('livekit:')) this.pinLive(this.pinned.slice(8))
    else this.playUrl(this.pinned, 0, 1)
    this.applyDuck()
  }

  // own audio-only connection, so the showbox can disconnect when you walk away
  private async pinLive(roomName: string) {
    this.teardownTrack()
    const src = this.pinned
    const res = await fetchShowboxRoomToken(`/api/rooms/${roomName}/token`)
    if (!res?.token || this.pinned !== src) return
    const { Room, RoomEvent, Track } = await import('livekit-client')
    const room = new Room()
    this.live = room
    const want = (pub: any) => pub.kind === Track.Kind.Audio && pub.setSubscribed(true)
    room.on(RoomEvent.TrackPublished, want)
    room.on(RoomEvent.TrackSubscribed, (track: any) => {
      if (track.kind !== Track.Kind.Audio || this.live !== room) return
      const stream = new MediaStream([track.mediaStreamTrack])
      // chrome won't feed remote webrtc audio into webaudio unless an element is also playing it
      const el = document.createElement('audio')
      el.muted = true
      el.srcObject = stream
      el.play().catch(() => {})
      const node = this.ctx.createMediaStreamSource(stream)
      node.connect(this.music)
      this.liveSources.set(track.sid, [node, el])
      this.music.gain.value = 1
      this.wake()
    })
    room.on(RoomEvent.TrackUnsubscribed, (track: any) => this.dropSource(track.sid))
    try {
      await room.connect(LIVEKIT_URL, res.token, { autoSubscribe: false })
    } catch (e) {
      console.error('[radio] live pin failed', e)
      return
    }
    if (this.live !== room) return room.disconnect()
    for (const p of room.participants.values()) for (const pub of p.audioTracks.values()) want(pub)
  }

  private dropSource(sid: string) {
    const s = this.liveSources.get(sid)
    if (!s) return
    try {
      s[0].disconnect()
    } catch {}
    s[1].srcObject = null
    this.liveSources.delete(sid)
  }

  private dropLive() {
    for (const sid of [...this.liveSources.keys()]) this.dropSource(sid)
    this.live?.disconnect()
    this.live = null
  }

  unpin() {
    this.pinned = null
    this.dropLive()
    this.teardownTrack()
    this.sync()
    this.applyDuck()
  }

  toggle() {
    this.muted = !this.muted
    save('radio.muted', this.muted ? 1 : 0)
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05)
    if (!this.muted) this.wake()
    this.onChange?.()
  }

  stop() {
    if (this.next) clearTimeout(this.next)
    this.es?.close()
    this.es = null
    this.next = null
    this.dropLive()
    this.teardownTrack()
    this.onChange = null
  }
}
