import { Room, RoomEvent, Track } from 'livekit-client'
import type Connector from './connector'

export default class VoiceChat {
  room = new Room()
  talking = false
  private connector: Connector
  private pendingRoom: { name: string; uuid: string } | null = null
  private connected = false

  constructor(connector: Connector) {
    this.connector = connector
  }

  async prepare(roomName: string, uuid: string) {
    this.pendingRoom = { name: roomName, uuid }
    const audio = (window as any)._audio
    if (!audio) return
    await audio.ready()
    this._connect()
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
      this.room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind !== Track.Kind.Audio) return
        console.log('[vc] track subscribed from', participant.identity)
        this._attachTrack(participant.identity, track)
      })
      this.room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (track.kind !== Track.Kind.Audio) return
        this.connector.findAvatar(participant.identity)?.detachVoiceTrack()
      })
    } catch (e) {
      console.error('[vc] failed to connect', e)
    }
  }

  private _attachTrack(identity: string, track: any, attempts = 0) {
    const avatar = this.connector.findAvatar(identity)
    if (avatar) { avatar.attachVoiceTrack(track); return }
    if (attempts < 20) setTimeout(() => this._attachTrack(identity, track, attempts + 1), 500)
  }

  async startTalking() {
    if (this.talking) return
    try {
      await this.room.localParticipant.setMicrophoneEnabled(true)
      this.talking = true
      console.log('[vc] mic on')
    } catch (e) {
      console.error('[vc] mic enable failed', e)
    }
  }

  async stopTalking() {
    if (!this.talking) return
    await this.room.localParticipant.setMicrophoneEnabled(false)
    this.talking = false
    console.log('[vc] mic off')
  }

  get participants() {
    return [...this.room.participants.values()]
  }

  mute(identity: string, muted: boolean) {
    this.connector.findAvatar(identity)?.setVoiceMuted(muted)
  }

  disconnect() {
    this.room.disconnect()
  }
}
