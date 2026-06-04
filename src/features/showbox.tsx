import { Component, h } from 'preact'
import Cookies from 'js-cookie'
import { decodeJwt } from 'jose'
import { isMobile } from '../../common/helpers/detector'
import ParcelHelper, { showboxAudiencePlayCoordsFromRecord, showboxHostPlayCoordsFromRecord } from '../../common/helpers/parcel-helper'
import { exitPointerLock } from '../../common/helpers/ui-helpers'
import { encodeCoords } from '../../common/helpers/utils'
import { ShowboxRecord } from '../../common/messages/feature'
import { effect } from '@preact/signals'
import { Room, RoomEvent, Track, createLocalScreenTracks, createLocalTracks, createLocalVideoTrack } from 'livekit-client'
import { avatarName } from '../../common/messages/avatar-ref'
import { app, AppEvent } from '../../web/src/state'
import { PanelType } from '../../web/src/components/panel'
import { messageList, type ChatMessageRecord } from '../connector'
import { Position, Rotation, Scale, Script } from '../../web/src/components/editor'
import { Animations } from '../avatar-animations'
import { EmoteAnimation, Idle } from '../states'
import { cameraPosition, cameraRotation } from '../utils/camera'
import { emote as emoteParticles } from '../utils/emote'
import { AudioBus } from '../audio/audio-engine'
import { SpatialAudio } from '../audio/spatial-audio'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, SetParentDropdown, Toolbar, UuidReadOnly } from '../ui/features'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D } from './feature'

// Quick-access subset for the broadcast dock. Full list lives in src/ui/interact/emote.tsx.
const DOCK_DANCES: Array<{ label: string; anim: Animations }> = [
  { label: 'dance', anim: Animations.Dance },
  { label: 'hype', anim: Animations.Hype },
  { label: 'clap', anim: Animations.Applause },
  { label: 'spin', anim: Animations.Spin },
  { label: 'savage', anim: Animations.Savage },
]
const DOCK_EMOJIS = ['🔥', '🙌', '❤️', '😂', '👏', '🎉']

const DEFAULT_VOLUME = 0.7
const MAX_VOLUME = 1
const VOLUME_REFRESH_INTERVAL = 200
const VIEWER_RETRY_INTERVAL = 20_000
const STREAM_ATTACH_RETRY_MS = 2000
const STREAM_ATTACH_RECONNECT_AFTER = 5
const VIEWER_MILESTONES = [10, 25, 50] as const
const MILESTONE_POLL_MS = 8000
// How long a joining co-host shows the "connecting" card while waiting for the host's video.
const COHOST_CONNECT_GRACE_MS = 8000

function celebrateLabel(n: number) {
  if (n >= 50) return '50 here'
  if (n >= 25) return '25 here'
  return `${n} here`
}

function uuidBucket(uuid: string, mod: number) {
  let h = 0
  for (let i = 0; i < uuid.length; i++) h = (h + uuid.charCodeAt(i)) | 0
  return Math.abs(h) % mod
}

function celebrateBursts(n: number) {
  if (n >= 50) return { emojis: ['🎉', '🔥', '🙌', '❤️', '👏', '🎉', '🔥'], staggerMs: 280 }
  if (n >= 25) return { emojis: ['🎉', '🔥', '🙌', '❤️', '🎉'], staggerMs: 380 }
  if (n >= 10) return { emojis: ['🎉', '🔥', '🙌'], staggerMs: 300 }
  return { emojis: ['🎉'], staggerMs: 0 }
}

function celebrateMoves(n: number, uuid: string) {
  const b = uuidBucket(uuid, 12)
  const wild = [Animations.Hype, Animations.Spin, Animations.Savage, Animations.Celebration]
  if (n >= 50) {
    return { anims: [wild[b % 4], wild[(b + 5) % 4], Animations.Spin], gapMs: 1100 }
  }
  if (n >= 25) {
    const pool = [Animations.Dance, Animations.Hype, Animations.Spin, Animations.Savage]
    return { anims: [pool[b % 4], pool[(b + 3) % 4]], gapMs: 900 }
  }
  if (n >= 10) return { anims: [Animations.Dance], gapMs: 0 }
  return { anims: [] as Animations[], gapMs: 0 }
}

const LIVEKIT_URL = 'https://voxels-7pvk06qt.livekit.cloud'
const mobile = isMobile()

function isRoomFullError(e: unknown) {
  const msg = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase()
  return msg.includes('room is full') || (msg.includes('participant') && (msg.includes('limit') || msg.includes('max') || msg.includes('full')))
}

// getUserMedia failure -> plain-language nudge. Showbox is a video feature, so audio-only is not an option here.
function cameraErrorMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'camera blocked - allow camera access in your browser, then go live again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no camera found - plug one in or tick "use screenshare instead". for audio only, drop a Boombox.'
  if (name === 'NotReadableError' || name === 'AbortError') return 'your camera is busy in another app - close it and try again.'
  return 'could not start your camera - check browser permissions, then go live again.'
}

// True when the page was opened via /live/:token and the guest pass targets this showbox.
// The synthetic wallet `guest:*` and `?show=<uuid>` are both set by the server on redeem.
function guestJwtPayload(): { wallet?: string; guest_pass?: string; feature_uuid?: string } | null {
  try {
    const key = app.state.key || Cookies.get('jwt')
    if (!key) return null
    return decodeJwt(key) as { wallet?: string; guest_pass?: string; feature_uuid?: string }
  } catch {
    return null
  }
}

function isGuestForShowbox(uuid: string): boolean {
  const payload = guestJwtPayload()
  const w = (payload?.wallet ?? app.state.wallet)?.toLowerCase()
  if (!w?.startsWith('guest:')) return false
  if (payload?.feature_uuid === uuid) return true
  try {
    return new URL(window.location.href).searchParams.get('show') === uuid
  } catch {
    return false
  }
}

function guestPassToken(): string | null {
  return guestJwtPayload()?.guest_pass ?? null
}

function showboxFeatureCoords(feature: Showbox) {
  const parcel = new ParcelHelper(feature.parcel as any)
  const f = { position: feature.tidyPosition, rotation: feature.tidyRotation, guestMode: feature.guestMode }
  return { parcel, f }
}

// Plain /play?coords= link for the audience. No isolate, ui=off, or show= - just drop people at the showbox.
function audienceShowUrl(feature: Showbox): string {
  const { parcel, f } = showboxFeatureCoords(feature)
  return `${window.location.origin}/play?coords=${encodeURIComponent(showboxAudiencePlayCoordsFromRecord(parcel, f))}`
}

// Owner/co-host join link. Keeps your normal login - just lands at the showbox and opens the broadcast dock.
function hostJoinShowUrl(feature: Showbox): string {
  const { parcel, f } = showboxFeatureCoords(feature)
  const qs = new URLSearchParams({ coords: showboxHostPlayCoordsFromRecord(parcel, f), show: feature.uuid, host: '1' })
  return `${window.location.origin}/play?${qs.toString()}`
}

function isHostJoinForShowbox(uuid: string): boolean {
  if (isGuestForShowbox(uuid)) return false
  try {
    const q = new URL(window.location.href).searchParams
    return q.get('host') === '1' && q.get('show') === uuid
  } catch {
    return false
  }
}

function wantsHostJoin(uuid: string): boolean {
  return isHostJoinForShowbox(uuid)
}

// Drop show=/host= from the URL so ending a stream does not re-open the dock on parcel re-enter.
function clearShowboxJoinParams() {
  try {
    const u = new URL(window.location.href)
    if (!u.searchParams.has('show') && !u.searchParams.has('host')) return
    u.searchParams.delete('show')
    u.searchParams.delete('host')
    const qs = u.searchParams.toString()
    window.history.replaceState(window.history.state, '', u.pathname + (qs ? `?${qs}` : '') + u.hash)
  } catch {}
}

// Chat display name comes from the multiplayer login snapshot - reconnect after a rename so everyone sees it.
function syncGuestDisplayName(name: string) {
  app.setName(name)
  if (app.avatarRef && typeof app.avatarRef === 'object') {
    app.avatarRef = { ...app.avatarRef, name }
  }
  const av = window.persona?.avatar as { _description?: { name?: string } } | undefined
  if (av?._description) av._description.name = name
  window.connector?.reconnect()
}

type GuestMode = 'solo' | 'cohost'
type MirrorSource = 'auto' | 'host' | 'collaborator' | 'guest'
type MirrorRole = 'host' | 'collaborator' | 'guest'

const DEFAULT_GUEST_MODE: GuestMode = 'solo'

function cohostIdentityPrefix(identity: string) {
  const i = identity.lastIndexOf('-')
  return i > 0 ? identity.slice(0, i) : identity
}

function cohostVideoReady(el: HTMLVideoElement | null) {
  return !!(el && el.readyState >= 1 && el.videoWidth > 0)
}

type ShowboxCelebrateState = { celebrate?: number; at?: number }

export default class Showbox extends Feature2D<ShowboxRecord> {
  static metadata: FeatureMetadata = {
    title: 'Showbox',
    subtitle: 'go live in the metaverse',
    type: 'showbox',
    image: '',
  }
  static template = {
    type: 'showbox',
    scale: [2, 1, 0],
    guestMode: 'solo',
  } as FeatureTemplate

  livekitRoom: Room | null = null
  broadcastRoom: Room | null = null
  broadcastPanel: HTMLDivElement | null = null
  broadcastChatDispose: (() => void) | null = null
  thumbCanvas: HTMLCanvasElement | null = null
  thumbInterval: ReturnType<typeof setInterval> | null = null
  liveTimerInterval: ReturnType<typeof setInterval> | null = null
  liveStartedAt: number | null = null
  audioMeterRaf: number | null = null
  audioMeterCtx: AudioContext | null = null
  streamAudioEls: HTMLAudioElement[] = []
  streamSpatialByEl = new Map<HTMLAudioElement, SpatialAudio>()
  streamVolumeInterval: ReturnType<typeof setInterval> | null = null
  hasActiveVideo = false
  ownerVideoEl: HTMLVideoElement | null = null
  guestVideoEl: HTMLVideoElement | null = null
  cohostLiveSince = 0
  cohostCanvas: HTMLCanvasElement | null = null
  cohostCompositeEl: HTMLVideoElement | null = null
  cohostCompositeRaf: number | null = null
  cohostMonitorEls: HTMLAudioElement[] = []
  cohostCompositeAttached = false
  syncCohostPreview: (() => void) | null = null
  cohostCompositeRetryRaf: number | null = null
  milestonePollInterval: ReturnType<typeof setInterval> | null = null
  celebratedMilestones = new Set<number>()
  lastCelebrateAt = 0
  lastCelebrateN = 0
  viewerRoomFull = false
  viewerConnecting = false
  liveChatAnnounced = false
  walkAwayWarned = false
  viewerConnectGen = 0
  localBroadcastVideoEl: HTMLVideoElement | null = null
  mirrorVideoIdentity: string | null = null
  angleVideoTrack: any = null
  anglePanel: HTMLDivElement | null = null
  viewerRetryInterval: ReturnType<typeof setInterval> | null = null
  streamAttachRetryInterval: ReturnType<typeof setInterval> | null = null
  streamAttachAttempts = 0
  hostJoinLoginPending = false
  joinDockAutoOpened = false

  roomName() {
    return `parcel-${this.parcel.id}`
  }

  activeLiveShowboxUuid() {
    const live = (this.parcel.state as any).__showbox_live
    return typeof live === 'string' ? live : null
  }

  streamTargetsThisShowbox() {
    const live = this.activeLiveShowboxUuid()
    return !!live && live === this.uuid
  }

  isMirror() {
    const boxes = this.parcel.getFeaturesByType('showbox')
    return boxes.length > 1 && boxes[0]?.uuid !== this.uuid
  }

  // a mirror shows the primary showbox video (muted) whenever a stream is live on the parcel.
  // __showbox_live is ephemeral (broadcast-only, not persisted) and our own broadcast isn't a
  // remote participant on this client, so fall back to the actual room video as the source of truth.
  mirrorsActiveStream() {
    return this.isMirror() && (!!this.activeLiveShowboxUuid() || this.mirrorHasVideoSource())
  }

  mirrorHasVideoSource() {
    for (const p of (this.livekitRoom as any)?.participants?.values() ?? []) {
      if (p.videoTracks?.size > 0) return true
    }
    const primary = this.parcel.getFeaturesByType('showbox')[0] as any
    return (primary?.broadcastRoom?.localParticipant?.videoTracks?.size ?? 0) > 0
  }

  // a mirror set to "second camera" shows a dedicated video-only track named with its own uuid,
  // not the primary's stream. any broadcaster can publish one.
  isAngleMirror() {
    return this.isMirror() && !!this.description.angleMode
  }

  // uuids of every angle-mode showbox on the parcel - their feeds are routed by track name, not by role
  angleTrackNames(): string[] {
    return this.parcel
      .getFeaturesByType('showbox')
      .filter((b: any) => b?.description?.angleMode)
      .map((b) => b.uuid)
  }

  isAngleTrackName(name: string | undefined) {
    return !!name && this.angleTrackNames().includes(name)
  }

  displaysStream() {
    return this.streamTargetsThisShowbox() || this.mirrorsActiveStream()
  }

  reconcileActiveStream() {
    if (this.broadcastRoom || this.angleVideoTrack) return
    if (this.displaysStream()) {
      this.tryAttachExistingStream()
      if (!this.hasActiveVideo) this.scheduleStreamAttachRetry()
      return
    }
    this.stopStreamAttachRetry()
    if (!this.hasActiveVideo) {
      this.setPreview()
      return
    }
    this.hasActiveVideo = false
    this.mirrorVideoIdentity = null
    if (this.isCohostMode()) this.stopCohostComposite()
    this.setPreview()
  }

  // angle mirrors show only the track named with their uuid (a dedicated second camera), muted. no echo fallback.
  refreshAngleVideo() {
    const attach = (track: any) => {
      if (!track) return false
      if (this.mirrorVideoIdentity !== this.uuid) {
        this.attachVideoToMesh(track.attach() as HTMLVideoElement, true)
        this.mirrorVideoIdentity = this.uuid
        this.stopStreamAttachRetry()
      }
      return true
    }
    // our own walk-up broadcast to this mirror - not a remote participant on this client
    if (this.angleVideoTrack && attach(this.angleVideoTrack)) return
    for (const p of (this.livekitRoom as any)?.participants?.values() ?? []) {
      for (const pub of p.videoTracks.values()) {
        if (pub.track && pub.isSubscribed && pub.trackName === this.uuid && attach(pub.track)) return
      }
    }
    if (this.hasActiveVideo) {
      this.hasActiveVideo = false
      this.mirrorVideoIdentity = null
      this.setPreview()
    }
  }

  // owners/collaborators + valid guest links can drive a second camera into an angle mirror
  canBroadcastAngle() {
    return this.isAngleMirror() && (this.parcel.canEdit || isGuestForShowbox(this.uuid))
  }

  // walk up to an angle mirror and push your camera straight to it (video only, no audio, no __showbox_live).
  // published on the viewer room - its token already grants canPublish for authorized users.
  async startAngleBroadcast(deviceId?: string): Promise<boolean> {
    if (this.angleVideoTrack) return true
    if (!this.livekitRoom) await this.connectViewer()
    const lp = (this.livekitRoom as any)?.localParticipant
    if (!lp) return false
    let track: any
    try {
      // exact: a plain string deviceId is only a preference, so the browser hands back the already-running primary camera. Force the pick.
      track = await createLocalVideoTrack(deviceId ? { deviceId: { exact: deviceId } } : undefined)
    } catch (e) {
      console.error('showbox: angle camera failed to capture', e)
      return false
    }
    this.angleVideoTrack = track
    try {
      await lp.publishTrack(track, { name: this.uuid })
    } catch (e) {
      console.error('showbox: angle camera failed to publish', e)
      try {
        track.stop()
      } catch {}
      this.angleVideoTrack = null
      return false
    }
    this.attachVideoToMesh(track.attach() as HTMLVideoElement, true)
    this.mirrorVideoIdentity = this.uuid
    this.stopStreamAttachRetry()
    return true
  }

  closeAnglePanel() {
    this.anglePanel?.remove()
    this.anglePanel = null
  }

  // a small dialog on the angle mirror itself: pick a camera, broadcast it to just this screen.
  openAnglePanel() {
    if (this.anglePanel) {
      this.closeAnglePanel()
      return
    }
    exitPointerLock()
    const panel = document.createElement('div')
    this.anglePanel = panel
    Object.assign(panel.style, {
      position: 'fixed',
      zIndex: '999999',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: mobile ? 'calc(100vw - 2rem)' : '320px',
      background: '#0d0d0d',
      color: '#f5f5f0',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      fontFamily: '"Source Code Pro", monospace',
      fontSize: mobile ? '15px' : '13px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
    })

    const title = document.createElement('div')
    title.textContent = 'second camera'
    title.style.fontWeight = 'bold'
    title.style.fontSize = mobile ? '16px' : '14px'

    const hint = document.createElement('small')
    hint.textContent = 'pick a camera to broadcast to this screen. video only, no audio.'
    hint.style.color = '#888'

    const sel = document.createElement('select')
    Object.assign(sel.style, { width: '100%', background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: mobile ? '8px' : '4px' })
    if (mobile) Object.assign(sel.style, { fontSize: '16px', minHeight: '44px' })

    const status = document.createElement('div')
    Object.assign(status.style, { color: '#888', fontSize: '12px', minHeight: '14px' })

    const go = document.createElement('button')
    go.type = 'button'
    go.textContent = this.angleVideoTrack ? 'stop broadcasting' : 'broadcast to this screen'
    Object.assign(go.style, { background: '#dc1e1e', color: '#fff', border: '0', padding: mobile ? '12px' : '8px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold' })
    go.onclick = async () => {
      if (this.angleVideoTrack) {
        this.stopAngleBroadcast()
        this.closeAnglePanel()
        return
      }
      go.disabled = true
      status.textContent = 'starting camera...'
      const ok = await this.startAngleBroadcast(sel.value || undefined)
      if (ok) {
        this.closeAnglePanel()
      } else {
        go.disabled = false
        status.textContent = 'could not start that camera - try another'
      }
    }

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'cancel'
    Object.assign(cancel.style, { background: 'transparent', color: '#888', border: '0', padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' })
    cancel.onclick = () => this.closeAnglePanel()

    if (this.angleVideoTrack) {
      panel.append(title, go, cancel)
    } else {
      panel.append(title, hint, sel, go, status, cancel)
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        devices
          .filter((d) => d.kind === 'videoinput')
          .forEach((d, i) => {
            const o = document.createElement('option')
            o.value = d.deviceId
            o.textContent = d.label || `camera ${i + 1}`
            sel.appendChild(o)
          })
      })
    }
    document.body.appendChild(panel)
  }

  stopAngleBroadcast(silent = false) {
    if (!this.angleVideoTrack) return
    try {
      ;(this.livekitRoom as any)?.localParticipant?.unpublishTrack(this.angleVideoTrack, true)
    } catch {}
    try {
      this.angleVideoTrack.stop()
    } catch {}
    this.angleVideoTrack = null
    if (silent) return
    this.hasActiveVideo = false
    this.mirrorVideoIdentity = null
    this.refreshAngleVideo()
    // refreshAngleVideo only repaints when it had an active feed; clearing it first leaves the last frame
    // frozen, so restore the idle "broadcast to this mirror" CTA when nothing else is driving the screen.
    if (!this.hasActiveVideo) this.setPreview()
  }

  // mirrors show the chosen source muted (default: whoever is live, host preferred), so every mirror is consistent
  refreshMirrorVideo() {
    if (!this.isMirror() || this.broadcastRoom || !this.livekitRoom) return
    if (this.isAngleMirror()) return this.refreshAngleVideo()
    const byRole: Partial<Record<MirrorRole, { track: any; id: string }>> = {}
    let first: { track: any; id: string } | null = null
    const consider = (track: any, identity: string, trackName?: string) => {
      if (!track) return
      if (this.isAngleTrackName(trackName)) return // angle feeds belong to their own mirror, not the echo
      const role = this.publisherRole(identity)
      if (!byRole[role]) byRole[role] = { track, id: identity }
      if (!first) first = { track, id: identity }
    }
    for (const p of (this.livekitRoom as any).participants?.values() ?? []) {
      for (const pub of p.videoTracks.values()) {
        if (pub.isSubscribed) consider(pub.track, p.identity, pub.trackName)
      }
    }
    // our own broadcast isn't a remote participant on this client - read it off the primary showbox
    const local = (this.parcel.getFeaturesByType('showbox')[0] as any)?.broadcastRoom?.localParticipant
    for (const pub of local?.videoTracks?.values() ?? []) {
      consider(pub.track, local.identity, pub.trackName)
    }
    const want = this.mirrorSource
    // chosen role if it's live, else fall back to whoever is live (host preferred)
    const pick = (want !== 'auto' ? byRole[want] : null) ?? byRole.host ?? byRole.collaborator ?? byRole.guest ?? first
    if (!pick) {
      if (this.hasActiveVideo) {
        this.hasActiveVideo = false
        this.mirrorVideoIdentity = null
        this.setPreview()
      }
      return
    }
    if (this.hasActiveVideo && this.mirrorVideoIdentity === pick.id) return
    this.attachVideoToMesh(pick.track.attach() as HTMLVideoElement, true)
    this.mirrorVideoIdentity = pick.id
    this.stopStreamAttachRetry()
  }

  tryAttachExistingStream() {
    if (this.broadcastRoom || !this.livekitRoom) return
    if (this.isMirror()) {
      this.refreshMirrorVideo()
      return
    }
    if (this.isCohostMode()) {
      if (this.hasActiveVideo) return
      this.syncExistingCohostVideos()
      this.updateCohostComposite()
      return
    }
    if (this.hasActiveVideo) return
    for (const participant of (this.livekitRoom as any).participants?.values() ?? []) {
      for (const pub of participant.videoTracks.values()) {
        const track = pub.track
        if (!track || !pub.isSubscribed) continue
        if (this.isAngleTrackName(pub.trackName)) continue // a dedicated angle feed belongs to its mirror, not here
        this.attachVideoToMesh(track.attach() as HTMLVideoElement)
        this.startBroadcastAudio()
        this.stopStreamAttachRetry()
        return
      }
    }
  }

  isShowLive() {
    return !!this.broadcastRoom || this.hasActiveVideo || this.hasRemoteBroadcaster()
  }

  receiveState(state: ShowboxCelebrateState) {
    const n = state?.celebrate
    const at = state?.at ?? 0
    if (!n || n < 10 || !at || !this.isInCurrentParcel || !this.isShowLive()) return
    if (at <= this.lastCelebrateAt || n <= this.lastCelebrateN) return
    this.lastCelebrateAt = at
    this.lastCelebrateN = n
    this.runCelebrate(n)
  }

  playCelebrateMoves(anims: Animations[], gapMs: number) {
    const persona = window.persona
    const controls = window.connector?.controls
    if (!persona || !controls || !anims.length) return
    anims.forEach((anim, i) => {
      setTimeout(() => {
        if (this.disposed) return
        persona.popState(controls)
        persona.setState({ state: new EmoteAnimation(anim) }, controls)
      }, i * gapMs)
    })
  }

  runCelebrate(n: number) {
    const pos = this.absolutePosition
    const { emojis, staggerMs } = celebrateBursts(n)
    emojis.forEach((emoji, i) => {
      setTimeout(() => {
        if (this.disposed) return
        try {
          emoteParticles(emoji, pos, this.scene)
        } catch {}
      }, i * staggerMs)
    })

    const uuid = window.persona?.uuid ?? ''
    const { anims, gapMs } = celebrateMoves(n, uuid)
    this.playCelebrateMoves(anims, gapMs)

    app.showSnackbar(celebrateLabel(n), PanelType.Success)
  }

  async fetchViewerCount() {
    try {
      const r = await fetch(`/api/rooms/${this.roomName()}`)
      if (!r.ok) return 0
      const j = await r.json().catch(() => null)
      return j?.room?.numParticipants ?? 0
    } catch {
      return 0
    }
  }

  stopMilestonePoll() {
    if (this.milestonePollInterval) {
      clearInterval(this.milestonePollInterval)
      this.milestonePollInterval = null
    }
    this.celebratedMilestones.clear()
  }

  fireMilestone(n: number) {
    const at = Date.now()
    this.lastCelebrateAt = at
    this.lastCelebrateN = n
    try {
      this.parcel.sendStatePatch({ [this.uuid]: { celebrate: n, at } })
    } catch {}
    this.runCelebrate(n)
  }

  // Warn the broadcaster before they wander far enough for their parcel to unload, which disposes
  // the showbox and kills their stream. Fires once when they cross the threshold, re-arms on return.
  // Snackbar works the same on desktop and mobile.
  warnIfWalkingAway() {
    if (!this.broadcastRoom || this.disposed) return
    // Just went live - the current-parcel lookup can read stale for a beat and false-trigger the warning.
    if (this.liveStartedAt && Date.now() - this.liveStartedAt < 5000) return
    // Only warn once they've actually left the parcel. A raw distance-to-screen check false-fires while
    // standing still (big parcels, third-person camera, low draw distance). Leaving the parcel is the
    // real precursor to it unloading and killing the stream.
    if (!this.isInCurrentParcel) {
      if (!this.walkAwayWarned) {
        this.walkAwayWarned = true
        app.showSnackbar('walk back toward your showbox - go too far and your stream ends', PanelType.Warning)
      }
    } else {
      this.walkAwayWarned = false
    }
  }

  startMilestonePoll() {
    this.stopMilestonePoll()
    const tick = async () => {
      if (!this.broadcastRoom || this.disposed) return
      this.warnIfWalkingAway()
      const count = await this.fetchViewerCount()
      if (!count) return
      for (const m of VIEWER_MILESTONES) {
        if (count >= m && !this.celebratedMilestones.has(m)) {
          this.celebratedMilestones.add(m)
          this.fireMilestone(m)
        }
      }
    }
    tick()
    this.milestonePollInterval = setInterval(tick, MILESTONE_POLL_MS)
  }

  get volume() {
    if (typeof this.description.volume === 'number') {
      return Math.max(0, Math.min(this.description.volume, MAX_VOLUME))
    }
    return DEFAULT_VOLUME
  }

  get rolloffFactor() {
    if (typeof this.description.rolloffFactor === 'number') {
      return this.description.rolloffFactor
    }
    return 0
  }

  get audio() {
    return window._audio
  }

  effectiveStreamVolume() {
    const parcelVol = this.audio?.parcelOut.gain.value ?? 1
    return Math.min(1, Math.max(0, this.volume * parcelVol))
  }

  refreshStreamVolume() {
    const flatVol = this.effectiveStreamVolume()
    for (const el of this.streamAudioEls) {
      const spatial = this.streamSpatialByEl.get(el)
      if (spatial) {
        spatial.volume = this.volume
      } else {
        el.volume = flatVol
      }
    }
    for (const el of this.cohostMonitorEls) {
      el.volume = flatVol
    }
  }

  disposeStreamSpatial(el: HTMLAudioElement) {
    const spatial = this.streamSpatialByEl.get(el)
    if (!spatial) return
    try {
      spatial.dispose()
    } catch {}
    this.streamSpatialByEl.delete(el)
  }

  untrackStreamAudio(el: HTMLAudioElement) {
    const i = this.streamAudioEls.indexOf(el)
    if (i >= 0) this.streamAudioEls.splice(i, 1)
    this.disposeStreamSpatial(el)
  }

  wireStreamSpatial(el: HTMLAudioElement) {
    if (this.rolloffFactor <= 0 || !this.audio) return false
    // createMediaElementSource throws if the element is already wired to WebAudio - fall back to flat volume.
    try {
      const source = BABYLON.Engine.audioEngine?.audioContext?.createMediaElementSource(el)
      if (!source) return false
      const spatial = this.audio.createSpatialAudio({
        name: 'feature/showbox/stream',
        outputBus: AudioBus.Parcel,
        audioNode: source,
        absolutePosition: this.absolutePosition.clone(),
        rolloffFactor: this.rolloffFactor,
      })
      spatial.volume = this.volume
      this.streamSpatialByEl.set(el, spatial)
      el.volume = 1
      return true
    } catch {
      return false
    }
  }

  trackStreamAudio(el: HTMLAudioElement) {
    this.streamAudioEls.push(el)
    if (!this.wireStreamSpatial(el)) {
      el.volume = this.effectiveStreamVolume()
    }
    if (!this.streamVolumeInterval) {
      this.streamVolumeInterval = setInterval(() => this.refreshStreamVolume(), VOLUME_REFRESH_INTERVAL)
    }
  }

  stopStreamVolumePoll() {
    if (this.streamVolumeInterval) {
      clearInterval(this.streamVolumeInterval)
      this.streamVolumeInterval = null
    }
    for (const el of [...this.streamAudioEls]) {
      this.disposeStreamSpatial(el)
    }
    this.streamAudioEls = []
  }

  get guestMode(): GuestMode {
    return this.description.guestMode === 'cohost' ? 'cohost' : 'solo'
  }

  isCohostMode() {
    return this.guestMode === 'cohost'
  }

  hasRemoteBroadcaster() {
    if (!this.displaysStream()) return false
    return [...((this.livekitRoom as any)?.participants?.values() ?? [])].some((p: any) => p?.videoTracks?.size > 0 || p?.audioTracks?.size > 0)
  }

  // Before we drop __showbox_live, check if another co-host is still publishing.
  hasOtherLivePublishers() {
    const room = this.broadcastRoom ?? this.livekitRoom
    if (!room) return false
    try {
      for (const p of (room as any).participants?.values() ?? []) {
        for (const pub of p.videoTracks.values()) {
          if (pub.track) return true
        }
      }
    } catch {}
    return false
  }

  ensureShowboxLiveFlag() {
    if (!this.broadcastRoom || this.streamTargetsThisShowbox()) return
    try {
      this.parcel.sendStatePatch({ __showbox_live: this.uuid })
    } catch {}
  }

  canOpenBroadcastPanel() {
    if (this.isMirror()) return false
    return isGuestForShowbox(this.uuid) || this.parcel.canEdit
  }

  isGuestPublisherIdentity(identity: string) {
    return cohostIdentityPrefix(identity).startsWith('guest-')
  }

  isHostPublisherIdentity(identity: string) {
    return !this.isGuestPublisherIdentity(identity)
  }

  get mirrorSource(): MirrorSource {
    const s = this.description.mirrorSource
    return s === 'host' || s === 'collaborator' || s === 'guest' ? s : 'auto'
  }

  // classify a publisher by the parcel role of their wallet (guests are guest-prefixed identities)
  publisherRole(identity: string): MirrorRole {
    if (this.isGuestPublisherIdentity(identity)) return 'guest'
    const wallet = cohostIdentityPrefix(identity).toLowerCase()
    const owners = this.parcel.owners.map((w) => (w || '').toLowerCase())
    return owners.includes(wallet) ? 'host' : 'collaborator'
  }

  shouldPlayCohostAudio(participantIdentity: string) {
    if (!this.isCohostMode() || !this.broadcastRoom || !this.livekitRoom) return false
    const theirs = cohostIdentityPrefix(participantIdentity)
    const myPub = cohostIdentityPrefix(this.broadcastRoom.localParticipant.identity)
    const mySub = cohostIdentityPrefix(this.livekitRoom.localParticipant.identity)
    if (theirs === myPub || theirs === mySub) return false
    const iAmGuest = isGuestForShowbox(this.uuid)
    if (iAmGuest) return this.isHostPublisherIdentity(participantIdentity)
    return this.isGuestPublisherIdentity(participantIdentity)
  }

  trackCohostMonitor(el: HTMLAudioElement) {
    el.volume = this.effectiveStreamVolume()
    el.style.display = 'none'
    document.body.appendChild(el)
    this.cohostMonitorEls.push(el)
    // going live tears down the viewer volume poll - restart it so monitors track parcel/showbox volume.
    if (!this.streamVolumeInterval) {
      this.streamVolumeInterval = setInterval(() => this.refreshStreamVolume(), VOLUME_REFRESH_INTERVAL)
    }
  }

  clearCohostMonitor() {
    for (const el of this.cohostMonitorEls) {
      el.remove()
    }
    this.cohostMonitorEls = []
  }

  stopCohostComposite() {
    if (this.cohostCompositeRetryRaf) {
      cancelAnimationFrame(this.cohostCompositeRetryRaf)
      this.cohostCompositeRetryRaf = null
    }
    if (this.cohostCompositeRaf) {
      cancelAnimationFrame(this.cohostCompositeRaf)
      this.cohostCompositeRaf = null
    }
    this.ownerVideoEl?.remove()
    this.ownerVideoEl = null
    this.guestVideoEl?.remove()
    this.guestVideoEl = null
    this.cohostCompositeEl?.remove()
    this.cohostCompositeEl = null
    this.cohostCanvas = null
    this.cohostCompositeAttached = false
    this.syncCohostPreview = null
    this.clearCohostMonitor()
  }

  drawCohostFrame() {
    if (!this.cohostCanvas) return false
    const ownerReady = cohostVideoReady(this.ownerVideoEl)
    const guestReady = cohostVideoReady(this.guestVideoEl)
    if (!ownerReady && !guestReady) return false

    const canvas = this.cohostCanvas
    const ctx = canvas.getContext('2d')!
    const w = canvas.width
    const h = canvas.height
    ctx.fillStyle = '#0d0d0d'
    ctx.fillRect(0, 0, w, h)
    if (ownerReady && guestReady) {
      ctx.drawImage(this.ownerVideoEl!, 0, 0, w / 2, h)
      ctx.drawImage(this.guestVideoEl!, w / 2, 0, w / 2, h)
    } else if (ownerReady) {
      ctx.drawImage(this.ownerVideoEl!, 0, 0, w, h)
    } else if (guestReady) {
      ctx.drawImage(this.guestVideoEl!, 0, 0, w, h)
    }
    return true
  }

  mountCohostPreviewVideo(objectFit: string) {
    const v = document.createElement('video')
    v.muted = true
    v.volume = 0
    v.playsInline = true
    v.autoplay = true
    Object.assign(v.style, { width: '100%', height: '100%', objectFit, display: 'block' })
    this.syncCohostPreview = () => {
      const src = this.cohostCompositeEl?.srcObject
      if (!src || v.srcObject === src) return
      v.srcObject = src
      v.play().catch(() => {})
    }
    this.syncCohostPreview()
    return v
  }

  wireLocalCohostVideo(el: HTMLVideoElement) {
    el.muted = true
    el.playsInline = true
    el.autoplay = true
    el.style.display = 'none'
    document.body.appendChild(el)
    el.play().catch(() => {})
    el.addEventListener('loadeddata', () => this.updateCohostComposite(), { once: true })
    if (isGuestForShowbox(this.uuid)) {
      if (this.guestVideoEl !== el) this.guestVideoEl?.remove()
      this.guestVideoEl = el
    } else {
      if (this.ownerVideoEl !== el) this.ownerVideoEl?.remove()
      this.ownerVideoEl = el
    }
  }

  syncExistingCohostVideos() {
    if (!this.isCohostMode() || !this.livekitRoom) return
    for (const p of (this.livekitRoom as any).participants?.values() ?? []) {
      for (const pub of p.videoTracks?.values() ?? []) {
        if (this.isAngleTrackName(pub.trackName)) continue // angle feeds are not cohost composite sources
        if (pub.isSubscribed && pub.track) this.routeCohostVideo(pub.track, p.identity)
      }
    }
  }

  syncExistingCohostAudio() {
    if (!this.isCohostMode() || !this.livekitRoom || !this.broadcastRoom) return
    // Re-attaching the same track makes a second <audio> element (= double audio). Clear first so
    // this is safe to call from the subscribe handler, the viewer-connect finally, and go-live.
    this.clearCohostMonitor()
    for (const p of (this.livekitRoom as any).participants?.values() ?? []) {
      if (!this.shouldPlayCohostAudio(p.identity)) continue
      for (const pub of p.audioTracks?.values() ?? []) {
        if (pub.isSubscribed && pub.track) this.trackCohostMonitor(pub.track.attach() as HTMLAudioElement)
      }
    }
    this.startBroadcastAudio()
  }

  updateCohostComposite() {
    if (!this.isCohostMode() || this.disposed) return

    // A guest who just went live is waiting on the host's video. Show a connecting card instead of
    // a half-empty composite, but only briefly - after the grace window we show whatever we have.
    const waitingForHost = !!this.broadcastRoom && !this.cohostCompositeAttached && isGuestForShowbox(this.uuid) && !cohostVideoReady(this.ownerVideoEl) && Date.now() - this.cohostLiveSince < COHOST_CONNECT_GRACE_MS
    if (waitingForHost) {
      this.setCohostConnecting()
      return
    }

    if (!this.cohostCanvas) {
      this.cohostCanvas = document.createElement('canvas')
      this.cohostCanvas.width = 640
      this.cohostCanvas.height = 360
    }

    if (!this.drawCohostFrame()) {
      this.hasActiveVideo = false
      this.syncCohostPreview?.()
      if (!this.cohostCompositeRetryRaf) {
        this.cohostCompositeRetryRaf = requestAnimationFrame(() => {
          this.cohostCompositeRetryRaf = null
          this.updateCohostComposite()
        })
      }
      return
    }
    if (this.cohostCompositeRetryRaf) {
      cancelAnimationFrame(this.cohostCompositeRetryRaf)
      this.cohostCompositeRetryRaf = null
    }

    if (!this.cohostCompositeEl) {
      const stream = this.cohostCanvas.captureStream(30)
      this.cohostCompositeEl = document.createElement('video')
      this.cohostCompositeEl.srcObject = stream
      this.cohostCompositeEl.muted = true
      this.cohostCompositeEl.playsInline = true
      this.cohostCompositeEl.autoplay = true
      this.cohostCompositeEl.play().catch(() => {})
    }

    if (!this.cohostCompositeAttached) {
      this.attachVideoToMesh(this.cohostCompositeEl, true)
      this.cohostCompositeAttached = true
      this.hasActiveVideo = true
    }

    if (!this.cohostCompositeRaf) {
      const tick = () => {
        if (!this.cohostCanvas || this.disposed) {
          this.cohostCompositeRaf = null
          return
        }
        if (!this.drawCohostFrame()) {
          this.cohostCompositeRaf = null
          this.hasActiveVideo = false
          if (!this.cohostCompositeRetryRaf) {
            this.cohostCompositeRetryRaf = requestAnimationFrame(() => {
              this.cohostCompositeRetryRaf = null
              this.updateCohostComposite()
            })
          }
          return
        }
        this.cohostCompositeRaf = requestAnimationFrame(tick)
      }
      this.cohostCompositeRaf = requestAnimationFrame(tick)
    }
    this.syncCohostPreview?.()
  }

  routeCohostVideo(track: any, identity: string) {
    const el = track.attach() as HTMLVideoElement
    el.muted = true
    el.playsInline = true
    el.autoplay = true
    el.style.display = 'none'
    document.body.appendChild(el)
    el.play().catch(() => {})
    el.addEventListener('loadeddata', () => this.updateCohostComposite(), { once: true })

    if (this.isGuestPublisherIdentity(identity)) {
      if (this.guestVideoEl !== el) this.guestVideoEl?.remove()
      this.guestVideoEl = el
    } else {
      if (this.ownerVideoEl !== el) this.ownerVideoEl?.remove()
      this.ownerVideoEl = el
    }
    this.updateCohostComposite()
  }

  clearCohostVideoForIdentity(identity: string) {
    if (this.isGuestPublisherIdentity(identity)) {
      this.guestVideoEl?.remove()
      this.guestVideoEl = null
    } else {
      this.ownerVideoEl?.remove()
      this.ownerVideoEl = null
    }
  }

  shouldBeInteractive(): boolean {
    return true
  }

  whatIsThis() {
    return <label>Live stream video and audio to anyone in the parcel.</label>
  }

  // Editing a live showbox must never tear it down. The plane mesh never needs rebuilding:
  // setCommon re-applies the transform and afterSetCommon re-applies spatial audio (volume +
  // rolloff). The base update() regenerates for non-transform props (rolloff/guestMode), which
  // disposes the feature and kills the broadcast for everyone - so skip it and just setCommon.
  update(props: Partial<any>) {
    Object.assign(this.description, props)
    this.setCommon()
    if (this.isMirror()) {
      // toggled off angle mode while broadcasting one - drop the orphaned track
      if (this.angleVideoTrack && !this.isAngleMirror()) this.stopAngleBroadcast()
      this.refreshMirrorVideo()
      this.setPreview()
    }
  }

  generate() {
    this.mesh = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    this.mesh.id = this.mesh.name + '/' + this.uuid
    this.setCommon()
    this.afterSetCommon = () => {
      for (const spatial of this.streamSpatialByEl.values()) {
        spatial.setPosition(this.absolutePosition)
        spatial.volume = this.volume
        spatial.rolloffFactor = this.rolloffFactor
      }
    }
    this.addEvents()
    this.setPreview()
    if (this.isInCurrentParcel) {
      this.onEnter()
    }
    if (process.env.NODE_ENV !== 'production') {
      try {
        const q = new URLSearchParams(location.search)
        if (q.get('debugShowboxDock') === this.uuid) {
          setTimeout(() => this.openBroadcastPanel(), 5000)
        }
      } catch {}
    }
    return Promise.resolve()
  }

  onEnter = () => {
    if (!this.livekitRoom) {
      this.connectViewer()
    }
    // Guest pass redirects with ?show=<uuid> - auto-open the broadcast dock so they don't have to find/click the panel.
    // Host links (?host=1) need a signed-in parcel owner - prompt login first if needed.
    // Wallet may still be loading from the jwt cookie when onEnter fires; retry after app state settles.
    if (this.broadcastPanel) return
    const tryAutoOpen = () => {
      if (this.broadcastPanel || this.joinDockAutoOpened) return true
      if (isGuestForShowbox(this.uuid)) {
        this.joinDockAutoOpened = true
        clearShowboxJoinParams()
        this.openBroadcastPanel()
        return true
      }
      if (wantsHostJoin(this.uuid)) {
        if (!app.signedIn) {
          this.promptHostSignIn()
          return false
        }
        if (!this.parcel.canEdit) {
          app.showSnackbar('sign in as the parcel owner to use this host link', PanelType.Warning)
          return false
        }
        this.joinDockAutoOpened = true
        clearShowboxJoinParams()
        this.openBroadcastPanel()
        return true
      }
      return false
    }
    setTimeout(() => {
      if (tryAutoOpen()) return
      void app.getState().then(() => {
        if (tryAutoOpen()) return
        if (!this.broadcastRoom && !this.hasActiveVideo) this.setPreview()
      })
    }, 250)
  }

  promptHostSignIn() {
    if (this.hostJoinLoginPending || this.broadcastPanel) return
    this.hostJoinLoginPending = true
    window.ui?.setPane('login')
    app.showSnackbar('sign in to go live as host', PanelType.Success)
    app.once(AppEvent.Login, () => {
      this.hostJoinLoginPending = false
      setTimeout(() => {
        if (this.disposed || !this.isInCurrentParcel || this.broadcastPanel) return
        if (!wantsHostJoin(this.uuid)) return
        if (!app.signedIn) return
        if (!this.parcel.canEdit) {
          app.showSnackbar('this account cannot host here - use the parcel owner account', PanelType.Warning)
          return
        }
        this.joinDockAutoOpened = true
        clearShowboxJoinParams()
        this.openBroadcastPanel()
      }, 500)
    })
  }

  onExit = () => {
    this.stopViewerRetry()
    this.stopStreamAttachRetry()
    this.viewerRoomFull = false
    // if we're on the stage (publishing), stay connected as a viewer too so our own composite
    // doesn't go blank when we step outside the parcel. we only tear down on dispose / stopBroadcast.
    if (this.livekitRoom && !this.broadcastRoom) {
      this.livekitRoom.disconnect()
      this.livekitRoom = null
      this.hasActiveVideo = false
      this.stopStreamVolumePoll()
      this.audio?.removeUserAudioReference(this)
    }
  }

  stopViewerRetry() {
    if (this.viewerRetryInterval) {
      clearInterval(this.viewerRetryInterval)
      this.viewerRetryInterval = null
    }
  }

  scheduleViewerRetry() {
    if (this.viewerRetryInterval || this.disposed || !this.isInCurrentParcel) return
    this.viewerRetryInterval = setInterval(() => {
      if (this.disposed || !this.isInCurrentParcel || this.broadcastRoom || this.livekitRoom || this.viewerConnecting) return
      if (this.viewerRoomFull) this.connectViewer()
    }, VIEWER_RETRY_INTERVAL)
  }

  stopStreamAttachRetry() {
    if (this.streamAttachRetryInterval) {
      clearInterval(this.streamAttachRetryInterval)
      this.streamAttachRetryInterval = null
    }
    this.streamAttachAttempts = 0
  }

  scheduleStreamAttachRetry() {
    if (this.streamAttachRetryInterval || this.disposed || this.broadcastRoom) return
    if (!this.displaysStream()) return
    this.streamAttachAttempts = 0
    this.streamAttachRetryInterval = setInterval(() => {
      if (this.disposed || !this.isInCurrentParcel || this.broadcastRoom) {
        this.stopStreamAttachRetry()
        return
      }
      if (!this.displaysStream()) {
        this.stopStreamAttachRetry()
        return
      }
      if (this.hasActiveVideo) {
        this.stopStreamAttachRetry()
        return
      }
      this.tryAttachExistingStream()
      if (this.hasActiveVideo) {
        this.stopStreamAttachRetry()
        return
      }
      this.streamAttachAttempts++
      if (this.streamAttachAttempts >= STREAM_ATTACH_RECONNECT_AFTER && this.livekitRoom && !this.viewerConnecting) {
        this.viewerConnectGen++
        this.livekitRoom.disconnect()
        this.livekitRoom = null
        this.stopStreamAttachRetry()
        this.connectViewer()
      }
    }, STREAM_ATTACH_RETRY_MS)
  }

  dispose() {
    this._dispose()
    this.stopMilestonePoll()
    this.stopViewerRetry()
    this.stopStreamAttachRetry()
    this.viewerRoomFull = false
    this.closeAnglePanel()
    this.stopAngleBroadcast(true)
    this.livekitRoom?.disconnect()
    this.livekitRoom = null
    this.stopStreamVolumePoll()
    this.stopCohostComposite()
    this.stopBroadcast(true)
    this.broadcastPanel?.remove()
    this.broadcastPanel = null
    this.hostJoinLoginPending = false
    this.audio?.removeUserAudioReference(this)
  }

  setPreview() {
    if (this.disposed) return
    if (this.broadcastRoom && this.localBroadcastVideoEl) {
      this.attachVideoToMesh(this.localBroadcastVideoEl, true)
      return
    }
    if (this.broadcastRoom) return
    if (this.hasActiveVideo) return
    const w = 640
    const h = 360
    const tex = new BABYLON.DynamicTexture(this.uniqueEntityName('texture'), { width: w, height: h }, this.scene, false)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    const font = 'bold 18px "Source Code Pro", monospace'

    ctx.fillStyle = '#0d0d0d'
    ctx.fillRect(0, 0, w, h)
    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#f5f5f0'

    // an angle mirror never shows the primary's stream, so "connecting..." would lie - skip it and show its own cta/placeholder
    const hasRemoteBroadcaster = this.hasRemoteBroadcaster() && !this.isAngleMirror()

    if (hasRemoteBroadcaster && !(this.isCohostMode() && this.canOpenBroadcastPanel())) {
      ctx.fillStyle = '#888'
      ctx.fillText(mobile && !this.hasActiveVideo ? 'tap to listen' : 'connecting to stream...', w / 2, h / 2)
    } else if (!this.isMirror() && (this.parcel.canEdit || isGuestForShowbox(this.uuid))) {
      ctx.fillText('showbox', w / 2, h / 2 - 20)
      const cta = '\u25CF click here to go live'
      const tw = ctx.measureText(cta).width
      const padX = 14
      const padY = 10
      const bw = tw + padX * 2
      const bh = 20 + padY * 2
      ctx.fillStyle = 'rgba(220,30,30,0.85)'
      ctx.fillRect(w / 2 - bw / 2, h / 2 + 10, bw, bh)
      ctx.fillStyle = '#f5f5f0'
      ctx.fillText(cta, w / 2, h / 2 + 10 + bh / 2)
    } else if (this.viewerRoomFull) {
      ctx.fillStyle = '#f5f5f0'
      ctx.fillText('this show is full', w / 2, h / 2 - 14)
      ctx.fillStyle = '#888'
      ctx.fillText('hang tight -- retrying for a spot', w / 2, h / 2 + 14)
    } else if (mobile && this.livekitRoom && this.streamTargetsThisShowbox()) {
      ctx.fillStyle = '#888'
      ctx.fillText('connecting to stream...', w / 2, h / 2)
    } else if (this.canBroadcastAngle()) {
      ctx.fillText('second camera', w / 2, h / 2 - 20)
      const cta = '\u25CF broadcast camera to this mirror'
      const tw = ctx.measureText(cta).width
      const padX = 14
      const padY = 10
      const bw = tw + padX * 2
      const bh = 20 + padY * 2
      ctx.fillStyle = 'rgba(220,30,30,0.85)'
      ctx.fillRect(w / 2 - bw / 2, h / 2 + 10, bw, bh)
      ctx.fillStyle = '#f5f5f0'
      ctx.fillText(cta, w / 2, h / 2 + 10 + bh / 2)
    } else if (this.isAngleMirror()) {
      ctx.fillStyle = '#888'
      ctx.fillText('second camera', w / 2, h / 2)
    } else if (this.isMirror()) {
      ctx.fillStyle = '#888'
      ctx.fillText('showbox mirror', w / 2, h / 2)
    } else {
      ctx.fillStyle = '#888'
      ctx.fillText('no stream active', w / 2, h / 2)
    }

    tex.update()
    tex.hasAlpha = false

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = tex
    material.backFaceCulling = false
    material.zOffset = -4
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 1, 1)
    material.blockDirtyMechanism = true

    if (this.mesh) this.mesh.material = material
  }

  setCohostConnecting() {
    if (this.disposed || !this.mesh) return
    const w = 640
    const h = 360
    const tex = new BABYLON.DynamicTexture(this.uniqueEntityName('texture'), { width: w, height: h }, this.scene, false)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    ctx.fillStyle = '#0d0d0d'
    ctx.fillRect(0, 0, w, h)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.font = 'bold 18px "Source Code Pro", monospace'
    ctx.fillStyle = '#f5f5f0'
    ctx.fillText('connecting your co-host...', w / 2, h / 2 - 12)
    ctx.font = '14px "Source Code Pro", monospace'
    ctx.fillStyle = '#888'
    ctx.fillText("hang tight -- audio's on the way", w / 2, h / 2 + 16)
    tex.update()
    tex.hasAlpha = false

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = tex
    material.backFaceCulling = false
    material.zOffset = -4
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 1, 1)
    material.blockDirtyMechanism = true

    if (this.mesh) this.mesh.material = material
  }

  async connectViewer() {
    if (this.livekitRoom || this.viewerConnecting) return
    const gen = ++this.viewerConnectGen
    this.viewerConnecting = true
    const res = await fetch(`/api/rooms/${this.roomName()}/token`, { credentials: 'include' })
      .then((r) => r.json())
      .catch(() => null)
    if (!res?.token || this.disposed) {
      this.viewerConnecting = false
      return
    }

    const room = new Room()
    this.livekitRoom = room

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (this.livekitRoom !== room) return
      const identity = participant?.identity ?? ''
      if (track.kind === Track.Kind.Video && this.isAngleTrackName(_pub?.trackName)) {
        if (this.isAngleMirror() && _pub.trackName === this.uuid) this.refreshAngleVideo()
        return // angle feeds only land on their matching mirror
      }
      if (this.broadcastRoom) {
        if (this.isCohostMode() && track.kind === Track.Kind.Audio && this.shouldPlayCohostAudio(identity)) {
          this.trackCohostMonitor(track.attach() as HTMLAudioElement)
          this.startBroadcastAudio()
          return
        }
        if (this.isCohostMode() && track.kind === Track.Kind.Video) {
          this.routeCohostVideo(track, identity)
          return
        }
        return
      }
      if (!this.streamTargetsThisShowbox()) {
        if (this.mirrorsActiveStream() && track.kind === Track.Kind.Video) this.refreshMirrorVideo()
        return
      }
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLAudioElement
        el.style.display = 'none'
        document.body.appendChild(el)
        this.trackStreamAudio(el)
        this.audio?.addUserAudioReference(this)
        this.startBroadcastAudio()
        return
      }
      if (track.kind === Track.Kind.Video) {
        if (this.isCohostMode()) {
          this.routeCohostVideo(track, identity)
        } else {
          this.attachVideoToMesh(track.attach() as HTMLVideoElement)
        }
        this.startBroadcastAudio()
        this.stopStreamAttachRetry()
      }
    })

    room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
      if (this.livekitRoom !== room) return
      const identity = participant?.identity ?? ''
      if (track.kind === Track.Kind.Video && this.isAngleTrackName(_pub?.trackName)) {
        if (this.isAngleMirror() && _pub.trackName === this.uuid) this.refreshAngleVideo()
        return
      }
      if (this.isMirror()) {
        if (track.kind === Track.Kind.Video) this.refreshMirrorVideo()
        return
      }
      if (this.broadcastRoom) {
        if (this.isCohostMode() && track.kind === Track.Kind.Audio) {
          track.detach().forEach((node) => {
            const i = this.cohostMonitorEls.indexOf(node as HTMLAudioElement)
            if (i >= 0) this.cohostMonitorEls.splice(i, 1)
          })
          return
        }
        if (this.isCohostMode() && track.kind === Track.Kind.Video) {
          this.clearCohostVideoForIdentity(identity)
          this.updateCohostComposite()
          return
        }
        return
      }
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((node) => {
          this.untrackStreamAudio(node as HTMLAudioElement)
        })
        if (!this.streamAudioEls.length) {
          if (this.streamVolumeInterval) {
            clearInterval(this.streamVolumeInterval)
            this.streamVolumeInterval = null
          }
        }
        this.audio?.removeUserAudioReference(this)
      }
      if (track.kind === Track.Kind.Video) {
        if (this.isCohostMode()) {
          this.clearCohostVideoForIdentity(identity)
          this.updateCohostComposite()
        } else {
          this.hasActiveVideo = false
          if (!this.broadcastRoom) this.setPreview()
        }
        return
      }
      if (!this.broadcastRoom && !this.hasActiveVideo) this.setPreview()
    })

    room.on(RoomEvent.AudioPlaybackStatusChanged, (playing) => {
      if (playing) {
        this.audio?.addUserAudioReference(this)
      } else {
        this.armGestureUnblock()
      }
    })

    room.on(RoomEvent.ParticipantConnected, () => {
      if (this.livekitRoom !== room) return
      if (!this.broadcastRoom) this.tryAttachExistingStream()
      this.setPreview()
    })
    room.on(RoomEvent.ParticipantDisconnected, () => {
      if (this.livekitRoom !== room) return
      if (this.isCohostMode()) {
        this.updateCohostComposite()
        this.ensureShowboxLiveFlag()
      }
      if (!this.hasActiveVideo) this.setPreview()
    })

    try {
      await room.connect(LIVEKIT_URL, res.token)
      this.viewerRoomFull = false
      this.stopViewerRetry()
    } catch (e) {
      room.disconnect()
      this.livekitRoom = null
      if (isRoomFullError(e)) {
        this.viewerRoomFull = true
        this.scheduleViewerRetry()
      }
    } finally {
      this.viewerConnecting = false
      if (gen !== this.viewerConnectGen) {
        if (this.livekitRoom !== room) room.disconnect()
        return
      }
      if (this.isCohostMode() && this.broadcastRoom && this.livekitRoom) {
        this.syncExistingCohostVideos()
        this.syncExistingCohostAudio()
        this.updateCohostComposite()
      }
      if (!this.isCohostMode() && this.broadcastRoom && this.livekitRoom) {
        this.livekitRoom.disconnect()
        this.livekitRoom = null
      }
      if (this.displaysStream() && !this.broadcastRoom) {
        this.tryAttachExistingStream()
        if (!this.hasActiveVideo) this.scheduleStreamAttachRetry()
      }
      this.setPreview()
    }
  }

  startBroadcastAudio() {
    if (!this.livekitRoom) return
    this.livekitRoom.startAudio().catch(() => {})
    this.audio?.addUserAudioReference(this)
  }

  unblockAudiencePlayback() {
    if (this.broadcastRoom || !this.livekitRoom) return
    this.startBroadcastAudio()
    this.tryAttachExistingStream()
    if (this.streamTargetsThisShowbox() && !this.hasActiveVideo) this.scheduleStreamAttachRetry()
  }

  gestureUnblockArmed = false
  armGestureUnblock() {
    if (this.gestureUnblockArmed) return
    this.gestureUnblockArmed = true
    const unblock = () => {
      this.gestureUnblockArmed = false
      this.startBroadcastAudio()
    }
    window.addEventListener('pointerdown', unblock, { once: true, passive: true })
    window.addEventListener('keydown', unblock, { once: true, passive: true })
    window.addEventListener('touchstart', unblock, { once: true, passive: true })
  }

  attachVideoToMesh(el: HTMLVideoElement, muted = false, retries = 0) {
    if (!this.mesh) {
      if (retries < 30) requestAnimationFrame(() => this.attachVideoToMesh(el, muted, retries + 1))
      return
    }
    el.muted = muted
    el.autoplay = true
    el.play().catch(() => {})

    this.hasActiveVideo = true
    const tex = new BABYLON.VideoTexture(this.uniqueEntityName('texture'), el, this.scene, false, false)
    tex.hasAlpha = false

    const mat = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    mat.diffuseTexture = tex
    mat.backFaceCulling = false
    mat.zOffset = -4
    mat.specularColor.set(0, 0, 0)
    mat.emissiveColor.set(1, 1, 1)
    mat.blockDirtyMechanism = true

    this.mesh.material = mat
  }

  startThumbCapture(videoEl?: HTMLVideoElement) {
    if (this.thumbInterval) {
      clearInterval(this.thumbInterval)
      this.thumbInterval = null
    }
    if (!this.thumbCanvas) {
      this.thumbCanvas = document.createElement('canvas')
      this.thumbCanvas.width = 256
      this.thumbCanvas.height = 144
    }
    const canvas = this.thumbCanvas
    const ctx = canvas.getContext('2d')!
    const room = this.roomName()
    const id = this.parcel.id
    const parcel = { id, name: this.parcel.name, address: this.parcel.address }
    this.thumbInterval = setInterval(() => {
      try {
        if (this.isCohostMode()) {
          if (!this.cohostCanvas) {
            this.cohostCanvas = document.createElement('canvas')
            this.cohostCanvas.width = 640
            this.cohostCanvas.height = 360
          }
          if (!this.drawCohostFrame()) return
          ctx.drawImage(this.cohostCanvas, 0, 0, 256, 144)
        } else if (videoEl) {
          ctx.drawImage(videoEl, 0, 0, 256, 144)
        } else return
        const thumbnail = canvas.toDataURL('image/jpeg', 0.2)
        const coord = encodeCoords({ position: cameraPosition(this.scene), rotation: cameraRotation(this.scene) })
        fetch(`/api/rooms/${room}/thumbnail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: app.avatarRef, parcel, coord, thumbnail }),
        }).catch(() => {})
      } catch {}
    }, 1000)
  }

  stopThumbCapture(silent = false) {
    if (this.thumbInterval) {
      clearInterval(this.thumbInterval)
      this.thumbInterval = null
    }
    if (!silent) {
      fetch(`/api/rooms/${this.roomName()}/thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnail: null }),
      }).catch(() => {})
    }
  }

  announceLiveInChat() {
    if (this.liveChatAnnounced || !window.connector) return
    // someone is already broadcasting to this showbox, so the show's already been announced live.
    // without this, every cohost who goes live fires their own "is live" message (spammy).
    if (this.hasRemoteBroadcaster()) return
    const hostName = (app.state.name || '').trim()
    if (!hostName) return
    const { parcel, f } = showboxFeatureCoords(this)
    const encoded = showboxAudiencePlayCoordsFromRecord(parcel, f)
    const location = this.parcel.name || this.parcel.address || 'the world'
    window.connector.announceShowLive(hostName, location, encoded)
    this.liveChatAnnounced = true
  }

  stopBroadcast(silent = false) {
    this.liveChatAnnounced = false
    this.walkAwayWarned = false
    this.stopMilestonePoll()
    const othersLive = this.hasOtherLivePublishers()
    try {
      const patch: Record<string, any> = { [this.uuid]: {} }
      // only a real broadcaster clears the live flag; audience teardown must not nuke it for everyone
      if (this.broadcastRoom && this.activeLiveShowboxUuid() === this.uuid && !othersLive) patch.__showbox_live = null
      this.parcel.sendStatePatch(patch)
    } catch {}
    this.stopThumbCapture(silent)
    this.clearCohostMonitor()
    this.broadcastRoom?.disconnect()
    this.broadcastRoom = null
    // ending your session also drops any second-camera feeds you pushed to sibling angle mirrors
    for (const b of this.parcel.getFeaturesByType('showbox') as any[]) {
      if (b?.angleVideoTrack) b.stopAngleBroadcast()
    }
    this.localBroadcastVideoEl = null
    this.hasActiveVideo = false
    this.cohostCompositeAttached = false
    this.syncCohostPreview = null
    this.audio?.removeUserAudioReference(this)
    if (this.liveTimerInterval) {
      clearInterval(this.liveTimerInterval)
      this.liveTimerInterval = null
    }
    this.liveStartedAt = null
    if (this.audioMeterRaf) {
      cancelAnimationFrame(this.audioMeterRaf)
      this.audioMeterRaf = null
    }
    if (this.audioMeterCtx) {
      this.audioMeterCtx.close().catch(() => {})
      this.audioMeterCtx = null
    }
    if (this.broadcastChatDispose) {
      this.broadcastChatDispose()
      this.broadcastChatDispose = null
    }
    if (this.isInCurrentParcel && !this.livekitRoom) {
      this.connectViewer()
    } else if (this.isCohostMode() && this.livekitRoom) {
      this.cohostCompositeAttached = false
      this.updateCohostComposite()
    }
  }

  openBroadcastPanel() {
    if (this.isMirror()) return
    if (this.broadcastPanel) {
      this.broadcastPanel.remove()
      this.broadcastPanel = null
      this.stopBroadcast()
      return
    }

    if ((wantsHostJoin(this.uuid) || isGuestForShowbox(this.uuid)) && !this.joinDockAutoOpened) {
      this.joinDockAutoOpened = true
      clearShowboxJoinParams()
    }

    exitPointerLock()

    const isGuest = isGuestForShowbox(this.uuid)

    const panel = document.createElement('div')
    this.broadcastPanel = panel
    // mobile setup = full screen dock. mobile live defaults to large self-feed; toggle reveals voxels above.
    const MOBILE_WORLD_VIEW = '36vh'
    let mobileShowWorld = false
    let mobilePreviewWrap: HTMLDivElement | null = null
    let mobileWorldBtn: HTMLButtonElement | null = null
    let mobileStreamHint: HTMLDivElement | null = null
    let mobileExtrasBtn: HTMLButtonElement | null = null
    let mobileExtrasOpen = false
    const setMobileDockLayout = (live: boolean) => {
      if (!mobile) return
      if (!live) {
        mobileShowWorld = false
        panel.style.inset = '0'
        panel.style.top = '0'
        panel.style.left = '0'
        panel.style.right = '0'
        panel.style.bottom = '0'
        if (mobilePreviewWrap) mobilePreviewWrap.style.display = 'none'
        if (mobileStreamHint) mobileStreamHint.style.display = 'none'
        if (mobileWorldBtn) mobileWorldBtn.style.display = 'none'
        if (mobileExtrasBtn) mobileExtrasBtn.style.display = 'none'
        mobileExtrasOpen = false
        return
      }
      if (mobileShowWorld) {
        panel.style.inset = 'auto'
        panel.style.top = MOBILE_WORLD_VIEW
        panel.style.left = '0'
        panel.style.right = '0'
        panel.style.bottom = '0'
        if (mobilePreviewWrap) mobilePreviewWrap.style.display = 'none'
        if (mobileStreamHint) mobileStreamHint.style.display = 'block'
        if (mobileWorldBtn) mobileWorldBtn.textContent = 'see your feed'
      } else {
        panel.style.inset = '0'
        panel.style.top = '0'
        panel.style.left = '0'
        panel.style.right = '0'
        panel.style.bottom = '0'
        if (mobilePreviewWrap) mobilePreviewWrap.style.display = 'block'
        if (mobileStreamHint) mobileStreamHint.style.display = 'none'
        if (mobileWorldBtn) mobileWorldBtn.textContent = 'see world'
      }
      if (mobileWorldBtn) mobileWorldBtn.style.display = 'block'
      panel.style.overflow = live ? 'hidden' : 'auto'
    }
    const setDesktopDockLayout = (live: boolean) => {
      if (mobile) return
      panel.style.top = live ? '12px' : '50%'
      panel.style.right = live ? '12px' : 'auto'
      panel.style.left = live ? 'auto' : '50%'
      panel.style.bottom = 'auto'
      panel.style.transform = live ? 'none' : 'translate(-50%, -50%)'
      panel.style.width = '340px'
      panel.style.maxHeight = live ? 'calc(100vh - 24px)' : '85vh'
    }
    if (mobile) {
      mobileWorldBtn = document.createElement('button')
      mobileWorldBtn.type = 'button'
      mobileWorldBtn.textContent = 'see world'
      Object.assign(mobileWorldBtn.style, {
        display: 'none',
        background: 'transparent',
        color: '#888',
        border: '0',
        padding: '0',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '12px',
        textDecoration: 'underline',
        flexShrink: '0',
      })
      mobileWorldBtn.onclick = () => {
        mobileShowWorld = !mobileShowWorld
        setMobileDockLayout(true)
      }
      mobileExtrasBtn = document.createElement('button')
      mobileExtrasBtn.type = 'button'
      mobileExtrasBtn.textContent = 'emotes'
      Object.assign(mobileExtrasBtn.style, {
        display: 'none',
        background: 'transparent',
        color: '#888',
        border: '0',
        padding: '4px 0',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '12px',
        textAlign: 'left',
        textDecoration: 'underline',
        flexShrink: '0',
      })
      mobileExtrasBtn.onclick = () => {
        mobileExtrasOpen = !mobileExtrasOpen
        moveRow.style.display = mobileExtrasOpen ? 'flex' : 'none'
        mobileExtrasBtn!.textContent = mobileExtrasOpen ? 'hide emotes' : 'emotes'
      }
    }
    if (mobile) {
      Object.assign(panel.style, {
        position: 'fixed',
        zIndex: '999999',
        inset: '0',
        background: '#0d0d0d',
        color: '#f5f5f0',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        overflowY: 'auto',
        fontFamily: '"Source Code Pro", monospace',
        fontSize: '15px',
      })
    } else {
      Object.assign(panel.style, {
        position: 'fixed',
        zIndex: '999999',
        background: '#0d0d0d',
        color: '#f5f5f0',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        overflowY: 'auto',
        fontFamily: '"Source Code Pro", monospace',
        fontSize: '13px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      })
      setDesktopDockLayout(false)
    }

    const title = document.createElement('div')
    title.textContent = 'Showbox'
    if (this.isCohostMode()) {
      const cohostHint = document.createElement('small')
      cohostHint.textContent = isGuest ? 'co-host -- go live when ready. use headphones to reduce echo' : 'co-host -- share the guest link, then go live. use headphones to reduce echo'
      cohostHint.style.color = '#888'
      cohostHint.style.display = 'block'
      title.appendChild(document.createElement('br'))
      title.appendChild(cohostHint)
    }
    title.style.fontWeight = 'bold'
    title.style.fontSize = '16px'

    const camLabel = document.createElement('label')
    camLabel.textContent = 'camera'
    const camSel = document.createElement('select')
    Object.assign(camSel.style, { width: '100%', background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: '4px' })

    const micLabel = document.createElement('label')
    micLabel.textContent = 'microphone'
    const micSel = document.createElement('select')
    Object.assign(micSel.style, { width: '100%', background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: '4px' })
    if (mobile) {
      Object.assign(camSel.style, { fontSize: '16px', minHeight: '44px', padding: '8px' })
      Object.assign(micSel.style, { fontSize: '16px', minHeight: '44px', padding: '8px' })
    }

    const screenOpt = document.createElement('label')
    const screenChk = document.createElement('input')
    screenChk.type = 'checkbox'
    screenOpt.append(screenChk, ' use screenshare instead of camera')
    const screenHint = document.createElement('small')
    screenHint.textContent = 'make sure you select share system audio on the next screen if you need shared audio'
    screenHint.style.color = '#888'
    screenHint.style.display = 'none'
    screenChk.onchange = () => {
      screenHint.style.display = screenChk.checked ? 'block' : 'none'
      // screenshare grabs your screen + system audio, not your camera/mic - hide the device pickers so it is not misleading.
      deviceRow.style.display = screenChk.checked ? 'none' : 'flex'
    }
    if (mobile) screenOpt.style.display = 'none' // screenshare from a phone is unreliable; stick to the camera

    const deviceRow = document.createElement('div')
    Object.assign(deviceRow.style, { display: 'flex', flexDirection: 'column', gap: '4px' })
    if (mobile) {
      camLabel.style.display = 'block'
      micLabel.style.display = 'block'
    }
    deviceRow.append(camLabel, camSel, micLabel, micSel)

    const deviceToggle = document.createElement('button')
    deviceToggle.type = 'button'
    deviceToggle.textContent = 'change camera or mic'
    Object.assign(deviceToggle.style, {
      display: 'none',
      background: 'transparent',
      color: '#888',
      border: '0',
      padding: '4px 0',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: '12px',
      textAlign: 'left',
      textDecoration: 'underline',
    })
    deviceToggle.onclick = () => {
      const open = deviceRow.style.display !== 'none'
      deviceRow.style.display = open ? 'none' : 'flex'
      deviceToggle.textContent = open ? 'change camera or mic' : 'hide camera and mic'
    }

    // Mobile one-tap camera flip. facingMode front/back is reliable on phones where deviceId enumeration is flaky.
    let flipFacing: 'user' | 'environment' = 'user'
    const flipBtn = document.createElement('button')
    flipBtn.type = 'button'
    flipBtn.textContent = 'flip camera'
    Object.assign(flipBtn.style, {
      display: 'none',
      background: '#1a1a1a',
      color: '#f5f5f0',
      border: '1px solid #333',
      padding: '12px',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: '16px',
      minHeight: '44px',
    })
    flipBtn.onclick = async () => {
      if (!this.broadcastRoom || !liveVideoTrack) return
      flipFacing = flipFacing === 'user' ? 'environment' : 'user'
      await liveVideoTrack.restartTrack({ facingMode: flipFacing }).catch(() => {})
    }

    // Screenshare goes live with no mic. This lets you add your voice mid-stream - livekit
    // publishes a mic track the first time, then just mutes/unmutes on toggle. Hidden unless screensharing.
    let screenMicOn = false
    const micToggle = document.createElement('button')
    micToggle.type = 'button'
    micToggle.textContent = 'turn on mic'
    Object.assign(micToggle.style, {
      display: 'none',
      background: '#1a1a1a',
      color: '#888',
      border: '1px solid #333',
      padding: '8px 10px',
      cursor: 'pointer',
      fontFamily: 'inherit',
      minHeight: '36px',
    })
    micToggle.onclick = async () => {
      if (!this.broadcastRoom) return
      screenMicOn = !screenMicOn
      micToggle.disabled = true
      await this.broadcastRoom.localParticipant.setMicrophoneEnabled(screenMicOn, { deviceId: micSel.value || undefined }).catch(() => (screenMicOn = !screenMicOn)) // fail soft: revert if permission denied
      micToggle.disabled = false
      micToggle.textContent = screenMicOn ? 'mic on' : 'mic muted'
      micToggle.style.color = screenMicOn ? '#f5f5f0' : '#888'
    }

    // Name row only for guests on /live/ links.
    const guestToken = isGuest ? guestPassToken() : null
    let guestNameInput: HTMLInputElement | null = null
    let identityRow: HTMLDivElement | null = null
    if (isGuest && guestToken) {
      identityRow = document.createElement('div')
      Object.assign(identityRow.style, { display: 'flex', flexDirection: 'column', gap: '4px' })
      const identityLabel = document.createElement('label')
      identityLabel.textContent = 'Name'
      const nameInput = document.createElement('input')
      guestNameInput = nameInput
      nameInput.type = 'text'
      nameInput.value = app.state.name ?? ''
      nameInput.placeholder = 'e.g. DJ ANON'
      nameInput.maxLength = 64
      Object.assign(nameInput.style, {
        width: '100%',
        background: '#1a1a1a',
        color: '#f5f5f0',
        border: '1px solid #333',
        padding: '8px',
        fontFamily: 'inherit',
        minHeight: mobile ? '44px' : '36px',
        fontSize: mobile ? '16px' : 'inherit',
        boxSizing: 'border-box',
      })
      const nameStatus = document.createElement('small')
      nameStatus.style.color = '#888'
      let saveTimer: ReturnType<typeof setTimeout> | null = null
      const save = async (reconnectMp = false) => {
        const next = nameInput.value.trim()
        if (!next || next === app.state.name) return
        nameStatus.textContent = 'saving...'
        try {
          const r = await fetch(`/api/guest/${guestToken}/name`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: next }),
          })
          const j = await r.json()
          if (!j.success) throw new Error(j.error || 'failed')
          if (reconnectMp) syncGuestDisplayName(next)
          else app.setName(next)
          nameStatus.textContent = 'saved'
          setTimeout(() => (nameStatus.textContent = ''), 1500)
        } catch (e) {
          nameStatus.textContent = (e as Error)?.message || 'could not save'
        }
      }
      nameInput.oninput = () => {
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => save(false), 600)
      }
      nameInput.onblur = () => save(true)
      identityRow.append(identityLabel, nameInput, nameStatus)
    }

    // Fan coords link - audience spawns back from the screen, slightly off center.
    let shareRow: HTMLDivElement | null = null
    {
      const showUrl = audienceShowUrl(this)
      shareRow = document.createElement('div')
      Object.assign(shareRow.style, { display: 'none', flexDirection: 'column', gap: '4px', borderTop: '1px solid #222', borderBottom: '1px solid #222', padding: '8px 0' })
      const shareLabel = document.createElement('label')
      shareLabel.textContent = mobile ? 'fan link' : 'fan link - share with your audience'
      shareLabel.style.color = '#888'
      const shareInput = document.createElement('input')
      shareInput.type = 'text'
      shareInput.readOnly = true
      shareInput.value = showUrl
      Object.assign(shareInput.style, { width: '100%', boxSizing: 'border-box', background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: '8px', fontFamily: 'inherit', minHeight: '36px' })
      shareInput.onclick = () => shareInput.select()
      const shareBtnRow = document.createElement('div')
      Object.assign(shareBtnRow.style, { display: 'flex', gap: '0.5rem' })
      const copyBtn = document.createElement('button')
      copyBtn.textContent = 'copy'
      Object.assign(copyBtn.style, { background: '#333', color: '#f5f5f0', border: '0', padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', flex: '1', minHeight: '36px' })
      const copyBtnLabel = mobile ? 'copy link for fans' : 'copy'
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(showUrl).catch(() => {})
        copyBtn.textContent = 'copied'
        setTimeout(() => (copyBtn.textContent = copyBtnLabel), 1500)
      }
      const xBtn = document.createElement('button')
      xBtn.textContent = 'post on x'
      Object.assign(xBtn.style, { background: '#333', color: '#f5f5f0', border: '0', padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', flex: '1', minHeight: '36px' })
      xBtn.onclick = () => {
        const text = `Going live in voxels - Teleport in! ${showUrl}`
        window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
      }
      shareBtnRow.append(copyBtn, xBtn)
      shareLabel.style.display = 'block'
      if (mobile) {
        shareRow.append(shareLabel, shareBtnRow)
        shareBtnRow.style.flexDirection = 'column'
        copyBtn.textContent = 'copy link for fans'
        Object.assign(copyBtn.style, { background: '#dc1e1e', fontWeight: 'bold', width: '100%', minHeight: '44px' })
        Object.assign(xBtn.style, { width: '100%', minHeight: '44px' })
      } else {
        shareRow.append(shareLabel, shareInput, shareBtnRow)
      }
    }

    // quick-access dance + emoji reactions. Hidden until live - pre-stream they just add noise,
    // mid-stream they are the main way to react to chat without leaving the dock.
    const moveRow = document.createElement('div')
    Object.assign(moveRow.style, { display: 'none', flexDirection: 'column', gap: '4px' })
    const danceRow = document.createElement('div')
    Object.assign(danceRow.style, { display: 'flex', gap: '4px', flexWrap: 'wrap' })
    const playMove = (anim: Animations | null) => {
      const persona = window.persona
      const controls = window.connector?.controls
      if (!persona || !controls) return
      persona.popState(controls)
      if (anim) persona.setState({ state: new EmoteAnimation(anim) }, controls)
      else persona.setState({ state: new Idle() }, controls)
    }
    DOCK_DANCES.forEach((d) => {
      const b = document.createElement('button')
      b.textContent = d.label
      Object.assign(b.style, { background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit', flex: '1', minWidth: '60px', minHeight: '36px' })
      b.onclick = () => playMove(d.anim)
      danceRow.appendChild(b)
    })
    const stopMoveBtn = document.createElement('button')
    stopMoveBtn.textContent = 'idle'
    Object.assign(stopMoveBtn.style, { background: '#1a1a1a', color: '#888', border: '1px solid #333', padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit', flex: '1', minWidth: '60px', minHeight: '36px' })
    stopMoveBtn.onclick = () => playMove(null)
    danceRow.appendChild(stopMoveBtn)

    const emojiRow = document.createElement('div')
    Object.assign(emojiRow.style, { display: 'flex', gap: '4px', flexWrap: 'wrap' })
    DOCK_EMOJIS.forEach((e) => {
      const b = document.createElement('button')
      b.textContent = e
      Object.assign(b.style, { background: '#1a1a1a', border: '1px solid #333', padding: '6px 8px', cursor: 'pointer', fontFamily: 'inherit', flex: '1', fontSize: '18px', minWidth: '40px', minHeight: '36px' })
      b.onclick = () => window.connector?.emote(e)
      emojiRow.appendChild(b)
    })
    moveRow.append(danceRow, emojiRow)

    const status = document.createElement('div')
    status.style.color = '#888'

    const goBtn = document.createElement('button')
    goBtn.type = 'button'
    goBtn.textContent = 'go live'
    Object.assign(goBtn.style, { background: '#dc1e1e', color: '#f5f5f0', border: '0', padding: '12px 16px', cursor: 'pointer', fontFamily: 'inherit', flex: '2', minHeight: '44px', fontWeight: 'bold' })

    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.gap = '0.5rem'
    row.append(goBtn)

    // setup-only escape hatch: close the dialog without going live. hidden once streaming.
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = 'cancel'
    Object.assign(cancelBtn.style, { background: 'transparent', color: '#888', border: '0', padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: mobile ? '14px' : '12px', textDecoration: 'underline', flexShrink: '0' })
    cancelBtn.onclick = () => {
      this.broadcastPanel?.remove()
      this.broadcastPanel = null
    }

    // Mobile chat lives in the dock when live - bottom sheet covers world chat. Desktop uses normal chat.
    let chatSection: HTMLDivElement | null = null
    let chatRow: HTMLDivElement | null = null
    let chatReplyRow: HTMLDivElement | null = null
    let dockFooter: HTMLDivElement | null = null
    let renderDockChat: (() => void) | null = null
    if (mobile) {
      const chatLabel = document.createElement('label')
      chatLabel.textContent = 'chat'
      chatSection = document.createElement('div')
      Object.assign(chatSection.style, {
        flex: '1 1 0',
        minHeight: '0',
        overflowY: 'auto',
        background: '#1a1a1a',
        border: '1px solid #333',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontSize: '14px',
        lineHeight: '1.4',
      })
      const chatMessages = document.createElement('div')
      Object.assign(chatMessages.style, { display: 'flex', flexDirection: 'column', gap: '4px' })
      chatSection.append(chatMessages)

      const chatLineName = (m: ChatMessageRecord) => {
        if (m.avatarRef) return avatarName(m.avatarRef)
        const avatar = m.avatar ? window.connector?.findAvatar(m.avatar) : null
        return avatar?.name || 'anon'
      }

      renderDockChat = () => {
        chatMessages.replaceChildren()
        const msgs = messageList.value.slice(-30)
        if (!msgs.length) {
          const empty = document.createElement('div')
          empty.style.color = '#888'
          empty.textContent = 'audience chat shows up here'
          chatMessages.append(empty)
          return
        }
        for (const m of msgs) {
          const line = document.createElement('div')
          const who = document.createElement('span')
          who.style.color = '#f5b942'
          who.style.fontWeight = 'bold'
          who.textContent = chatLineName(m) + ': '
          const body = document.createElement('span')
          body.textContent = m.text
          line.append(who, body)
          chatMessages.append(line)
        }
        requestAnimationFrame(() => {
          chatSection!.scrollTop = chatSection!.scrollHeight
        })
      }

      this.broadcastChatDispose = effect(() => {
        messageList.value
        renderDockChat?.()
      })

      chatReplyRow = document.createElement('div')
      Object.assign(chatReplyRow.style, { display: 'flex', gap: '0.5rem' })
      const chatInput = document.createElement('input')
      chatInput.type = 'text'
      chatInput.placeholder = 'reply to chat'
      Object.assign(chatInput.style, {
        flex: '1',
        background: '#1a1a1a',
        color: '#f5f5f0',
        border: '1px solid #666',
        padding: '10px 8px',
        fontFamily: 'inherit',
        fontSize: '16px',
        minHeight: '44px',
      })
      const chatSend = document.createElement('button')
      chatSend.textContent = 'send'
      Object.assign(chatSend.style, {
        background: '#333',
        color: '#f5f5f0',
        border: '0',
        padding: '10px 14px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        minHeight: '44px',
        flexShrink: '0',
      })
      const sendDockChat = () => {
        const t = chatInput.value.trim()
        if (!t) return
        window.connector?.sendMessage(t)
        chatInput.value = ''
        chatInput.blur()
      }
      chatSend.onclick = sendDockChat
      chatInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          sendDockChat()
        }
      }
      chatReplyRow.append(chatInput, chatSend)
      chatReplyRow.style.display = 'none'
      Object.assign(chatReplyRow.style, {
        flexShrink: '0',
        paddingTop: '6px',
        borderTop: '1px solid #333',
      })

      chatRow = document.createElement('div')
      Object.assign(chatRow.style, {
        display: 'none',
        flexDirection: 'column',
        gap: '4px',
        flex: '1 1 0',
        minHeight: '0',
        overflow: 'hidden',
      })
      chatRow.append(chatLabel, chatSection, chatReplyRow)

      dockFooter = document.createElement('div')
      Object.assign(dockFooter.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        flexShrink: '0',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
      })
      if (shareRow) dockFooter.append(shareRow)
      dockFooter.append(row)

      const mobileKids: Node[] = [title]
      if (identityRow) mobileKids.push(identityRow)
      mobileKids.push(deviceRow, screenOpt, screenHint, deviceToggle, flipBtn, micToggle, chatRow, dockFooter!, mobileExtrasBtn!, moveRow, status, cancelBtn)
      panel.append(...mobileKids)
    } else {
      const desktopKids: Node[] = [title]
      if (identityRow) desktopKids.push(identityRow)
      desktopKids.push(deviceRow, screenOpt, screenHint, deviceToggle, micToggle)
      if (shareRow) desktopKids.push(shareRow)
      desktopKids.push(moveRow, status, row, cancelBtn)
      panel.append(...desktopKids)
    }
    document.body.appendChild(panel)

    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const cams = devices.filter((d) => d.kind === 'videoinput')
      const mics = devices.filter((d) => d.kind === 'audioinput')
      cams.forEach((d, i) => {
        const opt = document.createElement('option')
        opt.value = d.deviceId
        opt.textContent = d.label || `camera ${i + 1}`
        camSel.appendChild(opt)
      })
      mics.forEach((d, i) => {
        const opt = document.createElement('option')
        opt.value = d.deviceId
        opt.textContent = d.label || `mic ${i + 1}`
        micSel.appendChild(opt)
      })
    })

    // Live track refs + audio meter rewiring. Both updated on initial publish and on mid-stream device swap.
    let liveVideoTrack: any = null
    let liveAudioTrack: any = null
    let acquiredTracks: any[] | null = null
    let meterFillEl: HTMLDivElement | null = null
    const wireAudioMeter = (mst: MediaStreamTrack | undefined | null) => {
      if (this.audioMeterRaf) {
        cancelAnimationFrame(this.audioMeterRaf)
        this.audioMeterRaf = null
      }
      if (this.audioMeterCtx) {
        this.audioMeterCtx.close().catch(() => {})
        this.audioMeterCtx = null
      }
      if (!mst || !meterFillEl) return
      try {
        const ctx = new AudioContext()
        this.audioMeterCtx = ctx
        const source = ctx.createMediaStreamSource(new MediaStream([mst]))
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          if (!meterFillEl) return
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128
            sum += v * v
          }
          const pct = Math.min(100, Math.sqrt(sum / data.length) * 200)
          meterFillEl.style.width = pct + '%'
          meterFillEl.style.background = pct > 85 ? '#dc1e1e' : pct > 60 ? '#f5b942' : '#22c55e'
          this.audioMeterRaf = requestAnimationFrame(tick)
        }
        tick()
      } catch {}
    }

    // Mid-stream device swaps via livekit setDeviceId - swaps underlying MediaStreamTrack on the existing publication, no renegotiate.
    // exact: a plain string is only an "ideal" hint, so the browser silently keeps the current cam; force the picked one.
    camSel.onchange = async () => {
      if (this.broadcastRoom && liveVideoTrack && camSel.value) {
        await liveVideoTrack.setDeviceId({ exact: camSel.value }).catch(() => {})
      }
    }
    micSel.onchange = async () => {
      if (this.broadcastRoom && liveAudioTrack && micSel.value) {
        await liveAudioTrack.setDeviceId({ exact: micSel.value }).catch(() => {})
        wireAudioMeter(liveAudioTrack.mediaStreamTrack)
      }
    }

    goBtn.onclick = async () => {
      if (this.broadcastRoom) {
        // stopping ends the show - close the dock entirely instead of bouncing back to the go-live form
        this.stopBroadcast()
        this.broadcastPanel?.remove()
        this.broadcastPanel = null
        this.setPreview()
        return
      }

      // A showbox sticking out past the parcel only streams to people standing inside the parcel
      // (viewers connect on parcel-enter, not by proximity to the screen), and it still shows on the
      // homepage. Keep it honest: refuse to go live unless the whole screen is within parcel bounds.
      if (!this.withinBounds) {
        app.showSnackbar('move the showbox inside your parcel to go live', PanelType.Warning)
        return
      }

      if (isGuest) {
        const nextName = guestNameInput?.value.trim() || app.state.name?.trim() || ''
        if (!nextName) {
          status.textContent = 'pick a name first'
          return
        }
        if (guestToken && nextName !== app.state.name) {
          status.textContent = 'saving name...'
          try {
            const r = await fetch(`/api/guest/${guestToken}/name`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ name: nextName }),
            })
            const j = await r.json()
            if (!j.success) throw new Error(j.error || 'failed')
            syncGuestDisplayName(nextName)
          } catch (e) {
            status.textContent = (e as Error)?.message || 'could not save name'
            return
          }
        } else if (guestToken) {
          syncGuestDisplayName(nextName)
        }
      }

      status.textContent = 'connecting...'
      goBtn.disabled = true
      this.viewerConnectGen++
      if (!this.isCohostMode() && this.livekitRoom) {
        this.livekitRoom.disconnect()
        this.livekitRoom = null
      }

      try {
        const tokenRes = await fetch(`/api/rooms/${this.roomName()}/token`, { credentials: 'include' })
        const res = await tokenRes.json().catch(() => null)
        if (!tokenRes.ok || !res?.token) {
          throw new Error(res?.error || 'could not get stream token - sign in again')
        }
        if (res.canPublish === false) {
          throw new Error('no permission to broadcast here - sign in as parcel owner or use a guest link')
        }

        // Acquire camera/screenshare BEFORE going live: the permission prompt can sit open for a while,
        // and we don't want the audience staring at "connecting..." for a stream that may never start.
        // Nothing is connected or flagged live yet, so a denial/cancel needs no teardown.
        let tracks: any[]
        try {
          if (screenChk.checked) {
            tracks = await createLocalScreenTracks({ audio: true })
          } else {
            tracks = await createLocalTracks({
              // exact: a plain string deviceId is only a preference, so 3-cam setups grab the wrong camera. Force the pick.
              video: { deviceId: camSel.value ? { exact: camSel.value } : undefined },
              audio: { deviceId: micSel.value ? { exact: micSel.value } : undefined },
            })
          }
        } catch (err) {
          // empty message = silent reset (user cancelled the screenshare picker). camera errors get a plain-language nudge.
          throw new Error(screenChk.checked ? '' : cameraErrorMessage(err))
        }
        acquiredTracks = tracks

        const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video)
        if (!videoTrack) {
          throw new Error('showbox needs a camera or screenshare. for audio only, drop a Boombox instead.')
        }

        const room = new Room()
        this.broadcastRoom = room
        room.on(RoomEvent.Disconnected, () => {
          if (!this.broadcastRoom) return
          status.textContent = 'disconnected'
          this.stopBroadcast()
        })

        // Hear the co-host ASAP. broadcastRoom is set first so their audio routes straight to a
        // monitor. If we were already watching them, flip that (spatial) audience audio to a
        // monitor now; otherwise connect the viewer room in parallel with our broadcast connect so
        // their audio lands with their video instead of seconds later.
        let viewerConnect: Promise<void> = Promise.resolve()
        if (this.isCohostMode()) {
          this.cohostLiveSince = Date.now()
          if (this.livekitRoom) {
            for (const audioEl of this.streamAudioEls) audioEl.remove()
            this.stopStreamVolumePoll()
            this.syncExistingCohostAudio()
          } else {
            this.setCohostConnecting()
            setTimeout(() => this.updateCohostComposite(), COHOST_CONNECT_GRACE_MS)
            viewerConnect = this.connectViewer()
          }
        }

        await room.connect(LIVEKIT_URL, res.token)
        this.parcel.sendStatePatch({ [this.uuid]: { live: 1 }, __showbox_live: this.uuid })

        for (const t of tracks) {
          await room.localParticipant.publishTrack(t)
        }

        // mirror showboxes can't subscribe to our own feed (same client) - have them read it locally now
        this.parcel.getFeaturesByType('showbox').forEach((f) => (f as any).refreshMirrorVideo?.())

        if (!tracks.some((t) => t.kind === Track.Kind.Audio)) {
          status.textContent = 'live but no mic - check browser permissions'
        }

        liveVideoTrack = videoTrack
        liveAudioTrack = tracks.find((t) => t.kind === Track.Kind.Audio) ?? null
        if (videoTrack) {
          const el = videoTrack.attach() as HTMLVideoElement
          if (this.isCohostMode()) {
            await viewerConnect
            this.wireLocalCohostVideo(el)
            this.syncExistingCohostVideos()
            this.updateCohostComposite()
            this.startThumbCapture()
          } else {
            this.localBroadcastVideoEl = el
            this.attachVideoToMesh(el, true)
            this.startThumbCapture(el)
          }
        }

        this.audio?.addUserAudioReference(this)

        goBtn.textContent = 'stop streaming'
        goBtn.style.background = '#444'
        goBtn.disabled = false
        status.textContent = ''
        ;[title, screenOpt, status, cancelBtn].forEach((el) => ((el as HTMLElement).style.display = 'none'))
        if (identityRow) identityRow.style.display = 'none'
        deviceRow.style.display = 'none'
        // screensharing has no camera and the mic is handled by the mic toggle below - hide the device picker
        deviceToggle.style.display = screenChk.checked ? 'none' : 'block'
        deviceToggle.textContent = 'change camera or mic'
        if (screenChk.checked) {
          screenMicOn = false
          micToggle.textContent = 'turn on mic'
          micToggle.style.color = '#888'
          micToggle.style.display = 'block'
        }
        if (mobile) {
          mobileExtrasOpen = false
          if (shareRow) shareRow.style.display = 'flex'
          moveRow.style.display = 'none'
          if (mobileExtrasBtn) mobileExtrasBtn.style.display = 'block'
          if (!screenChk.checked) flipBtn.style.display = 'block'
        } else {
          if (shareRow) shareRow.style.display = 'flex'
          moveRow.style.display = 'flex'
        }
        if (chatRow) chatRow.style.display = 'flex'
        if (chatReplyRow) chatReplyRow.style.display = 'flex'
        mobileShowWorld = false

        // live header: pulsing red dot + count-up timer so the broadcaster sees they are actually streaming.
        const liveHeader = document.createElement('div')
        liveHeader.dataset.dot = '1'
        Object.assign(liveHeader.style, { display: 'flex', alignItems: 'center', gap: '8px', color: '#dc1e1e', fontWeight: 'bold', fontSize: '14px', letterSpacing: '0.5px' })
        const liveDot = document.createElement('span')
        liveDot.textContent = '\u25CF'
        Object.assign(liveDot.style, { animation: 'showbox-live-pulse 1.2s ease-in-out infinite' })
        const liveLabel = document.createElement('span')
        liveLabel.textContent = 'live'
        const liveTimer = document.createElement('span')
        Object.assign(liveTimer.style, { color: '#f5f5f0', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' })
        liveTimer.textContent = '0:00'
        liveHeader.append(liveDot, liveLabel)
        if (mobileWorldBtn) liveHeader.append(mobileWorldBtn)
        liveHeader.append(liveTimer)

        // Desktop minimize: collapse the dock to a live pill so broadcasters can read chat without killing the stream.
        // Mobile already has "see world" for this, so desktop only.
        if (!mobile) {
          let minimized = false
          const minBtn = document.createElement('button')
          minBtn.type = 'button'
          minBtn.textContent = '-'
          minBtn.title = 'minimize'
          Object.assign(minBtn.style, { background: 'transparent', color: '#f5f5f0', border: '0', padding: '0 4px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '18px', lineHeight: '1', flexShrink: '0' })
          minBtn.onclick = (e) => {
            e.stopPropagation()
            minimized = !minimized
            for (const child of Array.from(panel.children)) {
              if (child === liveHeader) continue
              const el = child as HTMLElement
              if (minimized) {
                el.dataset.prevDisplay = el.style.display
                el.style.display = 'none'
              } else {
                el.style.display = el.dataset.prevDisplay ?? ''
              }
            }
            if (minimized) {
              panel.style.width = 'auto'
              panel.style.maxHeight = 'none'
              panel.style.boxShadow = 'none'
              panel.style.padding = '6px 10px'
            } else {
              panel.style.padding = '1rem'
              panel.style.boxShadow = '0 4px 24px rgba(0,0,0,0.6)'
              setDesktopDockLayout(true)
            }
            minBtn.textContent = minimized ? '+' : '-'
            minBtn.title = minimized ? 'expand' : 'minimize'
          }
          liveHeader.append(minBtn)
        }

        if (!document.getElementById('showbox-live-pulse-style')) {
          const styleEl = document.createElement('style')
          styleEl.id = 'showbox-live-pulse-style'
          styleEl.textContent = '@keyframes showbox-live-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }'
          document.head.appendChild(styleEl)
        }

        this.liveStartedAt = Date.now()
        this.liveTimerInterval = setInterval(() => {
          if (!this.liveStartedAt) return
          const s = Math.floor((Date.now() - this.liveStartedAt) / 1000)
          const m = Math.floor(s / 60)
          const r = s % 60
          liveTimer.textContent = `${m}:${r.toString().padStart(2, '0')}`
        }, 1000)

        panel.insertBefore(liveHeader, panel.firstChild)

        if (videoTrack) {
          const meterTrack = document.createElement('div')
          Object.assign(meterTrack.style, { height: '5px', background: 'rgba(0,0,0,0.5)', flexShrink: '0' })
          const meterFill = document.createElement('div')
          Object.assign(meterFill.style, { width: '0%', height: '100%', background: '#22c55e', transition: 'width 60ms linear' })
          meterTrack.append(meterFill)
          meterFillEl = meterFill

          if (!mobile) {
            const previewWrap = document.createElement('div')
            previewWrap.dataset.dot = '1'
            Object.assign(previewWrap.style, {
              position: 'relative',
              width: '100%',
              aspectRatio: '16 / 9',
              background: '#000',
              overflow: 'hidden',
            })
            const previewVideo = this.isCohostMode() ? this.mountCohostPreviewVideo('cover') : (videoTrack.attach() as HTMLVideoElement)
            if (!this.isCohostMode()) {
              previewVideo.muted = true
              previewVideo.volume = 0
              previewVideo.playsInline = true
              Object.assign(previewVideo.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' })
            }
            const previewLabel = document.createElement('div')
            previewLabel.textContent = 'what your audience sees'
            Object.assign(previewLabel.style, { position: 'absolute', top: '4px', left: '6px', color: '#f5f5f0', fontSize: '11px', background: 'rgba(0,0,0,0.6)', padding: '2px 6px' })
            Object.assign(meterTrack.style, { position: 'absolute', bottom: '0', left: '0', right: '0' })
            previewWrap.append(previewVideo, previewLabel, meterTrack)
            panel.insertBefore(previewWrap, chatRow ?? moveRow)
            previewWrap.insertAdjacentElement('afterend', deviceToggle)
          } else {
            mobilePreviewWrap = document.createElement('div')
            mobilePreviewWrap.dataset.dot = '1'
            Object.assign(mobilePreviewWrap.style, {
              position: 'relative',
              width: '100%',
              aspectRatio: '9 / 16',
              maxHeight: '28vh',
              flexShrink: '0',
              background: '#000',
              overflow: 'hidden',
            })
            const previewVideo = this.isCohostMode() ? this.mountCohostPreviewVideo('contain') : (videoTrack.attach() as HTMLVideoElement)
            if (!this.isCohostMode()) {
              previewVideo.muted = true
              previewVideo.volume = 0
              previewVideo.playsInline = true
              Object.assign(previewVideo.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block' })
            }
            const previewLabel = document.createElement('div')
            previewLabel.textContent = 'what your audience sees'
            Object.assign(previewLabel.style, { position: 'absolute', top: '4px', left: '6px', color: '#f5f5f0', fontSize: '11px', background: 'rgba(0,0,0,0.6)', padding: '2px 6px' })
            Object.assign(meterTrack.style, { position: 'absolute', bottom: '0', left: '0', right: '0' })
            mobilePreviewWrap.append(previewVideo, previewLabel, meterTrack)
            panel.insertBefore(mobilePreviewWrap, chatRow ?? moveRow)
            mobilePreviewWrap.insertAdjacentElement('afterend', deviceToggle)

            mobileStreamHint = document.createElement('div')
            mobileStreamHint.dataset.dot = '1'
            mobileStreamHint.textContent = 'your stream is on the showbox above'
            Object.assign(mobileStreamHint.style, { display: 'none', color: '#888', fontSize: '12px', flexShrink: '0' })
            panel.insertBefore(mobileStreamHint, chatRow ?? moveRow)
          }

          if (this.isCohostMode()) this.updateCohostComposite()

          const audioMst = (liveAudioTrack as any)?.mediaStreamTrack as MediaStreamTrack | undefined
          if (audioMst) wireAudioMeter(audioMst)
          else meterTrack.remove()
        }

        setMobileDockLayout(true)
        setDesktopDockLayout(true)
        renderDockChat?.()
        this.announceLiveInChat()
        this.startMilestonePoll()
      } catch (e) {
        status.textContent = e instanceof Error ? e.message : 'failed to connect'
        goBtn.disabled = false
        this.broadcastRoom?.disconnect()
        this.broadcastRoom = null
        for (const t of acquiredTracks ?? []) {
          try {
            t.stop()
          } catch {}
        }
        if (this.activeLiveShowboxUuid() === this.uuid) {
          try {
            this.parcel.sendStatePatch({ [this.uuid]: {}, __showbox_live: null })
          } catch {}
        }
      }
    }
  }

  onClick() {
    if (this.isAngleMirror()) {
      if (this.canBroadcastAngle()) this.openAnglePanel()
      else this.unblockAudiencePlayback()
      return
    }
    if (this.isMirror()) return
    if (!this.broadcastRoom) {
      const guest = isGuestForShowbox(this.uuid)
      if (this.isCohostMode()) {
        if (guest || this.parcel.canEdit) {
          this.openBroadcastPanel()
        } else {
          this.unblockAudiencePlayback()
        }
      } else if (!this.hasRemoteBroadcaster() && (guest || this.parcel.canEdit)) {
        this.openBroadcastPanel()
      } else {
        this.unblockAudiencePlayback()
      }
    }
    this.parcelScript?.dispatch('click', this, {})
  }
}

class Editor extends FeatureEditor<Showbox> {
  constructor(props: FeatureEditorProps<Showbox>) {
    super(props)
    this.state = {
      id: props.feature.description.id,
      rolloffFactor: props.feature.rolloffFactor,
      volume: props.feature.volume,
      guestMode: props.feature.guestMode === 'cohost' ? 'cohost' : 'solo',
      mirrorSource: props.feature.mirrorSource,
      angleMode: !!props.feature.description.angleMode,
    }
  }

  componentDidUpdate() {
    this.merge({
      rolloffFactor: this.state.rolloffFactor,
      volume: this.state.volume,
      guestMode: this.state.guestMode,
      mirrorSource: this.state.mirrorSource,
      angleMode: this.state.angleMode,
    })
  }

  render() {
    const isMirror = this.props.feature.isMirror()
    return (
      <section>
        <header>
          <h2>Edit Showbox</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={this.props.feature} scene={this.props.scene} />
          <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
          <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
          <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />
          {isMirror ? (
            <div className="f">
              <label>
                <input type="checkbox" checked={this.state.angleMode} onChange={(e) => this.setState({ angleMode: e.currentTarget.checked })} /> second camera angle
              </label>
              <small>A dedicated screen for a second camera, no audio. Walk up to it in-world and click to broadcast your camera straight to this screen.</small>
              {!this.state.angleMode && (
                <div className="f">
                  <label>Mirror source</label>
                  <select value={this.state.mirrorSource} onChange={(e) => this.setState({ mirrorSource: e.currentTarget.value as MirrorSource })}>
                    <option value="auto">whoever is live</option>
                    <option value="host">host (parcel owner)</option>
                    <option value="collaborator">collaborator</option>
                    <option value="guest">guest</option>
                  </select>
                  <small>Mirrors the first showbox video with no audio. Falls back to whoever is live if your pick isn't streaming. Manage the stream and guest links on the first showbox.</small>
                </div>
              )}
            </div>
          ) : (
            <GuestPasses feature={this.props.feature} guestMode={this.state.guestMode} onGuestModeChange={(guestMode) => this.setState({ guestMode })} />
          )}
          <Advanced>
            <FeatureID feature={this.props.feature} />
            <SetParentDropdown feature={this.props.feature} />
            {!isMirror && (
              <div className="f">
                <label>Spatial Rolloff Factor</label>
                <input type="range" step="0.1" min="0" max="5" value={this.state.rolloffFactor} onChange={(e) => this.setState({ rolloffFactor: parseFloat(e.currentTarget.value) })} />
                <small>0 = heard everywhere in the parcel. Higher = fades as you walk away from the screen.</small>
              </div>
            )}
            {!isMirror && (
              <div className="f">
                <label>Volume</label>
                <input type="range" step="0.01" min="0" max={MAX_VOLUME} value={this.state.volume} onChange={(e) => this.setState({ volume: parseFloat(e.currentTarget.value) })} />
              </div>
            )}
            <UuidReadOnly feature={this.props.feature} />
            <Script feature={this.props.feature} />
          </Advanced>
        </div>
      </section>
    )
  }
}

Showbox.Editor = Editor

// Owner-facing panel inside the Showbox editor. Create/list/revoke guest pass links
// that let an invited broadcaster (artist, speaker, DJ) go live on this showbox without an account.
type Pass = { token: string; parcel_id: number; feature_uuid: string; name: string; created_at: string; revoked_at: string | null }

class GuestPasses extends Component<{ feature: Showbox; guestMode: GuestMode; onGuestModeChange: (mode: GuestMode) => void }, { passes: Pass[]; loading: boolean; creating: boolean; error: string | null }> {
  state = { passes: [] as Pass[], loading: true, creating: false, error: null as string | null }
  linkListRef: HTMLDivElement | null = null
  refreshGen = 0

  componentDidMount() {
    this.refresh()
  }

  parcelId() {
    return this.props.feature.parcel.id
  }

  featureUuid() {
    return this.props.feature.uuid
  }

  passActive(p: Pass) {
    return !p.revoked_at
  }

  applyPass(pass: Pass) {
    this.setState((s) => ({
      passes: [pass, ...s.passes.filter((p) => p.token !== pass.token)],
    }))
  }

  passesUrl() {
    return `/api/parcels/${this.parcelId()}/guest-passes?feature_uuid=${encodeURIComponent(this.featureUuid())}`
  }

  canManagePasses() {
    const w = app.state.wallet?.toLowerCase()
    if (!w) return false
    if (app.isAdmin()) return true
    return this.props.feature.parcel.owners.some((o) => o?.toLowerCase() === w)
  }

  async refresh() {
    const gen = ++this.refreshGen
    try {
      const r = await fetch(this.passesUrl(), { credentials: 'include', cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (gen !== this.refreshGen) return false
      if (!r.ok || !j.success) {
        this.setState({ error: j.error || 'could not load guest links', loading: false })
        return false
      }
      this.setState({ passes: j.passes ?? [], loading: false, error: null })
      if (!(j.passes ?? []).some((p: Pass) => !p.revoked_at)) {
        this.props.onGuestModeChange(DEFAULT_GUEST_MODE)
      }
      return true
    } catch {
      if (gen !== this.refreshGen) return false
      this.setState({ loading: false, error: 'could not load guest links' })
      return false
    }
  }

  async create() {
    if (!this.canManagePasses()) {
      this.setState({ error: 'only the parcel owner can create guest links' })
      return
    }
    if (this.state.passes.some((p) => this.passActive(p))) {
      this.setState({ error: 'revoke the existing link first' })
      return
    }
    this.refreshGen++
    this.setState({ creating: true, error: null })
    try {
      const r = await fetch(`/api/parcels/${this.parcelId()}/guest-passes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ feature_uuid: this.featureUuid() }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.success) throw new Error(j.error || 'Could not create link')
      const pass = j.pass as Pass | undefined
      if (!pass?.token) throw new Error('Could not create link')
      const url = this.liveUrl(pass.token)
      this.copy(url, 'guest link created (copied)')
      this.applyPass(pass)
      requestAnimationFrame(() => this.linkListRef?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
    } catch (e: any) {
      const msg = e?.message ?? 'Could not create link'
      if (String(msg).toLowerCase().includes('revoke')) {
        await this.refresh()
        this.setState({ error: 'a guest link is still active on the server -- revoke it below or refresh the page' })
      } else {
        this.setState({ error: msg })
      }
    } finally {
      this.setState({ creating: false })
    }
  }

  async revoke(token: string) {
    if (!this.canManagePasses()) {
      this.setState({ error: 'only the parcel owner can revoke guest links' })
      return
    }
    if (!confirm('Revoke this link? They will be kicked if currently live.')) return
    this.refreshGen++
    this.setState({ error: null })
    try {
      const r = await fetch(`/api/parcels/${this.parcelId()}/guest-passes/${encodeURIComponent(token)}`, {
        method: 'DELETE',
        credentials: 'include',
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.success) throw new Error(j.error || 'could not revoke link')
      const passes = (j.passes as Pass[] | undefined) ?? (j.pass ? [j.pass as Pass] : [])
      const revoked = passes.filter((p) => p?.revoked_at)
      if (!revoked.length) throw new Error('could not revoke link')
      this.setState((s) => ({
        passes: [...revoked, ...s.passes.filter((p) => !revoked.some((r) => r.token === p.token))],
      }))
      this.props.onGuestModeChange(DEFAULT_GUEST_MODE)
      app.showSnackbar('guest link revoked', PanelType.Success)
    } catch (e: any) {
      this.setState({ error: e?.message ?? 'could not revoke link' })
      await this.refresh()
    }
  }

  copy(text: string, snackbar = 'link copied') {
    navigator.clipboard.writeText(text).catch(() => {})
    app.showSnackbar(snackbar, PanelType.Success)
  }

  liveUrl(token: string) {
    return `${window.location.origin}/live/${token}`
  }

  hostJoinUrl() {
    return hostJoinShowUrl(this.props.feature)
  }

  render() {
    if (!this.props.feature.parcel.canEdit) return null
    const active = this.state.passes.filter((p) => this.passActive(p))
    const canManage = this.canManagePasses()
    const canCreate = canManage && active.length === 0

    return (
      <div className="f">
        <div className="f">
          <label>host link</label>
          <input type="text" readOnly value={this.hostJoinUrl()} onClick={(e) => (e.currentTarget as HTMLInputElement).select()} style={mobile ? { fontSize: '16px', minHeight: '44px' } : undefined} />
          <button type="button" style={mobile ? { minHeight: '44px' } : undefined} onClick={() => this.copy(this.hostJoinUrl())}>
            copy host link
          </button>
        </div>

        <label>invite a guest</label>
        <small>A link that you can give to someone to go live here without a voxels account</small>

        <div className="f">
          {canCreate ? (
            <button type="button" style={mobile ? { minHeight: '44px' } : undefined} onClick={() => this.create()} disabled={this.state.creating}>
              {this.state.creating ? 'creating...' : 'create link'}
            </button>
          ) : !canManage ? (
            <small>owner only</small>
          ) : null}
          {this.state.error && <div style={{ color: '#dc1e1e' }}>{this.state.error}</div>}
        </div>

        {this.state.loading && <small>loading...</small>}

        {active.length > 0 && (
          <div
            ref={(el) => {
              this.linkListRef = el
            }}
          >
            {active.map((p) => (
              <div key={p.token}>
                <div className="f">
                  <label>{p.name?.trim() || 'guest link'}</label>
                  <small>send to your DJ or guest only -- not the public audience link. if you open it while signed in you'll join as host instead</small>
                  <input type="text" readOnly value={this.liveUrl(p.token)} onClick={(e) => (e.currentTarget as HTMLInputElement).select()} style={mobile ? { fontSize: '16px', minHeight: '44px' } : undefined} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexDirection: mobile ? 'column' : 'row', marginBottom: '0.5rem' }}>
                  <button type="button" style={mobile ? { minHeight: '44px', width: '100%' } : undefined} onClick={() => this.copy(this.liveUrl(p.token))}>
                    copy
                  </button>
                  {canManage && (
                    <button type="button" style={mobile ? { minHeight: '44px', width: '100%' } : undefined} onClick={() => this.revoke(p.token)}>
                      revoke
                    </button>
                  )}
                </div>
                <div className="f">
                  <label>guest link mode</label>
                  <div>
                    <label>
                      <input type="radio" name="guestMode" checked={this.props.guestMode === 'solo'} onChange={() => this.props.onGuestModeChange('solo')} />
                      guest only
                    </label>
                    <small>DJ, artist, or speaker -- full screen, one stream</small>
                    <label>
                      <input type="radio" name="guestMode" checked={this.props.guestMode === 'cohost'} onChange={() => this.props.onGuestModeChange('cohost')} />
                      guest + you (co-host)
                    </label>
                    <small>split screen: you left, guest right. use headphones to reduce echo</small>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
}
