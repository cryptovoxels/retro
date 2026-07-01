import { LocalAudioTrack, Room, RoomEvent, Track } from 'livekit-client'
import type Persona from './persona'
import type Avatar from './avatar'
import { SpatialAudio } from './audio/spatial-audio'
import { AudioBus } from './audio/audio-engine'
import { wantsAudio } from '../common/helpers/detector'
import { showboxAudioConstraints } from '../common/helpers/showbox-audio-constraints'
import { voiceSettings } from './voice-settings'

const LIVEKIT_URL = 'https://voxels-7pvk06qt.livekit.cloud'
const JOIN_RADIUS = 200

type Cluster = { room: string; center: [number, number, number]; count: number }
type Voice = { el: HTMLAudioElement; spatial: SpatialAudio | null }

// Positional voice chat in sticky "cluster" rooms. Separate from showbox: voice goes out the avatar,
// audio only. You join the nearest cluster within 200m or found your own at the parcel you stand in.
export default class VoiceChat {
  room: Room | null = null
  roomName = ''
  clusters: Cluster[] = []
  es: EventSource | null = null
  broadcasting = false
  muted = false
  mutedUuids = new Set<string>()
  voices = new Map<string, Voice>()
  follow: BABYLON.Observer<BABYLON.Scene> | null = null
  private lastIndicatorTick = 0
  private customMic: LocalAudioTrack | null = null
  private rawStream: MediaStream | null = null
  private pitchProc: ScriptProcessorNode | null = null
  private monitorGain: GainNode | null = null
  private monitorNode: MediaStreamAudioSourceNode | null = null
  private onSettingsChange = () => {
    if (!voiceSettings.enabled) {
      void this.disable()
      return
    }
    if (this.room) void this.republishMic(!this.muted && !this.broadcasting)
  }

  constructor(private persona: Persona) {
    voiceSettings.addEventListener('changed', this.onSettingsChange)
  }

  get audio() {
    return window._audio
  }

  get on() {
    return !!this.room
  }

  // open the discovery stream once; it stays on so the next enable() has a fresh cluster list
  private openSse() {
    if (this.es) return
    this.es = new EventSource('/api/clusters')
    this.es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (Array.isArray(d?.clusters)) this.clusters = d.clusters
      } catch {}
    }
  }

  async enable() {
    if (!voiceSettings.enabled || !wantsAudio() || this.room) return
    this.openSse()
    // give the SSE a beat to deliver its immediate snapshot before we pick a cluster
    if (!this.clusters.length) await new Promise((r) => setTimeout(r, 600))

    const pick = this.pickRoom()
    this.roomName = pick.room

    let url = `/api/rooms/${pick.room}/token?identity=${encodeURIComponent(this.persona.uuid)}`
    if (pick.center) url += `&center=${encodeURIComponent(pick.center)}`
    const res = await fetch(url, { credentials: 'include' })
      .then((r) => r.json())
      .catch(() => null)
    if (!res?.token) {
      this.roomName = ''
      return
    }

    const room = new Room()
    this.wire(room)
    await room.connect(LIVEKIT_URL, res.token)
    await room.startAudio()
    this.room = room
    this.muted = false
    await this.republishMic(true)
    this.startFollow()
  }

  async disable() {
    this.stopFollow()
    await this.unpublishMic()
    try {
      await this.room?.disconnect()
    } catch {}
    this.room = null
    this.muted = false
  }

  private micDeviceId() {
    const id = voiceSettings.deviceId
    return id && id !== 'default' ? id : undefined
  }

  private micConstraints(): MediaTrackConstraints {
    return showboxAudioConstraints('voice', this.micDeviceId()) as MediaTrackConstraints
  }

  private pitchShiftStream(ctx: AudioContext, stream: MediaStream, semitones: number): MediaStream {
    const rate = Math.pow(2, semitones / 12)
    const source = ctx.createMediaStreamSource(stream)
    const dest = ctx.createMediaStreamDestination()
    const ring = new Float32Array(4096 * 8)
    let w = 0
    let r = 0
    let avail = 0
    const proc = ctx.createScriptProcessor(2048, 1, 1)
    proc.onaudioprocess = (ev) => {
      const inp = ev.inputBuffer.getChannelData(0)
      const out = ev.outputBuffer.getChannelData(0)
      for (let i = 0; i < inp.length; i++) {
        ring[w % ring.length] = inp[i]
        w++
        avail = Math.min(avail + 1, ring.length)
      }
      for (let i = 0; i < out.length; i++) {
        if (avail < 64) {
          out[i] = 0
          continue
        }
        const ri = Math.floor(r) % ring.length
        const ri1 = (ri + 1) % ring.length
        const f = r - Math.floor(r)
        out[i] = ring[ri] * (1 - f) + ring[ri1] * f
        r += rate
        const consumed = Math.floor(r)
        if (consumed > 0) {
          r -= consumed
          avail -= consumed
        }
      }
    }
    source.connect(proc)
    proc.connect(dest)
    this.pitchProc = proc
    return dest.stream
  }

  private stopRawStream() {
    this.pitchProc?.disconnect()
    this.pitchProc = null
    this.rawStream?.getTracks().forEach((t) => t.stop())
    this.rawStream = null
  }

  private stopMonitor() {
    this.monitorNode?.disconnect()
    this.monitorNode = null
    if (this.monitorGain) this.monitorGain.gain.value = 0
  }

  private tapMonitor(ctx: AudioContext, stream: MediaStream) {
    this.stopMonitor()
    if (!voiceSettings.monitor) return
    if (!this.monitorGain) {
      this.monitorGain = ctx.createGain()
      this.monitorGain.gain.value = 0
      this.monitorGain.connect(ctx.destination)
    }
    this.monitorGain.gain.value = 1
    this.monitorNode = ctx.createMediaStreamSource(stream)
    this.monitorNode.connect(this.monitorGain)
  }

  private async unpublishMic() {
    try {
      if (this.customMic) {
        await this.room?.localParticipant.unpublishTrack(this.customMic)
        this.customMic.stop()
        this.customMic = null
      }
    } catch {}
    this.stopRawStream()
    this.stopMonitor()
    try {
      await this.room?.localParticipant.setMicrophoneEnabled(false)
    } catch {}
  }

  private async republishMic(on: boolean) {
    if (!this.room) return
    await this.unpublishMic()
    if (!on) return

    const pitch = voiceSettings.pitch
    const custom = Math.abs(pitch) >= 0.01 || voiceSettings.monitor
    if (!custom) {
      await this.room.localParticipant.setMicrophoneEnabled(true, this.micConstraints())
      return
    }

    const ctx = BABYLON.Engine.audioEngine?.audioContext
    if (!ctx) {
      await this.room.localParticipant.setMicrophoneEnabled(true, this.micConstraints())
      return
    }

    try {
      this.rawStream = await navigator.mediaDevices.getUserMedia({ audio: this.micConstraints() })
      let out = this.rawStream
      if (Math.abs(pitch) >= 0.01) out = this.pitchShiftStream(ctx, this.rawStream, pitch)
      this.tapMonitor(ctx, out)
      const track = out.getAudioTracks()[0]
      if (!track) return
      this.customMic = new LocalAudioTrack(track, this.micConstraints(), true)
      await this.room.localParticipant.publishTrack(this.customMic)
    } catch {
      await this.room.localParticipant.setMicrophoneEnabled(true, this.micConstraints())
    }
  }

  // sticky: once joined we never re-pick. else nearest cluster <=200m, else a new one where we stand.
  private pickRoom(): { room: string; center?: string } {
    if (this.roomName) return { room: this.roomName }
    const me = this.persona.position
    let best: Cluster | null = null
    let bestDist = Infinity
    for (const c of this.clusters) {
      if (!c.center) continue
      const dx = c.center[0] - me.x
      const dy = c.center[1] - me.y
      const dz = c.center[2] - me.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    }
    if (best && bestDist <= JOIN_RADIUS) return { room: best.room }
    const parcel = this.persona.connector.currentOrNearestParcel()
    const id = parcel?.id ?? 0
    const c = parcel ? parcel.boundingBox.center : me
    return { room: `cluster-${id}`, center: `${c.x},${c.y},${c.z}` }
  }

  private wire(room: Room) {
    room.on(RoomEvent.TrackSubscribed, (track: any, _pub: any, p: any) => {
      if (track.kind !== Track.Kind.Audio) return
      this.addVoice(p.identity, track)
    })
    room.on(RoomEvent.TrackUnsubscribed, (_track: any, _pub: any, p: any) => this.removeVoice(p.identity))
    room.on(RoomEvent.ParticipantDisconnected, (p: any) => {
      this.removeVoice(p.identity)
      ;(window.connector?.findAvatar(p.identity) as Avatar | undefined)?.setVoiceState('off') // clear chip even if they had no track
    })
  }

  // identity === avatar uuid, so the track spatializes onto that avatar (follow loop keeps it glued)
  private addVoice(uuid: string, track: any) {
    this.removeVoice(uuid)
    const el = track.attach() as HTMLAudioElement
    el.style.display = 'none'
    document.body.appendChild(el)

    let spatial: SpatialAudio | null = null
    try {
      const node = BABYLON.Engine.audioEngine?.audioContext?.createMediaElementSource(el)
      if (node && this.audio) {
        const a = window.connector?.findAvatar(uuid) as Avatar | undefined
        spatial = this.audio.createSpatialAudio({
          name: 'voice/' + uuid,
          outputBus: AudioBus.Parcel,
          audioNode: node,
          absolutePosition: (a?.absolutePosition ?? BABYLON.Vector3.Zero()).clone(),
          rolloffFactor: 2,
        })
        spatial.volume = this.mutedUuids.has(uuid) ? 0 : 1
        el.volume = 1
      }
    } catch {}
    // fall back to flat element audio if webaudio wiring failed
    if (!spatial) el.volume = this.mutedUuids.has(uuid) ? 0 : 1
    this.voices.set(uuid, { el, spatial })
  }

  private removeVoice(uuid: string) {
    const v = this.voices.get(uuid)
    if (!v) return
    try {
      v.spatial?.dispose()
    } catch {}
    try {
      v.el.pause()
      v.el.srcObject = null
    } catch {}
    v.el.remove()
    this.voices.delete(uuid)
    ;(window.connector?.findAvatar(uuid) as Avatar | undefined)?.setVoiceState('off')
  }

  private startFollow() {
    if (this.follow) return
    const scene = this.audio?.scene
    if (!scene) return
    this.follow = scene.onBeforeRenderObservable.add(() => {
      for (const [uuid, v] of this.voices) {
        if (!v.spatial) continue
        const a = window.connector?.findAvatar(uuid) as Avatar | undefined
        if (a) v.spatial.setPosition(a.absolutePosition)
      }
      this.updateVoiceIndicators()
    })
  }

  // ~10Hz: paint each cluster member's mic chip - on / speaking (with level) / muted. cheap; the chip is one billboard.
  private updateVoiceIndicators() {
    const room = this.room
    if (!room) return
    const t = performance.now()
    if (t - this.lastIndicatorTick < 100) return
    this.lastIndicatorTick = t

    const paint = (uuid: string, p: any, isLocal: boolean) => {
      const a = window.connector?.findAvatar(uuid) as Avatar | undefined
      if (!a) return
      const micOff = isLocal ? this.muted || this.broadcasting : this.mutedUuids.has(uuid) || !p.isMicrophoneEnabled
      const speaking = !micOff && p.isSpeaking
      // you always see your own chip (live / muted / speaking); others only show up when muted or speaking, not idle.
      if (!isLocal && !micOff && !speaking) return a.setVoiceState('off')
      const state = micOff ? 'muted' : speaking ? 'speaking' : 'on'
      a.setVoiceState(state, p.audioLevel ?? 0)
    }
    paint(this.persona.uuid, room.localParticipant, true)
    const remote = (room as any).remoteParticipants ?? (room as any).participants
    remote?.forEach((p: any) => paint(p.identity, p, false))
  }

  // your own mic. keeps the track published/acquired, just mutes.
  setMuted(b: boolean) {
    this.muted = b
    if (this.broadcasting) return // mic stays off while showboating
    void this.republishMic(!b)
  }

  // while live on a showbox your voice goes out the screen, not your avatar - suppress the avatar mic
  setBroadcasting(b: boolean) {
    if (this.broadcasting === b) return
    this.broadcasting = b
    if (!this.room) return
    void this.republishMic(b ? false : !this.muted)
  }

  private stopFollow() {
    if (!this.follow) return
    this.audio?.scene?.onBeforeRenderObservable.remove(this.follow)
    this.follow = null
  }

  // click an avatar to locally mute it (and render it as a red anon)
  toggleLocalMute(uuid: string) {
    if (uuid === this.persona.uuid) return
    const muted = !this.mutedUuids.has(uuid)
    if (muted) this.mutedUuids.add(uuid)
    else this.mutedUuids.delete(uuid)
    const v = this.voices.get(uuid)
    if (v) {
      if (v.spatial) v.spatial.volume = muted ? 0 : 1
      else v.el.volume = muted ? 0 : 1
    }
    const a = window.connector?.findAvatar(uuid) as Avatar | undefined
    a?.setMuted(muted)
  }
}
