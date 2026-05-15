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

  constructor(connector: Connector) {
    this.connector = connector
  }

  async connect(roomName: string, uuid: string) {
    try {
      const { token } = await fetch(`/api/rooms/${roomName}/token?identity=${uuid}`).then((r) => r.json())
      console.log('[vc] connecting to room', roomName, 'as', uuid)
      await this.room.connect('wss://voxels-7pvk06qt.livekit.cloud', token)
      console.log('[vc] connected. participants:', this.room.participants.size)

      this.room.on(RoomEvent.ParticipantConnected, (p) => {
        console.log('[vc] participant joined:', p.identity)
      })
      this.room.on(RoomEvent.ParticipantDisconnected, (p) => {
        console.log('[vc] participant left:', p.identity)
      })
      this.room.on(RoomEvent.TrackPublished, (_pub, participant) => {
        console.log('[vc] track published by', participant.identity)
      })
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
        const avatar = this.connector.findAvatar(participant.identity)
        avatar?.detachVoiceTrack()
      })

      // always publish a 500hz tone so the track is live - swap to mic on PTT
      this._startOsc()
    } catch (e) {
      console.error('VoiceChat: failed to connect to room', roomName, e)
    }
  }

  private async _startOsc() {
    this.oscCtx = new AudioContext()
    this.oscNode = this.oscCtx.createOscillator()
    this.oscDest = this.oscCtx.createMediaStreamDestination()
    this.oscNode.frequency.value = 500
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
    // swap back to oscillator
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
