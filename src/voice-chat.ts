import { LocalAudioTrack, Room, RoomEvent, Track } from 'livekit-client'
import type Connector from './connector'

export default class VoiceChat {
  room = new Room()
  talking = false
  private connector: Connector
  private pubTrack: LocalAudioTrack | null = null
  private oscCtx: AudioContext | null = null
  private oscNode: OscillatorNode | null = null
  private oscDest: MediaStreamAudioDestinationNode | null = null
  private pendingRoom: { name: string; uuid: string } | null = null
  private connected = false

  constructor(connector: Connector) {
    this.connector = connector
  }

  // called on world join - wait for babylon audio unlock (first user gesture) then connect
  prepare(roomName: string, uuid: string) {
    this.pendingRoom = { name: roomName, uuid }
    console.log('[vc] prepared room', roomName, '- waiting for audio unlock')

    const tryHook = () => {
      console.log('nohook')

      const audio = (window as any)._audio?.babylonAudioEngine as BABYLON.AudioEngine

      if (!audio?.onAudioUnlockedObservable) {
        setTimeout(tryHook, 500)
        return
      }

      if (audio.unlocked) {
        this._connect()
      } else {
        audio.onAudioUnlockedObservable.addOnce(() => {
          console.log('[vc] audio unlocked - connecting')
          this._connect()
        })
    }

      // already unlocked (user interacted before we joined)
      if (audio.audioContext?.state === 'running') {
        this._connect()
      }

    }

    tryHook()
  }

  private async _connect() {
    if (this.connected || !this.pendingRoom) return
    const { name, uuid } = this.pendingRoom
    try {
      const { token } = await fetch(`/api/rooms/${name}/token?identity=${uuid}`).then((r) => r.json())
      console.log('[vc] connecting to room', name, 'as', uuid)
      await this.room.connect('wss://voxels-7pvk06qt.livekit.cloud', token)
      this.connected = true
      console.log('[vc] connected. participants:', this.room.participants.size)

      this.room.on(RoomEvent.ParticipantConnected, (p) => console.log('[vc] participant joined:', p.identity))
      this.room.on(RoomEvent.ParticipantDisconnected, (p) => console.log('[vc] participant left:', p.identity))
      this.room.on(RoomEvent.TrackPublished, (_pub, p) => console.log('[vc] track published by', p.identity))
      this.room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        console.log('[vc] track subscribed from', participant.identity, 'kind:', track.kind, 'muted:', track.isMuted)
        if (track.kind !== Track.Kind.Audio) return
        const avatar = this.connector.findAvatar(participant.identity)
        console.log('[vc] avatar found for', participant.identity, ':', !!avatar)
        avatar?.attachVoiceTrack(track)
      })
      this.room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        console.log('[vc] track unsubscribed from', participant.identity)
        if (track.kind !== Track.Kind.Audio) return
        this.connector.findAvatar(participant.identity)?.detachVoiceTrack()
      })

      await this._startOsc()
    } catch (e) {
      console.error('[vc] failed to connect', e)
    }
  }

  private async _startOsc() {
    this.oscCtx = new AudioContext()
    this.oscNode = this.oscCtx.createOscillator()
    this.oscDest = this.oscCtx.createMediaStreamDestination()
        const cMinor = [130.81, 155.56, 174.61, 196.00, 220.00, 261.63, 311.13, 349.23, 392.00, 440.00, 523.25]
    this.oscNode.frequency.value = cMinor[Math.floor(Math.random() * cMinor.length)]
    
    this.oscNode.connect(this.oscDest)
    this.oscNode.start()
    const track = this.oscDest.stream.getAudioTracks()[0]
    console.log('[vc] publishing osc track', track.label, 'enabled:', track.enabled)
    this.pubTrack = new LocalAudioTrack(track)
    await this.room.localParticipant.publishTrack(this.pubTrack)
    console.log('[vc] osc track published. local tracks:', this.room.localParticipant.audioTracks.size)
  }

  async startTalking() {
    if (this.talking) return

    // if not connected yet (edge case: user pressed V before babylon unlocked)
    await this._connect()

    // unlock livekit's audio context
    await this.room.startAudio()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const micTrack = stream.getAudioTracks()[0]
      console.log('[vc] got mic track:', micTrack.label)
      if (this.pubTrack) {
        await this.pubTrack.replaceTrack(micTrack)
        console.log('[vc] replaced osc with mic')
      }
      this.talking = true
    } catch (e) {
      console.error('VoiceChat: mic permission denied', e)
    }
  }

  async stopTalking() {
    if (!this.talking) return
    if (this.pubTrack && this.oscDest) {
      const oscTrack = this.oscDest.stream.getAudioTracks()[0]
      await this.pubTrack.replaceTrack(oscTrack)
      console.log('[vc] swapped back to osc')
    }
    this.talking = false
  }

  get participants() {
    return [...this.room.participants.values()]
  }

  mute(identity: string, muted: boolean) {
    this.connector.findAvatar(identity)?.setVoiceMuted(muted)
  }

  disconnect() {
    this.oscNode?.stop()
    this.oscCtx?.close()
    this.pubTrack?.stop()
    this.room.disconnect()
  }
}
