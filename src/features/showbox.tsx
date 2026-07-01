import { Component, h } from 'preact'
import Cookies from 'js-cookie'
import { decodeJwt } from 'jose'
import { isMobile, wantsAudio } from '../../common/helpers/detector'
import { holdMobileCanvasRefresh, refreshMobileCanvasAfterReturn } from '../controls/mobile/controls'
import {
  BROADCAST_CAMERA_ENDED_DELAY_MS,
  BROADCAST_CAMERA_STRIKES,
  BROADCAST_DISCONNECT_STRIKES,
  BROADCAST_HEALTH_POLL_MS,
  BROADCAST_LIVE_GRACE_MS,
  BROADCAST_RECONNECT_MAX,
  broadcastVideoTrackLive,
  fetchShowboxRoomToken,
  livekitRoomState,
  publishedVideoTrack,
  saveShowboxPublisherIdentity,
  showboxTokenUrlWithIdentity,
} from '../../common/helpers/showbox-broadcast-health'
import { showboxAudioConstraints, showboxRoomHint, SHOWBOX_ROOM_OPTIONS, type ShowboxAudioMode } from '../../common/helpers/showbox-audio-constraints'
import { VideoFxProcessor, FX_PALETTES, FX_DEFAULT_PALETTE, VIDEO_FX, type FxAudio } from '../../common/helpers/showbox-video-fx'
import ParcelHelper, { showboxAudiencePlayCoordsFromRecord, showboxFanSharePlayQuery, showboxHostPlayCoordsFromRecord, showboxHostPlayQuery } from '../../common/helpers/parcel-helper'
import { exitPointerLock } from '../../common/helpers/ui-helpers'
import { isSplit } from '../../web/src/helpers/coords-nav'
import { duckRadio, setRadioBroadcasting, unduckRadio } from '../../web/src/radio/global'
import { broadcastLiveStartedAt, broadcastShowboxUuid, closeBroadcastSidebar, uiAsideTick, uiPane } from '../store'
import { consumeGuestFreshFromUrl, maybeRefreshGuestJwt } from '../../common/helpers/guest-pass-client'
import { cohostPaneRects, MAX_COHOST_PANES } from '../../common/helpers/cohost-panes'
import { encodeCoords } from '../../common/helpers/utils'
import { ShowboxRecord } from '../../common/messages/feature'
import { effect } from '@preact/signals'
import { Room, RoomEvent, Track, createLocalScreenTracks, createLocalTracks, createLocalVideoTrack } from 'livekit-client'
import { avatarName } from '../../common/messages/avatar-ref'
import { app, AppEvent } from '../../web/src/state'
import { PanelType } from '../../web/src/components/panel'
import { messageList, type ChatMessageRecord } from '../connector'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Animations } from '../avatar-animations'
import { EmoteAnimation, Idle } from '../states'
import { cameraPosition, cameraRotation, setCameraRotation } from '../utils/camera'
import { emote as emoteParticles } from '../utils/emote'
import { AudioBus } from '../audio/audio-engine'
import { SpatialAudio } from '../audio/spatial-audio'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
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
// How long a joining co-host shows the "connecting" card while waiting for the host's video.
const COHOST_CONNECT_GRACE_MS = 8000

function viewerCountLabel(n: number) {
  return n === 1 ? '1 viewer' : `${n} viewers`
}

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
const LANDSCAPE_MESH_W = 640
const LANDSCAPE_MESH_H = 360
const PORTRAIT_MESH_W = 360
const PORTRAIT_MESH_H = 640
const THUMB_W = 256
const THUMB_H = 144
const LANDSCAPE_SCALE: [number, number, number] = [2, 1, 0]
const PORTRAIT_SCALE: [number, number, number] = [1, 16 / 9, 0]

function drawVideoCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, dx: number, dy: number, dw: number, dh: number) {
  const el = src as HTMLVideoElement
  const vw = el.videoWidth || (src as HTMLImageElement).width || 0
  const vh = el.videoHeight || (src as HTMLImageElement).height || 0
  if (!vw || !vh) return
  const scale = Math.max(dw / vw, dh / vh)
  const sw = dw / scale
  const sh = dh / scale
  const sx = (vw - sw) / 2
  const sy = (vh - sh) / 2
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh)
}

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

// Mobile: facingMode beats enumerated deviceId (first cam is often back/wide and stretches). Matches flip camera.
function showboxMobileCameraConstraints(facing: 'user' | 'environment' = 'user') {
  const c: Record<string, any> = { facingMode: facing }
  // back cameras are usually landscape - forcing 9:16 can fail restartTrack and leave a dead feed
  if (facing === 'user') c.aspectRatio = { ideal: 9 / 16 }
  return c
}

function showboxCameraVideoConstraints(deviceId: string | undefined) {
  if (mobile) return showboxMobileCameraConstraints('user')
  const c: Record<string, any> = {}
  if (deviceId) c.deviceId = { exact: deviceId }
  return c
}

// LiveKit attach() can set width/height attrs that fight object-fit; sync the preview box to real frame size.
function wireMobilePreviewVideo(wrap: HTMLElement, el: HTMLVideoElement) {
  el.removeAttribute('width')
  el.removeAttribute('height')
  Object.assign(el.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  })
  const sync = () => {
    // livekit re-adds width/height attrs after the first frame - strip again or the preview stretches
    el.removeAttribute('width')
    el.removeAttribute('height')
    const w = el.videoWidth
    const h = el.videoHeight
    if (w > 0 && h > 0) wrap.style.aspectRatio = `${w} / ${h}`
  }
  el.addEventListener('loadedmetadata', sync)
  el.addEventListener('loadeddata', sync)
  el.addEventListener('resize', sync)
  sync()
  let n = 0
  const poll = () => {
    sync()
    if (el.videoWidth > 0 || ++n > 90) return
    requestAnimationFrame(poll)
  }
  poll()
  return sync
}

function syncVideoElFromTrack(el: HTMLVideoElement | null, track: { mediaStreamTrack?: MediaStreamTrack } | null | undefined) {
  const mst = track?.mediaStreamTrack
  if (!el || !mst || mst.readyState === 'ended') return
  const cur = el.srcObject instanceof MediaStream ? el.srcObject.getVideoTracks()[0] : null
  if (cur === mst) return
  el.srcObject = new MediaStream([mst])
  el.play().catch(() => {})
}

function makeDockPreviewVideo(track: { mediaStreamTrack?: MediaStreamTrack } | null | undefined) {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.autoplay = true
  v.setAttribute('playsinline', '')
  v.setAttribute('webkit-playsinline', 'true')
  syncVideoElFromTrack(v, track)
  return v
}

// True when the page was opened via /live/:token and the guest pass targets this showbox.
// The synthetic wallet `guest:*` and `?show=<uuid>` are both set by the server on redeem.
function guestJwtPayload(): { wallet?: string; guest_pass?: string; feature_uuid?: string; parcel_id?: number } | null {
  try {
    const key = app.state.key || Cookies.get('jwt')
    if (!key) return null
    return decodeJwt(key) as { wallet?: string; guest_pass?: string; feature_uuid?: string }
  } catch {
    return null
  }
}

function showboxJoinShowUuid(): string | null {
  try {
    const show = new URL(window.location.href).searchParams.get('show')
    return show ? show.toLowerCase() : null
  } catch {
    return null
  }
}

function isSyntheticGuestWallet() {
  const w = (guestJwtPayload()?.wallet ?? app.state.wallet)?.toLowerCase()
  return !!w?.startsWith('guest:')
}

function guestPassToken(): string | null {
  const fromJwt = guestJwtPayload()?.guest_pass
  if (fromJwt) return fromJwt
  try {
    const u = new URL(window.location.href)
    const fromUrl = u.searchParams.get('guest_pass')
    if (fromUrl) {
      sessionStorage.setItem('showbox_guest_pass', fromUrl)
      return fromUrl
    }
  } catch {}
  try {
    return sessionStorage.getItem('showbox_guest_pass')
  } catch {
    return null
  }
}

function isGuestForShowbox(uuid: string): boolean {
  const showMatch = showboxJoinShowUuid() === uuid.toLowerCase()
  if (isSyntheticGuestWallet()) {
    const payload = guestJwtPayload()
    if (payload?.feature_uuid === uuid) return true
    return showMatch
  }
  if (app.signedIn && guestPassToken() && showMatch) return true
  return false
}

// guest pass is scoped to one primary showbox, but angle mirrors are sibling screens on the same parcel.
function isGuestOnParcel(parcelId: number): boolean {
  if (!guestPassToken()) return false
  const payload = guestJwtPayload()
  if (payload?.parcel_id != null) return Number(payload.parcel_id) === parcelId
  return !!showboxJoinShowUuid()
}

function showboxRoomTokenUrl(roomName: string, reusePublisher = false) {
  let base = `/api/rooms/${roomName}/token`
  const pass = guestPassToken()
  if (pass && !guestJwtPayload()?.guest_pass) {
    base = `${base}?guest_pass=${encodeURIComponent(pass)}`
  }
  return showboxTokenUrlWithIdentity(base, roomName, reusePublisher)
}

function showboxFeatureCoords(feature: Showbox) {
  const parcel = new ParcelHelper(feature.parcel as any)
  const f = { position: feature.tidyPosition, rotation: feature.tidyRotation, guestMode: feature.guestMode }
  return { parcel, f }
}

// Fan link for the share panel (copy, post on x, mobile share sheet).
function audienceShowUrl(feature: Showbox): string {
  const { parcel, f } = showboxFeatureCoords(feature)
  const coords = showboxAudiencePlayCoordsFromRecord(parcel, f)
  return `${window.location.origin}/play?${showboxFanSharePlayQuery(coords, feature.uuid)}`
}

// Owner/co-host join link. Keeps your normal login - just lands at the showbox and opens the broadcast dock.
function hostJoinShowUrl(feature: Showbox): string {
  const { parcel, f } = showboxFeatureCoords(feature)
  const coords = showboxHostPlayCoordsFromRecord(parcel, f)
  return `${window.location.origin}/play?${showboxHostPlayQuery(coords, feature.uuid, mobile)}`
}

function isHostJoinForShowbox(uuid: string): boolean {
  if (isGuestForShowbox(uuid)) return false
  try {
    const q = new URL(window.location.href).searchParams
    const show = q.get('show')
    return q.get('host') === '1' && !!show && show.toLowerCase() === uuid.toLowerCase()
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
    u.searchParams.delete('guest_pass')
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
  try {
    const boxes = (window as any).persona?.parcel?.getFeaturesByType?.('showbox') ?? []
    if (boxes.some((f: any) => f?.broadcastRoom)) return
  } catch {}
  window.connector?.reconnect()
}

type GuestMode = 'solo' | 'cohost'
type MirrorSource = 'auto' | 'host' | 'collaborator' | 'guest'
type MirrorRole = 'host' | 'collaborator' | 'guest'

const DEFAULT_GUEST_MODE: GuestMode = 'cohost'

function cohostIdentityPrefix(identity: string) {
  const i = identity.lastIndexOf('-')
  return i > 0 ? identity.slice(0, i) : identity
}

function cohostVideoReady(el: HTMLVideoElement | null) {
  return !!(el && el.readyState >= 1 && el.videoWidth > 0)
}

function cohostVideoTrackLive(el: HTMLVideoElement | null) {
  const mst = (el?.srcObject as MediaStream | null)?.getVideoTracks?.()?.[0]
  return !!mst && mst.readyState !== 'ended'
}

type ShowboxIntermission = { label: string; until: number | null; at: number }
type ShowboxCelebrateState = { celebrate?: number; at?: number; intermission?: ShowboxIntermission | null }

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
    guestMode: 'cohost',
  } as FeatureTemplate

  livekitRoom: Room | null = null
  broadcastRoom: Room | null = null
  scaleAspectLocked = true // screens keep their aspect ratio by default (editor lock + corner-resize honor this)
  broadcastPanel: HTMLDivElement | null = null
  broadcastPanelSidebar = false
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
  // one pane per publisher: the editor anchor + up to 4 guests, in arrival order.
  // 'local' is our own camera when broadcasting; remote publishers key by identity prefix.
  cohostPanes: { key: string; el: HTMLVideoElement; hadFrame: boolean; editor: boolean }[] = []
  cohostLiveSince = 0
  cohostCanvas: HTMLCanvasElement | null = null
  cohostCompositeEl: HTMLVideoElement | null = null
  cohostCompositeRaf: number | null = null
  cohostMonitorEls: HTMLAudioElement[] = []
  cohostCompositeAttached = false
  syncCohostPreview: (() => void) | null = null
  cohostCompositeRetryRaf: number | null = null
  milestonePollInterval: ReturnType<typeof setInterval> | null = null
  onViewerCountTick: ((roomTotal: number) => void) | null = null
  celebratedMilestones = new Set<number>()
  lastCelebrateAt = 0
  lastCelebrateN = 0
  viewerRoomFull = false
  viewerConnecting = false
  liveChatAnnounced = false
  walkAwayWarned = false
  broadcastLost = false
  broadcastDockLiveDot: HTMLElement | null = null
  broadcastDockLiveLabel: HTMLElement | null = null
  broadcastDockStatusEl: HTMLElement | null = null
  mobileBroadcastHooksClear: (() => void) | null = null
  mobilePreviewVideoEl: HTMLVideoElement | null = null
  syncMobilePreviewDock: (() => void) | null = null
  broadcastLiveTracks: any[] | null = null
  broadcastLiveVideoTrack: any = null
  broadcastLiveAudioTrack: any = null
  broadcastReconnectAttempts = 0
  broadcastReconnecting = false
  broadcastDisconnectStrikes = 0
  broadcastCameraLost = false
  broadcastStopping = false
  cameraHealthStrikes = 0
  cameraEndedTimer: ReturnType<typeof setTimeout> | null = null
  cameraResumeGen = 0
  broadcastCameraReconnectBtn: HTMLButtonElement | null = null
  mobileFlipFacing: 'user' | 'environment' = 'user'
  viewerConnectGen = 0
  localBroadcastVideoEl: HTMLVideoElement | null = null
  mirrorVideoIdentity: string | null = null
  // the actual track behind mirrorVideoIdentity - a reconnect delivers a new track under the
  // same identity, and comparing only the id left mirrors frozen on the dead element
  mirrorVideoTrack: any = null
  angleVideoTrack: any = null
  anglePanel: HTMLDivElement | null = null
  viewerRetryInterval: ReturnType<typeof setInterval> | null = null
  viewerReconnectAttempts = 0
  viewerReconnecting = false
  viewerDisconnectStrikes = 0
  onlineReconnectWired = false
  streamAttachRetryInterval: ReturnType<typeof setInterval> | null = null
  streamAttachAttempts = 0
  mirrorRefreshTimer: ReturnType<typeof setTimeout> | null = null
  guestJwtRefreshInterval: ReturnType<typeof setInterval> | null = null
  hostJoinLoginPending = false
  joinDockAutoOpened = false
  hostJoinAutoOpenStarted = false
  hostDockAutoOpenedAt = 0
  meshLetterboxRaf: number | null = null
  meshLetterboxCanvas: HTMLCanvasElement | null = null
  // intermission ("starting soon" / "be right back"): a raise-able animated standby card.
  // null when the show is running normally; set locally on the broadcaster and mirrored to
  // viewers over the existing ephemeral parcel-state channel (no backend).
  intermission: ShowboxIntermission | null = null
  intermissionRaf: number | null = null
  intermissionCanvas: HTMLCanvasElement | null = null
  intermissionPrevMic = false
  intermissionStatusInterval: ReturnType<typeof setInterval> | null = null
  // video FX (prototype): live audio analysis (level + bass/mid/treble + beat-punch envelope) tapped
  // from the dock meter, read by the fx processor so the visuals dance to the music; the active processor.
  fxAudio: FxAudio = { level: 0, bass: 0, mid: 0, treble: 0, punch: 0 }
  broadcastFxProcessor: VideoFxProcessor | null = null
  fxAutoTimer: ReturnType<typeof setTimeout> | null = null

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
    const primary = this.parcel.primaryShowboxUuid()
    return !!primary && primary !== this.uuid
  }

  // a mirror shows the primary showbox video (muted) whenever a stream is live on the parcel.
  // __showbox_live is ephemeral (broadcast-only, not persisted) and our own broadcast isn't a
  // remote participant on this client, so fall back to the actual room video as the source of truth.
  mirrorsActiveStream() {
    if (!this.isMirror()) return false
    // angle mirrors only care about their own named track, not the primary go-live flag
    if (this.isAngleMirror()) return this.hasAngleFeed()
    return !!this.activeLiveShowboxUuid() || this.mirrorHasVideoSource()
  }

  mirrorHasVideoSource() {
    // angle feeds only belong to their own mirror - don't let them count as the primary stream
    for (const p of (this.mirrorSourceRoom() as any)?.participants?.values() ?? []) {
      for (const pub of p.videoTracks?.values() ?? []) {
        if (!this.isAngleTrackName(pub.trackName)) return true
      }
    }
    const primary = this.parcel.primaryShowbox() as any
    for (const pub of primary?.broadcastRoom?.localParticipant?.videoTracks?.values() ?? []) {
      if (!this.isAngleTrackName(pub.trackName)) return true
    }
    return false
  }

  // a mirror set to "second camera" shows a dedicated video-only track named with its own uuid,
  // not the primary's stream. any broadcaster can publish one.
  isAngleMirror() {
    // second screen is the default for a mirror now - only an explicit angleMode === false makes it a plain mirror.
    return this.isMirror() && this.description.angleMode !== false
  }

  hasAngleFeed() {
    if (this.angleVideoTrack) return true
    for (const p of (this.livekitRoom as any)?.participants?.values() ?? []) {
      for (const pub of p.videoTracks.values()) {
        if (pub.trackName === this.uuid) return true
      }
    }
    return false
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
      // a mirror promoted to primary (old primary deleted mid-show) starts with no room
      if (!this.livekitRoom && this.needsViewerRoom() && this.isInCurrentParcel) this.scheduleViewerRetry()
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
    this.mirrorVideoTrack = null
    if (this.isCohostMode()) this.stopCohostComposite()
    this.setPreview()
  }

  // plain mirrors subscribe nothing themselves - the primary showbox's viewer room is the track
  // source. a room per mirror downloaded and decoded the same stream n times, which is what
  // killed phones. angle mirrors keep their own room (named track + walk-up publishing).
  mirrorSourceRoom() {
    if (this.isMirror() && !this.isAngleMirror()) {
      return (this.parcel.primaryShowbox() as any)?.livekitRoom ?? this.livekitRoom
    }
    return this.livekitRoom
  }

  // one <video> per track: every attach() spawns a fresh element, and each element is another
  // hardware decoder on ios. reuse the element the track already has.
  attachedVideoEl(track: any): HTMLVideoElement {
    const existing = track?.attachedElements?.find((e: any) => e instanceof HTMLVideoElement)
    return (existing as HTMLVideoElement) ?? (track.attach() as HTMLVideoElement)
  }

  // angle mirrors show only the track named with their uuid (a dedicated second camera), muted. no echo fallback.
  refreshAngleVideo() {
    const attach = (track: any) => {
      if (!track) return false
      if (this.mirrorVideoIdentity !== this.uuid || this.mirrorVideoTrack !== track) {
        this.attachVideoToMesh(this.attachedVideoEl(track), true)
        this.mirrorVideoIdentity = this.uuid
        this.mirrorVideoTrack = track
        this.stopStreamAttachRetry()
      }
      return true
    }
    // our own walk-up broadcast to this mirror - not a remote participant on this client
    if (this.angleVideoTrack && attach(this.angleVideoTrack)) return
    let pendingPub = false
    for (const p of (this.livekitRoom as any)?.participants?.values() ?? []) {
      for (const pub of p.videoTracks.values()) {
        if (pub.trackName !== this.uuid) continue
        pendingPub = true
        if (pub.track && pub.isSubscribed && attach(pub.track)) return
      }
    }
    // publication exists or we already have a frame - don't flash back to placeholder mid-subscribe
    if (pendingPub || (this.hasActiveVideo && this.mirrorVideoIdentity === this.uuid)) return
    if (this.hasActiveVideo) {
      this.hasActiveVideo = false
      this.mirrorVideoIdentity = null
      this.mirrorVideoTrack = null
      this.setPreview()
    }
  }

  // owners/collaborators + valid guest links can drive a second camera into an angle mirror
  canBroadcastAngle() {
    return this.isAngleMirror() && (this.parcel.canEdit || isGuestForShowbox(this.uuid) || isGuestOnParcel(this.parcel.id))
  }

  // walk up to an angle mirror and push your camera straight to it (video only, no audio, no __showbox_live).
  // published on the viewer room - its token already grants canPublish for authorized users.
  async startAngleBroadcast(deviceId?: string, useScreen = false): Promise<boolean> {
    // capture first, in the click gesture - getDisplayMedia only opens the OS picker when called synchronously inside it.
    let track: any
    try {
      if (useScreen) {
        // share a window/screen, video only - a side-feed never carries audio. the browser picker chooses what.
        ;[track] = await createLocalScreenTracks({ audio: false })
      } else {
        // exact: a plain string deviceId is only a preference, so the browser hands back the already-running primary camera. Force the pick.
        track = await createLocalVideoTrack(deviceId ? { deviceId: { exact: deviceId } } : undefined)
      }
    } catch (e) {
      console.error('showbox: angle capture failed', e)
      return false
    }
    if (!track) return false // screenshare picker can resolve empty - never publish undefined
    return this.publishAngleTrack(track)
  }

  // publish an already-captured track to this mirror. split out so the capture can happen in-gesture (see shareScreenToSecondScreen).
  async publishAngleTrack(track: any): Promise<boolean> {
    if (this.angleVideoTrack) {
      try {
        track.stop()
      } catch {}
      return true
    }
    if (!this.livekitRoom) await this.connectViewer()
    const lp = (this.livekitRoom as any)?.localParticipant
    this.angleVideoTrack = track
    try {
      await lp.publishTrack(track, { name: this.uuid })
    } catch (e) {
      console.error('showbox: angle capture failed to publish', e)
      try {
        track.stop()
      } catch {}
      this.angleVideoTrack = null
      return false
    }
    // browser "stop sharing" bar (or a yanked camera) ends the track - drop back to idle so the screen isn't frozen.
    track.mediaStreamTrack?.addEventListener('ended', () => this.stopAngleBroadcast())
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
  openAnglePanel(cameraOnly = false) {
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
    title.textContent = cameraOnly ? 'add camera' : 'second screen'
    title.style.fontWeight = 'bold'
    title.style.fontSize = mobile ? '16px' : '14px'

    const hint = document.createElement('small')
    hint.textContent = cameraOnly ? 'pick a camera. video only, no audio.' : 'share a screen or add a camera. video only, no audio.'
    hint.style.color = '#888'

    const sel = document.createElement('select')
    Object.assign(sel.style, { width: '100%', background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: mobile ? '8px' : '4px' })
    if (mobile) Object.assign(sel.style, { fontSize: '16px', minHeight: '44px' })

    const status = document.createElement('div')
    Object.assign(status.style, { color: '#888', fontSize: '12px', minHeight: '14px' })

    const btnStyle = { background: 'var(--red)', color: '#fff', border: '0', padding: mobile ? '12px' : '8px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold' }

    const shareScreenBtn = document.createElement('button')
    shareScreenBtn.type = 'button'
    shareScreenBtn.textContent = 'share screen'
    Object.assign(shareScreenBtn.style, btnStyle, { flex: '1' }) // shares the idle button row
    if (mobile || cameraOnly) shareScreenBtn.style.display = 'none' // phone screenshare is unreliable; cameraOnly hides it entirely

    const addCameraBtn = document.createElement('button')
    addCameraBtn.type = 'button'
    addCameraBtn.textContent = 'add camera'
    Object.assign(addCameraBtn.style, btnStyle, { flex: '1' })

    const stopBtn = document.createElement('button')
    stopBtn.type = 'button'
    stopBtn.textContent = 'stop'
    Object.assign(stopBtn.style, btnStyle) // stands alone - no flex stretch in the column
    stopBtn.onclick = () => {
      this.stopAngleBroadcast()
      this.closeAnglePanel()
    }

    const start = async (useScreen: boolean) => {
      shareScreenBtn.disabled = true
      addCameraBtn.disabled = true
      status.textContent = useScreen ? 'pick a screen...' : 'starting camera...'
      const ok = await this.startAngleBroadcast(useScreen ? undefined : sel.value || undefined, useScreen)
      if (ok) {
        this.closeAnglePanel()
      } else {
        shareScreenBtn.disabled = false
        addCameraBtn.disabled = false
        status.textContent = useScreen ? 'could not share that screen - try again' : 'could not start that camera - try another'
      }
    }
    shareScreenBtn.onclick = () => start(true)
    addCameraBtn.onclick = () => start(false)

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'cancel'
    Object.assign(cancel.style, { background: 'transparent', color: '#888', border: '0', padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' })
    cancel.onclick = () => this.closeAnglePanel()

    if (this.angleVideoTrack) {
      panel.append(title, stopBtn, cancel)
    } else {
      const btnRow = document.createElement('div')
      Object.assign(btnRow.style, { display: 'flex', gap: '0.5rem' })
      btnRow.append(shareScreenBtn, addCameraBtn)
      panel.append(title, hint, sel, btnRow, status, cancel)
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
    this.mirrorVideoTrack = null
    this.refreshAngleVideo()
    // refreshAngleVideo only repaints when it had an active feed; clearing it first leaves the last frame
    // frozen, so restore the idle "broadcast to this mirror" CTA when nothing else is driving the screen.
    if (!this.hasActiveVideo) this.setPreview()
  }

  // host quick-share from the dock: pick an idle second screen or drop a fresh one, then push your screen to it.
  // reusable - a "new" screen persists as a real feature, so next time it shows up as "existing".
  openShareScreenChooser() {
    const mirrors = (this.parcel.getFeaturesByType('showbox') as Showbox[]).filter((f) => f.isAngleMirror() && !f.angleVideoTrack)
    if (!mirrors.length) {
      if (!this.parcel.canEdit) return void app.showSnackbar("you can't add a screen on this parcel", PanelType.Warning)
      return void this.shareScreenToSecondScreen('new') // nothing to reuse - go straight to a new one
    }

    exitPointerLock()
    const panel = document.createElement('div')
    Object.assign(panel.style, {
      position: 'fixed',
      zIndex: '999999',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '280px',
      background: '#0d0d0d',
      color: '#f5f5f0',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      fontFamily: '"Source Code Pro", monospace',
      fontSize: '13px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
    })
    const title = document.createElement('div')
    title.textContent = 'share a screen'
    title.style.fontWeight = 'bold'
    const close = () => panel.remove()
    const mkBtn = (label: string, onClick: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      Object.assign(b.style, { background: 'var(--red)', color: '#fff', border: '0', padding: '8px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold' })
      b.onclick = () => {
        close()
        onClick()
      }
      return b
    }
    panel.append(title)
    if (this.parcel.canEdit) panel.append(mkBtn('new screen', () => void this.shareScreenToSecondScreen('new')))
    mirrors.forEach((m, i) => panel.append(mkBtn(`existing screen ${i + 1}`, () => void this.shareScreenToSecondScreen(m))))
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'cancel'
    Object.assign(cancel.style, { background: 'transparent', color: '#888', border: '0', padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' })
    cancel.onclick = close
    panel.append(cancel)
    document.body.appendChild(panel)
  }

  private sharingScreenPending = false

  // new -> drop a second screen beside your stage screen, already showing your share; slide/resize it with the handles. existing -> reuse one.
  async shareScreenToSecondScreen(target: Showbox | 'new') {
    if (target === 'new' && !this.parcel.canEdit) {
      app.showSnackbar("you can't add a screen on this parcel", PanelType.Warning)
      return
    }
    if (this.sharingScreenPending) return // ignore a second click while a share is mid-flight
    this.sharingScreenPending = true
    try {
      // capture the screen first, synchronously in the click gesture - else the OS picker silently no-ops and we leave a stray empty screen.
      let track: any
      try {
        ;[track] = await createLocalScreenTracks({ audio: false })
      } catch {
        return // cancelled/blocked picker - spawn nothing
      }
      if (!track) return

      let mirror: Showbox | null = target === 'new' ? null : target
      if (target === 'new') {
        const tool = window.ui?.featureTool
        const engine = this.scene.getEngine()
        const pick = this.scene.pick(engine.getRenderWidth() / 2, engine.getRenderHeight() / 2)
        if (!tool || !pick?.pickedPoint) {
          try {
            track.stop()
          } catch {}
          app.showSnackbar('look toward your stage, then try again', PanelType.Warning)
          return
        }
        const feature = (await tool.spawn(pick, { ...Showbox.template, angleMode: true })) as Showbox | null
        if (feature) {
          // land it right beside the primary stage screen, facing the same way, so it's in view and oriented - then drag/resize.
          const right = this.mesh ? this.mesh.getDirection(new BABYLON.Vector3(1, 0, 0)).normalize() : new BABYLON.Vector3(1, 0, 0)
          const offset = (this.scale?.x ?? 2) / 2 + 1.3
          feature.set({ position: this.position.add(right.scale(offset)).asArray() as [number, number, number], rotation: this.rotation.asArray() as [number, number, number] })
        }
        mirror = feature
      }

      if (!mirror) {
        try {
          track.stop()
        } catch {}
        app.showSnackbar('could not start the screen share', PanelType.Warning)
        return
      }
      // publishAngleTrack owns the track from here (it stops it on its own failure paths) - don't double-stop.
      const ok = await mirror.publishAngleTrack(track)
      if (!ok) app.showSnackbar('could not start the screen share', PanelType.Warning)
    } finally {
      this.sharingScreenPending = false
    }
  }

  // mirrors show the chosen source muted (default: whoever is live, host preferred), so every mirror is consistent
  refreshMirrorVideo() {
    if (!this.isMirror() || this.broadcastRoom) return
    // primary on a standby card -> the mirror shows the same card, not a frozen last frame
    if (this.isIntermissionActive()) {
      this.drawIntermissionCard()
      return
    }
    if (this.isAngleMirror()) {
      if (!this.livekitRoom) return
      return this.refreshAngleVideo()
    }
    const pick = this.pickVideoSource(true)
    if (!pick) {
      if (this.hasRemoteBroadcaster()) return
      if (this.hasActiveVideo) {
        this.hasActiveVideo = false
        this.mirrorVideoIdentity = null
        this.mirrorVideoTrack = null
        this.setPreview()
      }
      return
    }
    if (this.hasActiveVideo && this.mirrorVideoIdentity === pick.id && this.mirrorVideoTrack === pick.track) return
    this.attachVideoToMesh(this.attachedVideoEl(pick.track), true)
    this.mirrorVideoIdentity = pick.id
    this.mirrorVideoTrack = pick.track
    this.stopStreamAttachRetry()
  }

  tryAttachExistingStream() {
    if (this.broadcastRoom) return
    if (this.isMirror()) {
      // plain mirrors have no room of their own - they read the primary's
      this.refreshMirrorVideo()
      return
    }
    if (!this.livekitRoom) return
    this.syncExistingStreamAudio()
    if (this.isCohostMode()) {
      if (this.hasActiveVideo) return
      this.syncExistingCohostVideos()
      this.updateCohostComposite()
      return
    }
    if (this.hasActiveVideo) return
    const pick = this.pickVideoSource(false)
    if (!pick) return
    this.attachVideoToMesh(this.attachedVideoEl(pick.track), true)
    this.startBroadcastAudio()
    this.stopStreamAttachRetry()
  }

  isShowLive() {
    return !!this.broadcastRoom || this.hasActiveVideo || this.hasRemoteBroadcaster()
  }

  receiveState(state: ShowboxCelebrateState) {
    if (state && 'intermission' in state) this.applyIntermissionState(state.intermission ?? null)
    const n = state?.celebrate
    const at = state?.at ?? 0
    if (!n || n < 10 || !at || !this.isInCurrentParcel || !this.isShowLive()) return
    if (at <= this.lastCelebrateAt || n <= this.lastCelebrateN) return
    this.lastCelebrateAt = at
    this.lastCelebrateN = n
    this.runCelebrate(n)
  }

  // viewer side: the broadcaster's raise/drop arrives on this showbox's state slice. the host drives
  // its own card locally (and would only echo its own patch), so it ignores this.
  applyIntermissionState(next: ShowboxIntermission | null) {
    if (this.broadcastRoom) return
    const cur = this.intermission
    const changed = !!cur !== !!next || (!!cur && !!next && cur.at !== next.at)
    if (!changed) return
    this.intermission = next
    if (this.intermission) {
      this.drawIntermissionCard()
    } else {
      this.stopIntermissionCard()
      this.hasActiveVideo = false
      // the card replaced the mesh material but left cohostCompositeAttached=true, so updateCohostComposite
      // would skip re-pinning the composite and the viewer stays stuck on the card. force a re-attach.
      this.cohostCompositeAttached = false
      this.reconcileActiveStream()
    }
    // plain mirrors read the primary's flag - nudge them to repaint too
    this.refreshParcelMirrors()
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

  runTipCelebrate(amount: number) {
    let n = 10
    if (amount >= 0.05) n = 50
    else if (amount >= 0.01) n = 25
    this.runCelebrate(n)
  }

  broadcastRoomParticipantCount() {
    const room = this.broadcastRoom
    if (!room) return 0
    try {
      const n = (room as any).participants?.size
      if (typeof n === 'number' && n > 0) return n
    } catch {}
    return 0
  }

  async fetchViewerCount() {
    const live = this.broadcastRoomParticipantCount()
    if (live > 0) return live
    try {
      const r = await fetch(`/api/rooms/${this.roomName()}`)
      if (!r.ok) return 0
      const j = await r.json().catch(() => null)
      return j?.room?.numParticipants ?? 0
    } catch {
      return 0
    }
  }

  guestLiveUrl(token: string) {
    return `${window.location.origin}/live/${token}`
  }

  canManageGuestPasses() {
    return this.parcel.canEdit
  }

  async fetchActiveGuestPassToken() {
    try {
      const r = await fetch(`/api/parcels/${this.parcel.id}/guest-passes?feature_uuid=${encodeURIComponent(this.uuid)}`, { credentials: 'include', cache: 'no-store' })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) return null
      const pass = (j.passes ?? []).find((p: any) => !p.revoked_at)
      return pass?.token ?? null
    } catch {
      return null
    }
  }

  async createGuestPassToken() {
    if (!this.canManageGuestPasses()) return null
    try {
      const r = await fetch(`/api/parcels/${this.parcel.id}/guest-passes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ feature_uuid: this.uuid }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) return null
      return j.pass?.token ?? null
    } catch {
      return null
    }
  }

  async resolveGuestShareUrl() {
    let token = await this.fetchActiveGuestPassToken()
    if (!token && this.canManageGuestPasses()) {
      token = await this.createGuestPassToken()
      if (!token) app.showSnackbar('could not create guest link', PanelType.Warning)
    }
    if (!token) return null
    return this.guestLiveUrl(token)
  }

  async shareShowUrl(url: string, text: string) {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'voxels show', text, url })
      } catch (e) {
        if ((e as DOMException)?.name !== 'AbortError') {
          navigator.clipboard.writeText(url).catch(() => {})
          app.showSnackbar('link copied - paste in your app', PanelType.Success)
        }
      } finally {
        if (mobile) refreshMobileCanvasAfterReturn()
      }
      return
    }
    navigator.clipboard.writeText(url).catch(() => {})
    app.showSnackbar('link copied - paste in your app', PanelType.Success)
  }

  stopMilestonePoll() {
    if (this.milestonePollInterval) {
      clearInterval(this.milestonePollInterval)
      this.milestonePollInterval = null
    }
    this.onViewerCountTick = null
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
      const lost = this.checkBroadcastHealth()
      if (lost) {
        this.onBroadcastLost(lost)
        return
      }
      this.warnIfWalkingAway()
      void maybeRefreshGuestJwt()
      const count = await this.fetchViewerCount()
      this.onViewerCountTick?.(count)
      if (!count) return
      for (const m of VIEWER_MILESTONES) {
        if (count >= m && !this.celebratedMilestones.has(m)) {
          this.celebratedMilestones.add(m)
          this.fireMilestone(m)
        }
      }
    }
    this.milestonePollInterval = setInterval(tick, BROADCAST_HEALTH_POLL_MS)
    setTimeout(tick, BROADCAST_HEALTH_POLL_MS)
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
    el.remove()
  }

  // removing a playing media element from the DOM does not stop it - the livekit track still
  // feeds it. kill the source before dropping the element or the audio stacks up per re-attach.
  silenceAudioEl(el: HTMLAudioElement) {
    try {
      el.pause()
      el.srcObject = null
    } catch {}
    el.remove()
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

  // audience audio normally lands in the TrackSubscribed handler, but livekit can deliver the
  // tracks before the __showbox_live patch arrives - that handler bails on the flag check and
  // nothing else attaches audio, so the viewer gets a silent show. sync on every reconcile.
  syncExistingStreamAudio() {
    if (this.broadcastRoom || !this.livekitRoom || !wantsAudio()) return
    if (!this.streamTargetsThisShowbox()) return
    for (const p of (this.livekitRoom as any).participants?.values() ?? []) {
      for (const pub of p.audioTracks?.values() ?? []) {
        if (!pub.isSubscribed || !pub.track) continue
        const els: any[] = pub.track.attachedElements ?? []
        if (els.some((e) => this.streamAudioEls.includes(e))) continue
        const el = pub.track.attach() as HTMLAudioElement
        el.style.display = 'none'
        document.body.appendChild(el)
        this.trackStreamAudio(el, p.identity)
        duckRadio(this)
      }
    }
    this.startBroadcastAudio()
  }

  trackStreamAudio(el: HTMLAudioElement, identity?: string) {
    if (identity) {
      const prefix = cohostIdentityPrefix(identity)
      for (let i = this.streamAudioEls.length - 1; i >= 0; i--) {
        const old = this.streamAudioEls[i] as HTMLAudioElement & { dataset: { streamPrefix?: string } }
        if (old.dataset?.streamPrefix === prefix) {
          this.untrackStreamAudio(old)
        }
      }
      el.dataset.streamPrefix = prefix
    }
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
    return this.description.guestMode === 'solo' ? 'solo' : 'cohost'
  }

  get screenShape(): 'landscape' | 'portrait' {
    if (this.isMirror()) {
      const primary = this.parcel.primaryShowbox() as Showbox | undefined
      return primary?.description.screenShape === 'portrait' ? 'portrait' : 'landscape'
    }
    return this.description.screenShape === 'portrait' ? 'portrait' : 'landscape'
  }

  isPortraitScreen() {
    return this.screenShape === 'portrait'
  }

  meshVideoSize() {
    return this.isPortraitScreen() ? { w: PORTRAIT_MESH_W, h: PORTRAIT_MESH_H } : { w: LANDSCAPE_MESH_W, h: LANDSCAPE_MESH_H }
  }

  isCohostMode() {
    return this.guestMode === 'cohost'
  }

  isSoloGuestMode() {
    return this.guestMode === 'solo'
  }

  collectVideoSources() {
    const byRole: Partial<Record<MirrorRole, { track: any; id: string }>> = {}
    let first: { track: any; id: string } | null = null
    const consider = (track: any, identity: string, trackName?: string) => {
      if (!track) return
      if (this.isAngleTrackName(trackName)) return
      const role = this.publisherRole(identity)
      if (!byRole[role]) byRole[role] = { track, id: identity }
      if (!first) first = { track, id: identity }
    }
    for (const p of (this.mirrorSourceRoom() as any)?.participants?.values() ?? []) {
      for (const pub of p.videoTracks.values()) {
        if (pub.isSubscribed) consider(pub.track, p.identity, pub.trackName)
      }
    }
    const local = (this.parcel.primaryShowbox() as any)?.broadcastRoom?.localParticipant
    for (const pub of local?.videoTracks?.values() ?? []) {
      consider(pub.track, local.identity, pub.trackName)
    }
    return { byRole, first }
  }

  pickVideoSource(forMirror = false): { track: any; id: string } | null {
    const { byRole, first } = this.collectVideoSources()
    if (!first) return null
    const want = forMirror ? this.mirrorSource : 'auto'
    const solo = forMirror ? (this.parcel.primaryShowbox() as Showbox)?.guestMode === 'solo' : this.isSoloGuestMode()
    if (want !== 'auto' && byRole[want]) return byRole[want]!
    if (solo) return byRole.guest ?? byRole.host ?? byRole.collaborator ?? first
    return byRole.host ?? byRole.collaborator ?? byRole.guest ?? first
  }

  scheduleMirrorRefresh() {
    if (!this.isMirror() || this.disposed) return
    if (this.mirrorRefreshTimer) clearTimeout(this.mirrorRefreshTimer)
    this.mirrorRefreshTimer = setTimeout(() => {
      this.mirrorRefreshTimer = null
      if (!this.isMirror() || this.disposed) return
      this.refreshMirrorVideo()
    }, 500)
  }

  // plain mirrors run no room of their own, so the primary's room events drive their refresh
  refreshParcelMirrors() {
    if (this.isMirror()) return
    for (const f of this.parcel.getFeaturesByType('showbox')) {
      if (f !== this) (f as any).scheduleMirrorRefresh?.()
    }
  }

  hasRemoteBroadcaster() {
    if (!this.displaysStream()) return false
    for (const p of (this.mirrorSourceRoom() as any)?.participants?.values() ?? []) {
      if (p?.audioTracks?.size > 0) return true
      // angle feeds are video-only side channels, not a live show
      for (const pub of p?.videoTracks?.values() ?? []) {
        if (!this.isAngleTrackName(pub.trackName)) return true
      }
    }
    return false
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

  clearBroadcastDockUi() {
    this.broadcastDockLiveDot = null
    this.broadcastDockLiveLabel = null
    this.broadcastDockStatusEl = null
    this.broadcastLost = false
    this.broadcastReconnecting = false
    this.broadcastReconnectAttempts = 0
    this.broadcastDisconnectStrikes = 0
    this.broadcastCameraLost = false
    this.cameraHealthStrikes = 0
    if (this.cameraEndedTimer) {
      clearTimeout(this.cameraEndedTimer)
      this.cameraEndedTimer = null
    }
    this.broadcastStopping = false
    this.cameraResumeGen++
    this.broadcastCameraReconnectBtn = null
    this.broadcastLiveTracks = null
    this.broadcastLiveVideoTrack = null
    this.broadcastLiveAudioTrack = null
    this.mobilePreviewVideoEl = null
    this.syncMobilePreviewDock = null
    this.mobileBroadcastHooksClear?.()
    this.mobileBroadcastHooksClear = null
  }

  sidebarDock() {
    return isSplit() && !mobile
  }

  dismissBroadcastPanel() {
    this.broadcastPanel?.remove()
    this.broadcastPanel = null
    this.broadcastPanelSidebar = false
    if (this.sidebarDock()) closeBroadcastSidebar()
  }

  applySidebarDockStyles(panel: HTMLDivElement) {
    Object.assign(panel.style, {
      position: 'relative',
      zIndex: 'auto',
      inset: 'auto',
      top: 'auto',
      right: 'auto',
      left: 'auto',
      bottom: 'auto',
      transform: 'none',
      width: '100%',
      maxWidth: 'none',
      maxHeight: 'none',
      boxShadow: 'none',
    })
  }

  attachBroadcastPanel(panel: HTMLDivElement) {
    if (!this.sidebarDock()) {
      document.body.appendChild(panel)
      return
    }
    this.broadcastPanelSidebar = true
    broadcastShowboxUuid.value = this.uuid
    uiPane.value = 'broadcast'
    uiAsideTick.value++
    this.applySidebarDockStyles(panel)
    const attach = () => {
      const mount = document.getElementById('showbox-broadcast-mount')
      if (!mount) {
        requestAnimationFrame(attach)
        return
      }
      mount.appendChild(panel)
    }
    attach()
  }

  restoreLiveDockUi() {
    if (!this.broadcastDockLiveLabel) return
    this.broadcastDockLiveLabel.textContent = 'live'
    const header = this.broadcastDockLiveLabel.parentElement as HTMLElement | null
    if (header) header.style.color = 'var(--red)'
    if (this.broadcastDockLiveDot) {
      this.broadcastDockLiveDot.style.color = ''
      this.broadcastDockLiveDot.style.animation = 'showbox-live-pulse 1.2s ease-in-out infinite'
    }
    if (this.broadcastDockStatusEl) {
      this.broadcastDockStatusEl.style.display = 'none'
      this.broadcastDockStatusEl.textContent = ''
      this.broadcastDockStatusEl.style.color = ''
    }
  }

  maybeReconnectAfterDisconnect(reason: string) {
    if (this.broadcastLost || this.broadcastReconnecting || !this.broadcastPanel) return
    if (livekitRoomState(this.broadcastRoom) === 'reconnecting') return
    this.broadcastDisconnectStrikes++
    if (this.broadcastDisconnectStrikes < BROADCAST_DISCONNECT_STRIKES) {
      if (this.broadcastDockStatusEl && !this.broadcastLost) {
        this.broadcastDockStatusEl.style.display = 'block'
        this.broadcastDockStatusEl.textContent = 'connection unstable...'
        this.broadcastDockStatusEl.style.color = '#f5b942'
      }
      return
    }
    void this.tryBroadcastReconnect(reason)
  }

  wireBroadcastRoom(room: Room) {
    // going live on a screen: your voice goes out the showbox, so step off the avatar voice mic
    window.persona?.voiceChat?.setBroadcasting(true)
    setRadioBroadcasting(true)
    window._audio?.setBroadcasting(true)
    const bumpViewerCount = () => {
      const total = this.broadcastRoomParticipantCount()
      if (total > 0) this.onViewerCountTick?.(total)
    }
    room.on(RoomEvent.ParticipantConnected, bumpViewerCount)
    room.on(RoomEvent.ParticipantDisconnected, bumpViewerCount)
    room.on(RoomEvent.Disconnected, () => {
      if (this.broadcastLost || !this.broadcastRoom) return
      this.maybeReconnectAfterDisconnect('connection lost')
    })
    const reconnected = (RoomEvent as any).Reconnected
    if (reconnected) {
      room.on(reconnected, () => {
        if (this.broadcastLost) return
        this.broadcastReconnecting = false
        this.broadcastReconnectAttempts = 0
        this.broadcastDisconnectStrikes = 0
        this.ensureShowboxLiveFlag()
        this.restoreLiveDockUi()
        void this.refreshBroadcastPreview()
      })
    }
  }

  async refreshBroadcastPreview() {
    const track = this.broadcastLiveVideoTrack
    if (!track) return
    if (this.isCohostMode()) {
      this.syncBroadcastVideoFromTrack(track)
      return
    }
    try {
      const el = track.attach() as HTMLVideoElement
      el.muted = true
      el.playsInline = true
      this.localBroadcastVideoEl = el
      this.attachVideoToMesh(el, true)
      syncVideoElFromTrack(this.mobilePreviewVideoEl, track)
      this.syncMobilePreviewDock?.()
      this.parcel.getFeaturesByType('showbox').forEach((f) => (f as any).refreshMirrorVideo?.())
    } catch {}
  }

  async tryBroadcastReconnect(reason: string) {
    if (this.broadcastLost || this.broadcastReconnecting || !this.broadcastPanel) return
    const tracks = this.broadcastLiveTracks
    if (!tracks?.length) {
      this.onBroadcastLost(reason)
      return
    }
    if (this.broadcastReconnectAttempts >= BROADCAST_RECONNECT_MAX) {
      this.onBroadcastLost(reason)
      return
    }
    this.broadcastReconnectAttempts++
    this.broadcastReconnecting = true
    if (this.broadcastDockStatusEl) {
      this.broadcastDockStatusEl.style.display = 'block'
      this.broadcastDockStatusEl.textContent = `reconnecting (${this.broadcastReconnectAttempts}/${BROADCAST_RECONNECT_MAX})...`
      this.broadcastDockStatusEl.style.color = '#f5b942'
    }
    await new Promise((r) => setTimeout(r, 1000 * this.broadcastReconnectAttempts))
    try {
      if (livekitRoomState(this.broadcastRoom) === 'reconnecting') {
        this.broadcastReconnecting = false
        return
      }
      this.broadcastRoom?.disconnect()
      const res = await fetchShowboxRoomToken(showboxRoomTokenUrl(this.roomName(), true))
      if (!res?.token) throw new Error('no token')
      saveShowboxPublisherIdentity(this.roomName(), res.token)
      const room = new Room()
      this.broadcastRoom = room
      this.wireBroadcastRoom(room)
      await room.connect(LIVEKIT_URL, res.token)
      this.parcel.sendStatePatch({ [this.uuid]: { live: 1 }, __showbox_live: this.uuid })
      for (const t of tracks) {
        await room.localParticipant.publishTrack(t)
      }
      this.broadcastReconnecting = false
      this.broadcastReconnectAttempts = 0
      this.broadcastDisconnectStrikes = 0
      this.ensureShowboxLiveFlag()
      this.restoreLiveDockUi()
      await this.refreshBroadcastPreview()
      this.parcel.getFeaturesByType('showbox').forEach((f) => (f as any).refreshMirrorVideo?.())
    } catch {
      this.broadcastReconnecting = false
      if (this.broadcastReconnectAttempts >= BROADCAST_RECONNECT_MAX) this.onBroadcastLost(reason)
    }
  }

  // returns a plain-language reason when we look live in the dock but the stream is not healthy
  checkBroadcastHealth(): string | null {
    const room = this.broadcastRoom
    if (!room) return null
    if (this.broadcastReconnecting) return null
    const state = (room as any).state
    if (state === 'disconnected') {
      this.maybeReconnectAfterDisconnect('connection lost')
      return null
    }
    if (state === 'reconnecting') {
      if (this.broadcastDockStatusEl && !this.broadcastLost) {
        this.broadcastDockStatusEl.style.display = 'block'
        this.broadcastDockStatusEl.textContent = 'reconnecting...'
      }
      return null
    }
    if (this.broadcastDockStatusEl && !this.broadcastLost) {
      this.broadcastDockStatusEl.style.display = 'none'
      this.broadcastDockStatusEl.textContent = ''
    }
    if (!this.streamTargetsThisShowbox()) {
      this.ensureShowboxLiveFlag()
    }
    if (this.liveStartedAt && Date.now() - this.liveStartedAt < BROADCAST_LIVE_GRACE_MS) return null
    try {
      if (broadcastVideoTrackLive(room, this.broadcastLiveVideoTrack)) {
        this.noteCameraHealthy(room)
      } else {
        this.noteCameraUnhealthy()
      }
      this.broadcastDisconnectStrikes = 0
      if (this.streamTargetsThisShowbox()) {
        try {
          this.parcel.sendStatePatch({ __showbox_live: this.uuid })
        } catch {}
      }
    } catch {}
    return null
  }

  needsViewerRoom() {
    if (this.broadcastRoom && !this.isCohostMode()) return false
    if (this.broadcastRoom && this.isCohostMode()) return true
    // plain mirrors render from the primary's room - their own connection would download and
    // decode the same stream again (n mirrors = n decoders on ios)
    if (this.isMirror() && !this.isAngleMirror()) return false
    return this.displaysStream() || this.isInCurrentParcel
  }

  wireViewerRoom(room: Room) {
    room.on(RoomEvent.Disconnected, () => {
      if (this.livekitRoom !== room || this.disposed) return
      if (this.broadcastRoom && !this.isCohostMode()) return
      this.maybeReconnectViewer('connection lost')
    })
    const reconnected = (RoomEvent as any).Reconnected
    if (reconnected) {
      room.on(reconnected, () => {
        if (this.livekitRoom !== room) return
        this.viewerReconnecting = false
        this.viewerReconnectAttempts = 0
        this.viewerDisconnectStrikes = 0
        if (this.broadcastRoom && this.isCohostMode()) {
          this.syncExistingCohostVideos()
          this.syncExistingCohostAudio()
          this.updateCohostComposite()
        } else {
          this.tryAttachExistingStream()
          if (!this.hasActiveVideo) this.scheduleStreamAttachRetry()
          this.refreshParcelMirrors()
        }
      })
    }
  }

  maybeReconnectViewer(_reason: string) {
    if (this.viewerReconnecting || this.viewerConnecting || this.disposed) return
    if (this.broadcastRoom && !this.isCohostMode()) return
    if (livekitRoomState(this.livekitRoom) === 'reconnecting') return
    // no strike threshold here: unlike the broadcast side there is no health poll re-calling
    // this, and RoomEvent.Disconnected only fires once - waiting for a second strike that
    // never comes left mirrors and co-host monitors dead until reload.
    this.viewerDisconnectStrikes++
    void this.tryViewerReconnect(_reason)
  }

  async tryViewerReconnect(_reason: string) {
    if (this.viewerReconnecting || this.viewerConnecting || this.disposed) return
    if (this.broadcastRoom && !this.isCohostMode()) return
    if (this.viewerReconnectAttempts >= BROADCAST_RECONNECT_MAX) {
      this.viewerReconnectAttempts = 0
      this.viewerDisconnectStrikes = 0
      this.livekitRoom?.disconnect()
      this.livekitRoom = null
      this.scheduleViewerRetry()
      return
    }
    this.viewerReconnectAttempts++
    this.viewerReconnecting = true
    await new Promise((r) => setTimeout(r, 500 * this.viewerReconnectAttempts))
    if (this.disposed) {
      this.viewerReconnecting = false
      return
    }
    if (livekitRoomState(this.livekitRoom) === 'reconnecting') {
      this.viewerReconnecting = false
      return
    }
    this.viewerConnectGen++
    this.livekitRoom?.disconnect()
    this.livekitRoom = null
    this.viewerReconnecting = false
    await this.connectViewer()
    if (this.livekitRoom) {
      this.viewerReconnectAttempts = 0
      this.viewerDisconnectStrikes = 0
    }
  }

  onlineReconnectHandler = () => {
    if (this.disposed) return
    if (this.broadcastRoom && livekitRoomState(this.broadcastRoom) === 'disconnected') {
      this.maybeReconnectAfterDisconnect('back online')
    }
    if (this.livekitRoom && livekitRoomState(this.livekitRoom) === 'disconnected') {
      this.maybeReconnectViewer('back online')
    } else if (!this.livekitRoom && this.needsViewerRoom()) {
      void this.connectViewer()
    }
  }

  wireOnlineReconnect() {
    if (this.onlineReconnectWired) return
    this.onlineReconnectWired = true
    window.addEventListener('online', this.onlineReconnectHandler)
  }

  noteCameraHealthy(room: Room) {
    this.cameraHealthStrikes = 0
    const pub = publishedVideoTrack(room)
    if (pub) this.broadcastLiveVideoTrack = pub
    if (this.broadcastCameraLost) this.clearCameraDisconnectedUi()
  }

  noteCameraUnhealthy() {
    this.cameraHealthStrikes++
    if (this.cameraHealthStrikes >= BROADCAST_CAMERA_STRIKES) this.onCameraDisconnected()
  }

  scheduleCameraEndedCheck() {
    if (this.cameraEndedTimer) clearTimeout(this.cameraEndedTimer)
    this.cameraEndedTimer = setTimeout(() => {
      this.cameraEndedTimer = null
      if (!this.broadcastRoom || this.broadcastStopping) return
      if (broadcastVideoTrackLive(this.broadcastRoom, this.broadcastLiveVideoTrack)) {
        this.noteCameraHealthy(this.broadcastRoom)
        return
      }
      this.noteCameraUnhealthy()
    }, BROADCAST_CAMERA_ENDED_DELAY_MS)
  }

  wireCameraEndedListener(track: any) {
    const mst = track?.mediaStreamTrack as MediaStreamTrack | undefined
    if (!mst) return
    mst.addEventListener('ended', () => {
      if (!this.broadcastRoom) return
      if (this.liveStartedAt && Date.now() - this.liveStartedAt < BROADCAST_LIVE_GRACE_MS) return
      this.scheduleCameraEndedCheck()
    })
  }

  onCameraDisconnected() {
    if (this.broadcastLost || this.broadcastCameraLost || !this.broadcastRoom) return
    this.broadcastCameraLost = true
    if (this.broadcastDockStatusEl) {
      this.broadcastDockStatusEl.style.display = 'block'
      this.broadcastDockStatusEl.textContent = 'camera disconnected'
      this.broadcastDockStatusEl.style.color = '#f5b942'
    }
    if (this.broadcastCameraReconnectBtn) this.broadcastCameraReconnectBtn.style.display = 'block'
  }

  clearCameraDisconnectedUi() {
    this.broadcastCameraLost = false
    if (this.broadcastCameraReconnectBtn) this.broadcastCameraReconnectBtn.style.display = 'none'
    if (this.broadcastDockStatusEl && !this.broadcastLost) {
      this.broadcastDockStatusEl.style.display = 'none'
      this.broadcastDockStatusEl.textContent = ''
    }
  }

  async tryResumeCamera() {
    if (!this.broadcastRoom || this.broadcastLost || this.broadcastStopping) return
    if (broadcastVideoTrackLive(this.broadcastRoom, this.broadcastLiveVideoTrack)) {
      this.noteCameraHealthy(this.broadcastRoom)
      return
    }
    if (!this.broadcastCameraLost) return
    const gen = ++this.cameraResumeGen
    if (this.broadcastDockStatusEl) {
      this.broadcastDockStatusEl.style.display = 'block'
      this.broadcastDockStatusEl.textContent = 'reconnecting camera...'
      this.broadcastDockStatusEl.style.color = '#f5b942'
    }
    const room = this.broadcastRoom
    const lp = room.localParticipant
    let vt = this.broadcastLiveVideoTrack
    try {
      const mst = vt?.mediaStreamTrack as MediaStreamTrack | undefined
      const dead = !mst || mst.readyState === 'ended'
      if (!dead && vt?.restartTrack) {
        if (mobile) await vt.restartTrack(showboxMobileCameraConstraints(this.mobileFlipFacing))
        else await vt.restartTrack({})
        if (gen !== this.cameraResumeGen || this.broadcastStopping || !this.broadcastRoom) return
      } else {
        const tracks = await createLocalTracks({
          video: showboxCameraVideoConstraints(undefined),
          audio: false,
        })
        const newVt = tracks.find((t) => t.kind === Track.Kind.Video)
        if (!newVt) throw new Error('no camera')
        if (gen !== this.cameraResumeGen || this.broadcastStopping || !this.broadcastRoom) return
        if (vt) {
          try {
            await lp.unpublishTrack(vt, true)
          } catch {}
          try {
            vt.stop()
          } catch {}
        }
        await lp.publishTrack(newVt)
        vt = newVt
        const rest = (this.broadcastLiveTracks ?? []).filter((t) => t.kind !== Track.Kind.Video)
        this.broadcastLiveTracks = [...rest, newVt]
      }
      this.broadcastLiveVideoTrack = vt
      this.wireCameraEndedListener(vt)
      this.clearCameraDisconnectedUi()
      if (this.isCohostMode()) {
        const el = vt.attach() as HTMLVideoElement
        this.wireLocalCohostVideo(el)
        this.updateCohostComposite()
      } else {
        const el = vt.attach() as HTMLVideoElement
        el.muted = true
        el.playsInline = true
        el.setAttribute('playsinline', '')
        this.localBroadcastVideoEl = el
        this.attachVideoToMesh(el, true)
        syncVideoElFromTrack(this.mobilePreviewVideoEl, vt)
        this.mobilePreviewVideoEl?.play().catch(() => {})
        this.syncMobilePreviewDock?.()
      }
      this.parcel.getFeaturesByType('showbox').forEach((f) => (f as any).refreshMirrorVideo?.())
    } catch {
      if (gen !== this.cameraResumeGen || this.broadcastStopping) return
      this.broadcastCameraLost = false
      this.onBroadcastLost('camera reconnect failed')
    }
  }

  onBroadcastLost(reason: string) {
    if (this.broadcastLost) return
    this.broadcastReconnecting = false
    this.broadcastDisconnectStrikes = 0
    this.broadcastCameraLost = false
    this.broadcastLost = true
    app.showSnackbar('stream ended - ' + reason, PanelType.Warning)
    if (this.broadcastDockLiveLabel) {
      this.broadcastDockLiveLabel.textContent = 'offline'
      const header = this.broadcastDockLiveLabel.parentElement as HTMLElement | null
      if (header) header.style.color = '#888'
    }
    if (this.broadcastDockLiveDot) {
      this.broadcastDockLiveDot.style.animation = 'none'
      this.broadcastDockLiveDot.style.color = '#888'
    }
    if (this.broadcastDockStatusEl) {
      this.broadcastDockStatusEl.style.display = 'block'
      this.broadcastDockStatusEl.textContent = reason
      this.broadcastDockStatusEl.style.color = '#f5b942'
    }
    this.mobileBroadcastHooksClear?.()
    this.mobileBroadcastHooksClear = null
    this.broadcastStopping = true
    this.cameraResumeGen++
    this.stopBroadcast(true)
    this.dismissBroadcastPanel()
    this.clearBroadcastDockUi()
    this.setPreview()
  }

  canOpenBroadcastPanel() {
    if (this.isMirror()) return false
    return isGuestForShowbox(this.uuid) || this.parcel.canEdit
  }

  parcelEditorWallet(wallet: string) {
    const w = (wallet || '').toLowerCase().trim()
    if (!w || w.startsWith('anon-')) return false
    const editors = [...this.parcel.contributors, ...this.parcel.owners].map((x) => (x || '').toLowerCase().trim()).filter(Boolean)
    return editors.includes(w)
  }

  isGuestPublisherIdentity(identity: string) {
    const prefix = cohostIdentityPrefix(identity)
    if (prefix.startsWith('guest-')) return true
    // signed-in guest cohosts publish under their wallet - only parcel editors are hosts
    return !this.parcelEditorWallet(prefix)
  }

  get mirrorSource(): MirrorSource {
    const s = this.description.mirrorSource
    return s === 'host' || s === 'collaborator' || s === 'guest' ? s : 'auto'
  }

  // classify a publisher by parcel role (anon guests use guest- livekit identity; signed-in guests use wallet)
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
    // every other publisher on the stage gets a monitor. camp gating (editors hear guests,
    // guests hear editors) left host<->collaborator and guest<->guest pairs mutually silent.
    return theirs !== myPub && theirs !== mySub
  }

  trackCohostMonitor(el: HTMLAudioElement, identity?: string) {
    if (identity) {
      const prefix = cohostIdentityPrefix(identity)
      for (let i = this.cohostMonitorEls.length - 1; i >= 0; i--) {
        const old = this.cohostMonitorEls[i] as HTMLAudioElement & { dataset: { cohostPrefix?: string } }
        if (old.dataset?.cohostPrefix === prefix) {
          this.silenceAudioEl(old)
          this.cohostMonitorEls.splice(i, 1)
        }
      }
      el.dataset.cohostPrefix = prefix
    }
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
      this.silenceAudioEl(el)
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
    for (const p of this.cohostPanes) p.el.remove()
    this.cohostPanes = []
    this.cohostCompositeEl?.remove()
    this.cohostCompositeEl = null
    this.cohostCanvas = null
    this.cohostCompositeAttached = false
    this.syncCohostPreview = null
    this.clearCohostMonitor()
  }

  cohostPaneFor(key: string) {
    return this.cohostPanes.find((p) => p.key === key)
  }

  setCohostPane(key: string, el: HTMLVideoElement, editor: boolean) {
    const existing = this.cohostPaneFor(key)
    if (existing) {
      if (existing.el !== el) {
        existing.el.remove()
        existing.el = el
        existing.hadFrame = false
      }
      existing.editor = editor
      return
    }
    // stage is full - everyone is still heard, but the screen caps at host + 4
    if (this.cohostPanes.length >= MAX_COHOST_PANES) {
      el.remove()
      return
    }
    this.cohostPanes.push({ key, el, hadFrame: false, editor })
  }

  drawCohostFrame() {
    if (!this.cohostCanvas) return false
    // mobile hidden videos flicker videoWidth - once a pane had frames it keeps its spot
    for (const p of this.cohostPanes) {
      if (!cohostVideoTrackLive(p.el)) p.hadFrame = false
      else if (cohostVideoReady(p.el)) p.hadFrame = true
    }
    const visible = this.cohostPanes.filter((p) => p.hadFrame)
    if (!visible.length) return false

    // host-anchored: the first editor with video is the big pane, guests fill the rest
    const anchor = visible.find((p) => p.editor) ?? visible[0]
    const ordered = [anchor, ...visible.filter((p) => p !== anchor)]

    const canvas = this.cohostCanvas
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0d0d0d'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const rects = cohostPaneRects(ordered.length, canvas.width, canvas.height, this.isPortraitScreen())
    ordered.forEach((p, i) => {
      const r = rects[i]
      if (r && p.el.videoWidth > 0) drawVideoCover(ctx, p.el, r.x, r.y, r.w, r.h)
    })
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
    this.setCohostPane('local', el, !isGuestForShowbox(this.uuid))
  }

  syncBroadcastVideoFromTrack(track: any) {
    if (!track) return
    if (this.isCohostMode()) {
      const el = this.cohostPaneFor('local')?.el ?? null
      syncVideoElFromTrack(el, track)
      el?.addEventListener('loadeddata', () => this.updateCohostComposite(), { once: true })
      this.updateCohostComposite()
      this.syncCohostPreview?.()
      return
    }
    syncVideoElFromTrack(this.localBroadcastVideoEl, track)
    syncVideoElFromTrack(this.mobilePreviewVideoEl, track)
    this.syncMobilePreviewDock?.()
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
        if (pub.isSubscribed && pub.track) this.trackCohostMonitor(pub.track.attach() as HTMLAudioElement, p.identity)
      }
    }
    this.startBroadcastAudio()
  }

  updateCohostComposite() {
    if (!this.isCohostMode() || this.disposed) return

    // A guest who just went live is waiting on the host's video. Show a connecting card instead of
    // a half-empty composite, but only briefly - after the grace window we show whatever we have.
    const waitingForHost =
      !!this.broadcastRoom && !this.cohostCompositeAttached && isGuestForShowbox(this.uuid) && !this.cohostPanes.some((p) => p.editor && cohostVideoReady(p.el)) && Date.now() - this.cohostLiveSince < COHOST_CONNECT_GRACE_MS
    if (waitingForHost) {
      this.setCohostConnecting()
      return
    }

    if (!this.cohostCanvas) this.cohostCanvas = document.createElement('canvas')
    const { w: cw, h: ch } = this.meshVideoSize()
    if (this.cohostCanvas.width !== cw || this.cohostCanvas.height !== ch) {
      this.cohostCanvas.width = cw
      this.cohostCanvas.height = ch
      this.cohostCompositeAttached = false
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

    // don't claim the composite is on the mesh while a standby card is suppressing the attach - the
    // flags would lie and a viewer who joined during the card (cold-open) would never re-pin the
    // composite when the card clears. stays false now; reconcile re-runs this once intermission ends.
    if (!this.cohostCompositeAttached && !this.isIntermissionActive()) {
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
    const key = cohostIdentityPrefix(identity)
    // our own published video echoes back through the viewer room - the 'local' pane already has us
    const myPub = this.broadcastRoom ? cohostIdentityPrefix((this.broadcastRoom as any).localParticipant.identity) : null
    if (myPub && key === myPub) return
    const mst = track?.mediaStreamTrack as MediaStreamTrack | undefined
    const existing = this.cohostPaneFor(key)
    if (existing && mst) {
      const cur = existing.el.srcObject instanceof MediaStream ? existing.el.srcObject.getVideoTracks()[0] : null
      if (cur === mst) return
    }
    const el = track.attach() as HTMLVideoElement
    el.muted = true
    el.playsInline = true
    el.autoplay = true
    el.style.display = 'none'
    document.body.appendChild(el)
    el.play().catch(() => {})
    el.addEventListener('loadeddata', () => this.updateCohostComposite(), { once: true })
    this.setCohostPane(key, el, !this.isGuestPublisherIdentity(identity))
    this.updateCohostComposite()
  }

  clearCohostVideoForIdentity(identity: string) {
    const key = cohostIdentityPrefix(identity)
    const i = this.cohostPanes.findIndex((p) => p.key === key)
    if (i < 0) return
    this.cohostPanes[i].el.remove()
    this.cohostPanes.splice(i, 1)
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
    }
    if (!this.hasActiveVideo && !this.broadcastRoom) this.setPreview()
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
    this.wireOnlineReconnect()
    if (isSyntheticGuestWallet()) consumeGuestFreshFromUrl((n) => app.setName(n))
    if (guestJwtPayload()?.guest_pass) {
      void maybeRefreshGuestJwt()
      if (!this.guestJwtRefreshInterval) {
        this.guestJwtRefreshInterval = setInterval(() => void maybeRefreshGuestJwt(), 5 * 60 * 1000)
      }
    }
    if (!this.livekitRoom && this.needsViewerRoom()) {
      this.connectViewer()
    }
    // Guest pass redirects with ?show=<uuid> - auto-open the broadcast dock so they don't have to find/click the panel.
    // Host links (?host=1) need a signed-in parcel owner - prompt login first if needed.
    // Wallet may still be loading from the jwt cookie when onEnter fires; retry after app state settles.
    if (this.broadcastPanel) return
    const hostOrGuest = wantsHostJoin(this.uuid) || isGuestForShowbox(this.uuid)
    if (hostOrGuest && this.hostJoinAutoOpenStarted) return
    if (hostOrGuest) this.hostJoinAutoOpenStarted = true

    const tryAutoOpen = () => {
      if (this.broadcastPanel || this.joinDockAutoOpened) return true
      if (isGuestForShowbox(this.uuid)) {
        this.joinDockAutoOpened = true
        clearShowboxJoinParams()
        this.openBroadcastPanel(true)
        if (!this.broadcastPanel) {
          this.joinDockAutoOpened = false
          return false
        }
        this.hostDockAutoOpenedAt = Date.now()
        return true
      }
      if (wantsHostJoin(this.uuid)) {
        if (!app.signedIn) return false
        if (!this.parcel.canEdit) {
          app.showSnackbar('sign in as the parcel owner to use this host link', PanelType.Warning)
          return false
        }
        let opener: Showbox = this
        if (this.isMirror()) {
          const primary = this.parcel.primaryShowbox() as Showbox | undefined
          if (primary?.uuid && primary.uuid !== this.uuid) opener = primary
        }
        if (opener.broadcastPanel || opener.joinDockAutoOpened) return true
        opener.joinDockAutoOpened = true
        clearShowboxJoinParams()
        opener.openBroadcastPanel(true)
        if (!opener.broadcastPanel) {
          opener.joinDockAutoOpened = false
          return false
        }
        opener.hostDockAutoOpenedAt = Date.now()
        this.joinDockAutoOpened = true
        return true
      }
      return false
    }
    if (!hostOrGuest) return

    setTimeout(() => {
      if (tryAutoOpen()) return
      void app.getState().then(() => {
        if (tryAutoOpen()) return
        if (!this.broadcastRoom && !this.hasActiveVideo) this.setPreview()
      })
      if (!wantsHostJoin(this.uuid) && !isGuestForShowbox(this.uuid)) return
      const stopAt = Date.now() + 15000
      const onWalletReady = () => {
        if (Date.now() > stopAt || this.disposed || this.broadcastPanel || this.joinDockAutoOpened) {
          app.removeListener(AppEvent.Change, onWalletReady)
          return
        }
        if (!wantsHostJoin(this.uuid) && !isGuestForShowbox(this.uuid)) {
          app.removeListener(AppEvent.Change, onWalletReady)
          return
        }
        if (tryAutoOpen()) app.removeListener(AppEvent.Change, onWalletReady)
      }
      app.on(AppEvent.Change, onWalletReady)
      setTimeout(() => app.removeListener(AppEvent.Change, onWalletReady), 15000)
      setTimeout(() => {
        if (this.disposed || this.broadcastPanel || this.joinDockAutoOpened || !wantsHostJoin(this.uuid) || app.signedIn) return
        this.promptHostSignIn()
      }, 3000)
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
        let opener: Showbox = this
        if (this.isMirror()) {
          const primary = this.parcel.primaryShowbox() as Showbox | undefined
          if (primary?.uuid && primary.uuid !== this.uuid) opener = primary
        }
        if (opener.broadcastPanel) return
        opener.joinDockAutoOpened = true
        clearShowboxJoinParams()
        opener.openBroadcastPanel(true)
        if (!opener.broadcastPanel) {
          opener.joinDockAutoOpened = false
          return
        }
        opener.hostDockAutoOpenedAt = Date.now()
        this.joinDockAutoOpened = true
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
      // the angle feed publishes on the viewer room - disconnecting silently kills it, so tear
      // it down properly or hasAngleFeed()/startAngleBroadcast() get stuck on a dead track
      if (this.angleVideoTrack) this.stopAngleBroadcast(true)
      this.livekitRoom.disconnect()
      this.livekitRoom = null
      this.hasActiveVideo = false
      this.stopStreamVolumePoll()
      unduckRadio(this)
    }
  }

  stopViewerRetry() {
    if (this.viewerRetryInterval) {
      clearInterval(this.viewerRetryInterval)
      this.viewerRetryInterval = null
    }
  }

  scheduleViewerRetry() {
    if (this.viewerRetryInterval || this.disposed) return
    this.viewerRetryInterval = setInterval(() => {
      if (this.disposed || this.viewerConnecting) return
      if (this.broadcastRoom && !this.isCohostMode()) return
      if (this.livekitRoom) return
      if (!this.isInCurrentParcel && !this.viewerRoomFull && !this.broadcastRoom) return
      this.connectViewer()
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
        // nuking the viewer room mid-feed just unsubscribes and replays the flash loop
        if (this.isMirror()) {
          this.streamAttachAttempts = 0
          return
        }
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
    window.removeEventListener('online', this.onlineReconnectHandler)
    this.onlineReconnectWired = false
    if (this.mirrorRefreshTimer) clearTimeout(this.mirrorRefreshTimer)
    this.mirrorRefreshTimer = null
    if (this.guestJwtRefreshInterval) clearInterval(this.guestJwtRefreshInterval)
    this.guestJwtRefreshInterval = null
    this.stopMilestonePoll()
    this.stopViewerRetry()
    this.stopStreamAttachRetry()
    this.viewerRoomFull = false
    this.closeAnglePanel()
    this.stopIntermissionCard()
    if (this.intermissionStatusInterval) {
      clearInterval(this.intermissionStatusInterval)
      this.intermissionStatusInterval = null
    }
    this.stopMeshLetterbox()
    this.screenMaterial?.dispose(true, true)
    this.screenMaterial = null
    this.stopAngleBroadcast(true)
    this.livekitRoom?.disconnect()
    this.livekitRoom = null
    this.stopStreamVolumePoll()
    this.stopCohostComposite()
    this.stopBroadcast(true)
    this.dismissBroadcastPanel()
    this.clearBroadcastDockUi()
    this.hostJoinLoginPending = false
    unduckRadio(this)
  }

  // a plain mirror shows whatever the primary showbox is showing, so it reflects the primary's
  // intermission. the primary (and angle mirrors) use their own flag.
  effectiveIntermission(): ShowboxIntermission | null {
    if (this.isMirror() && !this.isAngleMirror()) {
      return (this.parcel.primaryShowbox() as Showbox | undefined)?.intermission ?? null
    }
    return this.intermission
  }

  isIntermissionActive() {
    return !!this.effectiveIntermission()
  }

  // mm:ss until `until`, or '' when there's no countdown. holds at "starting now" past zero - the
  // host flips back manually, we never auto-reveal onto an empty chair.
  intermissionCountdownLabel(until: number | null) {
    if (!until) return ''
    const ms = until - Date.now()
    if (ms <= 0) return 'starting now'
    const total = Math.ceil(ms / 1000)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // broadcaster raises the screen: mute the mic, broadcast the flag, draw the card. the camera keeps
  // running underneath (the card material just covers it) - muting the livekit camera track ends the
  // MediaStreamTrack and trips the "camera lost" health teardown, so we don't.
  raiseIntermission(label: string, untilMs: number | null) {
    if (!this.broadcastRoom) return
    const at = Date.now()
    this.intermission = { label, until: untilMs, at }
    try {
      this.intermissionPrevMic = !!this.broadcastRoom.localParticipant.isMicrophoneEnabled
    } catch {
      this.intermissionPrevMic = false
    }
    try {
      void this.broadcastRoom.localParticipant.setMicrophoneEnabled(false)
    } catch {}
    try {
      this.parcel.sendStatePatch({ [this.uuid]: { intermission: { label, until: untilMs, at } } })
    } catch {}
    this.drawIntermissionCard()
    this.refreshParcelMirrors()
  }

  // broadcaster drops the screen: clear the flag, restore the mic to whatever it was, let the normal
  // reconcile repaint the live feed (the camera never stopped, so it comes back instantly).
  dropIntermission() {
    if (!this.intermission) return
    this.intermission = null
    this.stopIntermissionCard()
    if (this.intermissionStatusInterval) {
      clearInterval(this.intermissionStatusInterval)
      this.intermissionStatusInterval = null
    }
    try {
      void this.broadcastRoom?.localParticipant.setMicrophoneEnabled(this.intermissionPrevMic)
    } catch {}
    try {
      this.parcel.sendStatePatch({ [this.uuid]: { intermission: null } })
    } catch {}
    this.hasActiveVideo = false
    if (this.broadcastRoom && this.isCohostMode()) {
      // cohost shows (the default) render a composite, not a single element - force it back onto the mesh
      this.cohostCompositeAttached = false
      this.updateCohostComposite()
    } else if (this.broadcastRoom && this.localBroadcastVideoEl) {
      this.attachVideoToMesh(this.localBroadcastVideoEl, true)
    } else {
      this.setPreview()
    }
    this.refreshParcelMirrors()
  }

  stopIntermissionCard() {
    if (this.intermissionRaf) {
      cancelAnimationFrame(this.intermissionRaf)
      this.intermissionRaf = null
    }
    this.intermissionCanvas = null
  }

  // the animated standby card. the motion (sweep bar + pulsing dots) is the whole point: it proves the
  // stream is alive even though the camera is hidden. one raf reads the live flag/clock each frame, so
  // repeated calls are a no-op rather than a rebuild/flicker.
  drawIntermissionCard() {
    if (this.disposed || !this.mesh) return
    if (!this.effectiveIntermission()) return
    if (this.intermissionRaf) return
    this.stopMeshLetterbox()
    this.hasActiveVideo = false
    const { w, h } = this.meshVideoSize()
    if (!this.intermissionCanvas) this.intermissionCanvas = document.createElement('canvas')
    const canvas = this.intermissionCanvas
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const tex = new BABYLON.DynamicTexture(this.uniqueEntityName('texture'), canvas, this.scene, false)
    tex.hasAlpha = false
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = tex
    material.backFaceCulling = false
    material.zOffset = -4
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 1, 1)
    material.blockDirtyMechanism = true
    this.swapScreenMaterial(material)
    let frame = 0
    const tick = () => {
      if (this.disposed || !this.mesh) {
        this.stopIntermissionCard()
        return
      }
      const cur = this.effectiveIntermission()
      if (!cur) {
        this.stopIntermissionCard()
        return
      }
      frame++
      ctx.fillStyle = '#0d0d0d'
      ctx.fillRect(0, 0, w, h)
      // sweep bar travelling left-to-right under the title
      const barW = w * 0.5
      const x = ((frame * 2) % (w + barW)) - barW
      const grad = ctx.createLinearGradient(x, 0, x + barW, 0)
      grad.addColorStop(0, 'rgba(220,30,30,0)')
      grad.addColorStop(0.5, 'rgba(220,30,30,0.55)')
      grad.addColorStop(1, 'rgba(220,30,30,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, h * 0.5 + 30, w, 4)
      // three pulsing dots
      for (let i = 0; i < 3; i++) {
        const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(frame * 0.08 - i * 0.7))
        ctx.fillStyle = `rgba(245,245,240,${a})`
        ctx.beginPath()
        ctx.arc(w / 2 - 16 + i * 16, h * 0.5 + 56, 4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#f5f5f0'
      ctx.font = 'bold 28px "Source Code Pro", monospace'
      ctx.fillText(cur.label || 'starting soon', w / 2, h * 0.5 - 16)
      const countdown = this.intermissionCountdownLabel(cur.until)
      if (countdown) {
        ctx.font = '20px "Source Code Pro", monospace'
        ctx.fillStyle = '#f5b942'
        ctx.fillText(countdown, w / 2, h * 0.5 + 10)
      }
      tex.update()
      this.intermissionRaf = requestAnimationFrame(tick)
    }
    tick()
  }

  // small setup dialog (modelled on the second-camera panel): pick a message + optional countdown,
  // then raise. coming back is a single tap on the dock button - no dialog.
  openIntermissionPanel(onConfirm: (label: string, untilMs: number | null) => void) {
    exitPointerLock()
    const panel = document.createElement('div')
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
    title.textContent = 'take a break'
    title.style.fontWeight = 'bold'
    title.style.fontSize = mobile ? '16px' : '14px'

    const inputStyle: Record<string, string> = { width: '100%', background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: mobile ? '10px' : '6px' }
    if (mobile) Object.assign(inputStyle, { fontSize: '16px', minHeight: '44px' })

    // pre-filled with the common case; type over it for "starting soon" or anything else.
    const msgInput = document.createElement('input')
    msgInput.type = 'text'
    msgInput.value = 'be right back'
    msgInput.maxLength = 40
    Object.assign(msgInput.style, inputStyle)

    const minInput = document.createElement('input')
    minInput.type = 'number'
    minInput.min = '1'
    minInput.placeholder = 'minutes until start (optional)'
    Object.assign(minInput.style, inputStyle)

    const go = document.createElement('button')
    go.type = 'button'
    go.textContent = 'raise'
    Object.assign(go.style, { background: 'var(--red)', color: '#fff', border: '0', padding: mobile ? '12px' : '8px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold' })
    go.onclick = () => {
      const mins = parseFloat(minInput.value)
      const untilMs = !isNaN(mins) && mins > 0 ? Date.now() + mins * 60_000 : null
      panel.remove()
      if (mobile) refreshMobileCanvasAfterReturn()
      onConfirm(msgInput.value.trim() || 'be right back', untilMs)
    }

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'cancel'
    Object.assign(cancel.style, { background: 'transparent', color: '#888', border: '0', padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' })
    cancel.onclick = () => {
      panel.remove()
      if (mobile) refreshMobileCanvasAfterReturn()
    }

    panel.append(title, msgInput, minInput, go, cancel)
    document.body.appendChild(panel)
  }

  setPreview() {
    if (this.disposed) return
    if (this.isIntermissionActive()) {
      this.drawIntermissionCard()
      return
    }
    if (this.broadcastRoom && this.localBroadcastVideoEl) {
      this.attachVideoToMesh(this.localBroadcastVideoEl, true)
      return
    }
    if (this.broadcastRoom) return
    if (this.hasActiveVideo) return
    // the stream is gone - stop the letterbox raf or it keeps uploading the dead frame forever
    this.stopMeshLetterbox()
    const { w, h } = this.meshVideoSize()
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
      ctx.fillText('second screen', w / 2, h / 2 - 20)
      const cta = '\u25CF broadcast to this mirror'
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
      ctx.fillText('second screen', w / 2, h / 2)
    } else if (this.isMirror()) {
      ctx.fillStyle = '#888'
      ctx.fillText('showbox screen mirror', w / 2, h / 2)
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

    this.swapScreenMaterial(material)
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

    this.swapScreenMaterial(material)
  }

  async connectViewer() {
    if (this.livekitRoom || this.viewerConnecting) return
    const gen = ++this.viewerConnectGen
    this.viewerConnecting = true
    const res = await fetchShowboxRoomToken(showboxRoomTokenUrl(this.roomName()))
    if (!res?.token || this.disposed) {
      this.viewerConnecting = false
      if (this.needsViewerRoom()) this.scheduleViewerRetry()
      return
    }

    const room = new Room()
    this.livekitRoom = room
    this.wireViewerRoom(room)

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (this.livekitRoom !== room) return
      const identity = participant?.identity ?? ''
      if (track.kind === Track.Kind.Video && this.isAngleTrackName(_pub?.trackName)) {
        if (this.isAngleMirror() && _pub.trackName === this.uuid) this.refreshAngleVideo()
        return // angle feeds only land on their matching mirror
      }
      if (this.broadcastRoom) {
        if (this.isCohostMode() && track.kind === Track.Kind.Audio && this.shouldPlayCohostAudio(identity)) {
          this.syncExistingCohostAudio()
          return
        }
        if (this.isCohostMode() && track.kind === Track.Kind.Video) {
          this.routeCohostVideo(track, identity)
          return
        }
        return
      }
      if (!this.streamTargetsThisShowbox()) {
        if (this.mirrorsActiveStream() && track.kind === Track.Kind.Video) this.scheduleMirrorRefresh()
        return
      }
      if (track.kind === Track.Kind.Audio) {
        if (!wantsAudio()) return
        const el = track.attach() as HTMLAudioElement
        el.style.display = 'none'
        document.body.appendChild(el)
        this.trackStreamAudio(el, identity)
        duckRadio(this)
        this.startBroadcastAudio()
        return
      }
      if (track.kind === Track.Kind.Video) {
        if (this.isCohostMode()) {
          this.routeCohostVideo(track, identity)
        } else {
          const pick = this.pickVideoSource(false)
          if (pick) this.attachVideoToMesh(this.attachedVideoEl(pick.track), true)
        }
        this.startBroadcastAudio()
        this.stopStreamAttachRetry()
        this.refreshParcelMirrors()
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
        if (track.kind === Track.Kind.Video) this.scheduleMirrorRefresh()
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
        unduckRadio(this)
      }
      if (track.kind === Track.Kind.Video) {
        if (this.isCohostMode()) {
          this.clearCohostVideoForIdentity(identity)
          this.updateCohostComposite()
        } else {
          const pick = this.pickVideoSource(false)
          if (pick) {
            this.attachVideoToMesh(this.attachedVideoEl(pick.track), true)
          } else if (!this.hasRemoteBroadcaster()) {
            this.hasActiveVideo = false
            if (!this.broadcastRoom) this.setPreview()
          }
        }
        this.refreshParcelMirrors()
        return
      }
      if (!this.broadcastRoom && !this.hasActiveVideo) this.setPreview()
    })

    room.on(RoomEvent.AudioPlaybackStatusChanged, (playing) => {
      if (playing) {
        duckRadio(this)
      } else {
        this.armGestureUnblock()
      }
    })

    room.on(RoomEvent.ParticipantConnected, () => {
      if (this.livekitRoom !== room) return
      if (this.broadcastRoom && this.isCohostMode()) {
        this.syncExistingCohostVideos()
        this.syncExistingCohostAudio()
        this.updateCohostComposite()
      } else if (!this.broadcastRoom) {
        this.tryAttachExistingStream()
      }
      this.setPreview()
    })
    room.on(RoomEvent.ParticipantDisconnected, () => {
      if (this.livekitRoom !== room) return
      if (this.isMirror()) {
        this.scheduleMirrorRefresh()
        return
      }
      if (this.isCohostMode()) {
        this.updateCohostComposite()
        this.ensureShowboxLiveFlag()
      }
      if (!this.hasActiveVideo) this.setPreview()
      this.refreshParcelMirrors()
    })

    try {
      await room.connect(LIVEKIT_URL, res.token)
      this.viewerRoomFull = false
      this.viewerReconnectAttempts = 0
      this.viewerDisconnectStrikes = 0
      this.viewerReconnecting = false
      this.stopViewerRetry()
    } catch (e) {
      room.disconnect()
      this.livekitRoom = null
      if (isRoomFullError(e)) {
        this.viewerRoomFull = true
      }
      if (this.needsViewerRoom()) this.scheduleViewerRetry()
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
    if (!this.livekitRoom || !wantsAudio()) return
    this.livekitRoom.startAudio().catch(() => {})
    duckRadio(this)
  }

  unblockAudiencePlayback() {
    if (this.broadcastRoom) return
    // tapping a plain mirror should unblock the show's audio - that lives on the primary's room
    if (this.isMirror() && !this.isAngleMirror()) {
      const primary = this.parcel.primaryShowbox() as Showbox | undefined
      if (primary && primary !== this) primary.unblockAudiencePlayback()
      this.refreshMirrorVideo()
      return
    }
    if (!this.livekitRoom) return
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

  stopMeshLetterbox() {
    if (this.meshLetterboxRaf) {
      cancelAnimationFrame(this.meshLetterboxRaf)
      this.meshLetterboxRaf = null
    }
    this.meshLetterboxCanvas = null
  }

  // babylon does not refcount replaced materials/textures - dispose the previous screen
  // material we made (never the mesh's original one) or every preview/attach leaks GPU memory.
  screenMaterial: BABYLON.Material | null = null
  swapScreenMaterial(material: BABYLON.Material) {
    const old = this.screenMaterial
    this.screenMaterial = material
    if (this.mesh) this.mesh.material = material
    if (old && old !== material) old.dispose(true, true)
  }

  attachVideoToMesh(el: HTMLVideoElement, muted = false, retries = 0) {
    if (!this.mesh) {
      if (retries < 30) requestAnimationFrame(() => this.attachVideoToMesh(el, muted, retries + 1))
      return
    }
    // standby card outranks any live feed on the mesh - every video repaint funnels through here.
    if (this.isIntermissionActive()) {
      this.drawIntermissionCard()
      return
    }
    el.muted = muted
    el.autoplay = true
    el.play().catch(() => {})

    this.hasActiveVideo = true
    this.stopMeshLetterbox()

    const applyMaterial = (tex: BABYLON.BaseTexture) => {
      const mat = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
      mat.diffuseTexture = tex
      mat.backFaceCulling = false
      mat.zOffset = -4
      mat.specularColor.set(0, 0, 0)
      mat.emissiveColor.set(1, 1, 1)
      mat.blockDirtyMechanism = true
      this.swapScreenMaterial(mat)
    }

    const attachDirect = () => {
      const tex = new BABYLON.VideoTexture(this.uniqueEntityName('texture'), el, this.scene, false, false)
      tex.hasAlpha = false
      applyMaterial(tex)
    }

    const attachCovered = () => {
      if (!this.meshLetterboxCanvas) this.meshLetterboxCanvas = document.createElement('canvas')
      const canvas = this.meshLetterboxCanvas
      const { w: outW, h: outH } = this.meshVideoSize()
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        attachDirect()
        return
      }
      const tex = new BABYLON.DynamicTexture(this.uniqueEntityName('texture'), canvas, this.scene, false)
      tex.hasAlpha = false
      applyMaterial(tex)
      const tick = () => {
        if (this.disposed || !this.mesh) return
        ctx.fillStyle = '#0d0d0d'
        ctx.fillRect(0, 0, outW, outH)
        if (el.videoWidth > 0 && el.videoHeight > 0) drawVideoCover(ctx, el, 0, 0, outW, outH)
        tex.update()
        this.meshLetterboxRaf = requestAnimationFrame(tick)
      }
      tick()
    }

    const pickMode = () => {
      attachCovered()
    }
    if (el.videoWidth > 0) pickMode()
    else el.addEventListener('loadedmetadata', pickMode, { once: true })
  }

  startThumbCapture(videoEl?: HTMLVideoElement) {
    if (this.thumbInterval) {
      clearInterval(this.thumbInterval)
      this.thumbInterval = null
    }
    if (!this.thumbCanvas) {
      this.thumbCanvas = document.createElement('canvas')
      this.thumbCanvas.width = THUMB_W
      this.thumbCanvas.height = THUMB_H
    }
    const canvas = this.thumbCanvas
    const ctx = canvas.getContext('2d')!
    const room = this.roomName()
    const id = this.parcel.id
    const parcel = { id, name: this.parcel.name, address: this.parcel.address }
    this.thumbInterval = setInterval(() => {
      try {
        if (this.isIntermissionActive()) {
          // on a break the homepage should show the standby card, not the hidden camera
          ctx.fillStyle = '#0d0d0d'
          ctx.fillRect(0, 0, THUMB_W, THUMB_H)
          if (this.intermissionCanvas) drawVideoCover(ctx, this.intermissionCanvas, 0, 0, THUMB_W, THUMB_H)
        } else if (this.isCohostMode()) {
          if (!this.cohostCanvas) {
            this.cohostCanvas = document.createElement('canvas')
            const { w: cw, h: ch } = this.meshVideoSize()
            this.cohostCanvas.width = cw
            this.cohostCanvas.height = ch
          }
          if (!this.drawCohostFrame()) return
          ctx.fillStyle = '#0d0d0d'
          ctx.fillRect(0, 0, THUMB_W, THUMB_H)
          drawVideoCover(ctx, this.cohostCanvas, 0, 0, THUMB_W, THUMB_H)
        } else if (videoEl) {
          ctx.fillStyle = '#0d0d0d'
          ctx.fillRect(0, 0, THUMB_W, THUMB_H)
          drawVideoCover(ctx, videoEl, 0, 0, THUMB_W, THUMB_H)
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
    // done broadcasting: hand the voice mic back to the avatar and bring the soundtrack back
    window.persona?.voiceChat?.setBroadcasting(false)
    setRadioBroadcasting(false)
    window._audio?.setBroadcasting(false)
    this.liveChatAnnounced = false
    this.walkAwayWarned = false
    this.stopMilestonePoll()
    const othersLive = this.hasOtherLivePublishers()
    if (this.fxAutoTimer) {
      clearTimeout(this.fxAutoTimer)
      this.fxAutoTimer = null
    }
    if (this.broadcastFxProcessor) {
      void this.broadcastFxProcessor.destroy?.()
      this.broadcastFxProcessor = null
    }
    if (this.intermission) this.intermission = null
    this.stopIntermissionCard()
    if (this.intermissionStatusInterval) {
      clearInterval(this.intermissionStatusInterval)
      this.intermissionStatusInterval = null
    }
    try {
      const patch: Record<string, any> = { [this.uuid]: { intermission: null } }
      // only a real broadcaster clears the live flag; audience teardown must not nuke it for everyone
      if (this.broadcastRoom && this.activeLiveShowboxUuid() === this.uuid && !othersLive) patch.__showbox_live = null
      this.parcel.sendStatePatch(patch)
    } catch {}
    this.stopThumbCapture(silent)
    this.clearCohostMonitor()
    this.broadcastRoom?.disconnect()
    this.broadcastRoom = null
    this.broadcastLiveTracks = null
    this.broadcastLiveVideoTrack = null
    this.broadcastLiveAudioTrack = null
    this.broadcastReconnecting = false
    this.broadcastReconnectAttempts = 0
    this.broadcastDisconnectStrikes = 0
    this.broadcastCameraLost = false
    this.cameraHealthStrikes = 0
    if (this.cameraEndedTimer) {
      clearTimeout(this.cameraEndedTimer)
      this.cameraEndedTimer = null
    }
    this.viewerReconnectAttempts = 0
    this.viewerDisconnectStrikes = 0
    this.viewerReconnecting = false
    // ending your session also drops any second-camera feeds you pushed to sibling angle mirrors
    for (const b of this.parcel.getFeaturesByType('showbox') as any[]) {
      if (b?.angleVideoTrack) b.stopAngleBroadcast()
    }
    this.localBroadcastVideoEl = null
    this.hasActiveVideo = false
    this.cohostCompositeAttached = false
    this.syncCohostPreview = null
    unduckRadio(this)
    if (this.liveTimerInterval) {
      clearInterval(this.liveTimerInterval)
      this.liveTimerInterval = null
    }
    this.liveStartedAt = null
    broadcastLiveStartedAt.value = undefined
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

  openBroadcastPanel(openOnly = false) {
    if (this.isMirror()) return
    if (this.broadcastPanel) {
      if (openOnly) return
      this.dismissBroadcastPanel()
      this.stopBroadcast()
      this.clearBroadcastDockUi()
      return
    }

    if ((wantsHostJoin(this.uuid) || isGuestForShowbox(this.uuid)) && !this.joinDockAutoOpened) {
      this.joinDockAutoOpened = true
      clearShowboxJoinParams()
    }

    exitPointerLock()

    const isGuest = isGuestForShowbox(this.uuid)
    const syntheticGuest = isGuest && isSyntheticGuestWallet()
    if (syntheticGuest) consumeGuestFreshFromUrl((n) => app.setName(n))

    const panel = document.createElement('div')
    this.broadcastPanel = panel
    // mobile setup = full screen dock. mobile live defaults to large self-feed; toggle reveals voxels above.
    const MOBILE_WORLD_VIEW = '36vh'
    let mobileShowWorld = false
    let liveViewerCount = 0
    let mobilePreviewWrap: HTMLDivElement | null = null
    let mobilePreviewVideo: HTMLVideoElement | null = null
    let syncMobilePreview: (() => void) | null = null
    let clearMobileBroadcastHooks: (() => void) | null = null
    let mobileWorldBtn: HTMLButtonElement | null = null
    const refreshMobileWorldBtn = () => {
      if (!mobileWorldBtn) return
      mobileWorldBtn.textContent = mobileShowWorld ? 'see your feed' : viewerCountLabel(liveViewerCount)
    }
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
        refreshMobileWorldBtn()
      } else {
        panel.style.inset = '0'
        panel.style.top = '0'
        panel.style.left = '0'
        panel.style.right = '0'
        panel.style.bottom = '0'
        if (mobilePreviewWrap) mobilePreviewWrap.style.display = 'block'
        if (mobileStreamHint) mobileStreamHint.style.display = 'none'
        refreshMobileWorldBtn()
      }
      if (mobileWorldBtn) mobileWorldBtn.style.display = 'block'
      panel.style.overflow = live ? 'hidden' : 'auto'
      if (live) {
        panel.style.padding = '0.75rem'
        panel.style.paddingBottom = 'max(6px, env(safe-area-inset-bottom))'
        panel.style.minHeight = '0'
      }
    }
    const setDesktopDockLayout = (live: boolean) => {
      if (mobile) return
      if (this.broadcastPanelSidebar) {
        panel.style.width = '100%'
        panel.style.maxHeight = 'none'
        panel.style.top = 'auto'
        panel.style.right = 'auto'
        panel.style.left = 'auto'
        panel.style.transform = 'none'
        return
      }
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
      mobileWorldBtn.textContent = viewerCountLabel(0)
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
        const cam = window.connector?.controls?.camera
        if (cam) {
          // host spawns facing the screen; audience stands further out in the opposite direction
          const yaw = this.rotation.y + (mobileShowWorld ? Math.PI : 0)
          setCameraRotation(this.scene, new BABYLON.Vector3(cam.rotation.x, yaw, cam.rotation.z))
        }
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
    const audioModeLabel = document.createElement('label')
    audioModeLabel.textContent = "what's your room like?"
    const audioModeSel = document.createElement('select')
    Object.assign(audioModeSel.style, { width: '100%', background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: '4px' })
    let audioMode: ShowboxAudioMode = 'voice'
    for (const opt of SHOWBOX_ROOM_OPTIONS) {
      const o = document.createElement('option')
      o.value = opt.value
      o.textContent = opt.label
      audioModeSel.appendChild(o)
    }
    const audioModeHint = document.createElement('small')
    audioModeHint.textContent = showboxRoomHint(audioMode)
    Object.assign(audioModeHint.style, { color: '#888', display: 'block' })
    audioModeSel.onchange = () => {
      audioMode = audioModeSel.value as ShowboxAudioMode
      audioModeHint.textContent = showboxRoomHint(audioMode)
    }
    if (mobile) {
      Object.assign(camSel.style, { fontSize: '16px', minHeight: '44px', padding: '8px' })
      Object.assign(micSel.style, { fontSize: '16px', minHeight: '44px', padding: '8px' })
      Object.assign(audioModeSel.style, { fontSize: '16px', minHeight: '44px', padding: '8px' })
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

    // "open with a 'starting soon' screen": go live straight into the standby card so the audience
    // gathers behind it before the show starts. Checking it reveals the message + countdown fields.
    const standbyFieldStyle: Record<string, string> = { width: '100%', background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: mobile ? '10px' : '6px' }
    if (mobile) Object.assign(standbyFieldStyle, { fontSize: '16px', minHeight: '44px' })
    const standbyOpt = document.createElement('label')
    Object.assign(standbyOpt.style, { display: 'flex', alignItems: 'center', gap: '6px' })
    const standbyChk = document.createElement('input')
    standbyChk.type = 'checkbox'
    standbyOpt.append(standbyChk, " open with a 'starting soon' screen")
    const standbyConfig = document.createElement('div')
    Object.assign(standbyConfig.style, { display: 'none', flexDirection: 'column', gap: '4px', paddingLeft: mobile ? '0' : '22px' })
    const standbyMsgInput = document.createElement('input')
    standbyMsgInput.type = 'text'
    standbyMsgInput.value = 'starting soon'
    standbyMsgInput.maxLength = 40
    Object.assign(standbyMsgInput.style, standbyFieldStyle)
    const standbyMinInput = document.createElement('input')
    standbyMinInput.type = 'number'
    standbyMinInput.min = '1'
    standbyMinInput.placeholder = 'minutes until start (optional)'
    Object.assign(standbyMinInput.style, standbyFieldStyle)
    standbyConfig.append(standbyMsgInput, standbyMinInput)
    standbyChk.onchange = () => {
      standbyConfig.style.display = standbyChk.checked ? 'flex' : 'none'
    }

    const deviceRow = document.createElement('div')
    Object.assign(deviceRow.style, { display: 'flex', flexDirection: 'column', gap: '4px' })
    if (mobile) {
      camLabel.style.display = 'block'
      micLabel.style.display = 'block'
      audioModeLabel.style.display = 'block'
    }
    deviceRow.append(camLabel, camSel, micLabel, micSel, audioModeLabel, audioModeSel, audioModeHint)

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
    this.mobileFlipFacing = 'user'
    const cameraReconnectBtn = document.createElement('button')
    cameraReconnectBtn.type = 'button'
    cameraReconnectBtn.textContent = 'reconnect camera'
    Object.assign(cameraReconnectBtn.style, {
      display: 'none',
      background: 'var(--red)',
      color: '#fff',
      border: '0',
      padding: mobile ? '8px 12px' : '6px 10px',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: mobile ? '14px' : '12px',
      fontWeight: 'bold',
      width: mobile ? '100%' : 'auto',
      minHeight: mobile ? '40px' : '32px',
    })
    cameraReconnectBtn.onclick = () => void this.tryResumeCamera()
    this.broadcastCameraReconnectBtn = cameraReconnectBtn
    const flipBtn = document.createElement('button')
    flipBtn.type = 'button'
    flipBtn.textContent = 'flip camera'
    Object.assign(flipBtn.style, {
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
    flipBtn.onclick = async () => {
      if (!this.broadcastRoom || !liveVideoTrack) return
      flipFacing = flipFacing === 'user' ? 'environment' : 'user'
      this.mobileFlipFacing = flipFacing
      await liveVideoTrack.restartTrack(showboxMobileCameraConstraints(flipFacing)).catch(() => {})
      this.wireCameraEndedListener(liveVideoTrack)
      if (this.broadcastRoom) this.noteCameraHealthy(this.broadcastRoom)
      this.syncBroadcastVideoFromTrack(liveVideoTrack)
      requestAnimationFrame(() => this.syncBroadcastVideoFromTrack(liveVideoTrack))
    }

    // livekit mutes/unmutes the published mic without killing video. screenshare starts muted; camera starts on.
    let micOn = false
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
    const syncMicToggle = () => {
      if (!micOn) {
        micToggle.textContent = screenChk.checked ? 'turn on mic' : 'unmute mic'
        micToggle.style.color = '#888'
        return
      }
      micToggle.textContent = 'mute mic'
      micToggle.style.color = '#f5f5f0'
    }
    micToggle.onclick = async () => {
      if (!this.broadcastRoom) return
      micOn = !micOn
      micToggle.disabled = true
      // mic is already published at go-live - deviceId on unmute can open a second audio track (echo).
      // when there never was a mic, publish with the chosen room preset, not livekit defaults.
      const micOpts = micOn && !liveAudioTrack ? showboxAudioConstraints(audioMode, micSel.value || undefined) : undefined
      await this.broadcastRoom.localParticipant.setMicrophoneEnabled(micOn, micOpts).catch(() => (micOn = !micOn))
      micToggle.disabled = false
      syncMicToggle()
    }

    // Name row only for anonymous guests on /live/ links. Signed-in users keep their account name.
    const guestToken = syntheticGuest ? guestPassToken() : null
    let guestNameInput: HTMLInputElement | null = null
    let identityRow: HTMLDivElement | null = null
    if (syntheticGuest && guestToken) {
      identityRow = document.createElement('div')
      Object.assign(identityRow.style, { display: 'flex', flexDirection: 'column', gap: '4px' })
      const identityLabel = document.createElement('label')
      identityLabel.textContent = 'Name'
      const nameInput = document.createElement('input')
      guestNameInput = nameInput
      nameInput.type = 'text'
      nameInput.value = ''
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
      const copyBtnLabel = 'copy'
      const xBtn = document.createElement('button')
      xBtn.textContent = 'post on x'
      Object.assign(xBtn.style, { background: '#333', color: '#f5f5f0', border: '0', padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', flex: '1', minHeight: '36px' })
      const wireDesktopShareActions = (getKind: () => 'fan' | 'guest', getUrl: () => string) => {
        copyBtn.onclick = async () => {
          let url = getUrl().trim()
          if (getKind() === 'guest') {
            shareInput.value = 'loading guest link...'
            const guestUrl = await this.resolveGuestShareUrl()
            if (!guestUrl) {
              shareInput.value = showUrl
              return
            }
            shareInput.value = guestUrl
            url = guestUrl
          }
          if (!url || url.startsWith('loading')) return
          navigator.clipboard.writeText(url).catch(() => {})
          copyBtn.textContent = 'copied'
          setTimeout(() => (copyBtn.textContent = copyBtnLabel), 1500)
        }
        xBtn.onclick = async () => {
          let url = getUrl().trim()
          if (getKind() === 'guest') {
            const guestUrl = await this.resolveGuestShareUrl()
            if (!guestUrl) return
            url = guestUrl
            shareInput.value = guestUrl
          }
          if (!url || url.startsWith('loading')) return
          const text = getKind() === 'guest' ? `Join my show on camera in voxels: ${url}` : `Going live in voxels - Teleport in! ${url}`
          window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
        }
      }
      const runMobileShare = async (kind: 'fan' | 'guest') => {
        if (kind === 'guest') {
          const guestUrl = await this.resolveGuestShareUrl()
          if (!guestUrl) {
            if (!this.canManageGuestPasses()) app.showSnackbar('no guest link yet - ask someone with edit access', PanelType.Warning)
            return
          }
          await this.shareShowUrl(guestUrl, `Join my show on camera in voxels: ${guestUrl}`)
          return
        }
        await this.shareShowUrl(showUrl, `Going live in voxels - Teleport in! ${showUrl}`)
      }
      const shareBtn = document.createElement('button')
      shareBtn.textContent = 'share'
      Object.assign(shareBtn.style, { background: '#333', color: '#f5f5f0', border: '0', padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', flex: '1', minHeight: '36px' })
      shareBtn.onclick = () => void runMobileShare('fan')
      shareBtnRow.append(copyBtn)
      if (!mobile) shareBtnRow.append(xBtn)
      shareLabel.style.display = 'block'
      if (mobile) {
        Object.assign(shareRow.style, { padding: '4px 0', borderTop: '1px solid #222', borderBottom: 'none', gap: '2px' })
        if (this.parcel.canEdit) {
          let shareLinkKind: 'fan' | 'guest' = 'fan'
          const shareSplit = document.createElement('div')
          Object.assign(shareSplit.style, { display: 'flex', width: '100%', position: 'relative' })
          const shareMainBtn = document.createElement('button')
          const sharePickBtn = document.createElement('button')
          const sharePickMenu = document.createElement('div')
          const btnBase = { background: 'var(--red)', color: '#f5f5f0', border: '0', cursor: 'pointer', fontFamily: 'inherit', minHeight: '32px' as const }
          const syncShareLabel = () => {
            shareMainBtn.textContent = shareLinkKind === 'fan' ? 'share fan link' : 'share co-host link'
          }
          const closeSharePickMenu = () => {
            sharePickMenu.style.display = 'none'
          }
          const pickShareKind = (kind: 'fan' | 'guest') => {
            shareLinkKind = kind
            syncShareLabel()
            closeSharePickMenu()
          }
          Object.assign(shareMainBtn.style, { ...btnBase, flex: '1', fontWeight: 'bold', padding: '6px 8px' })
          Object.assign(sharePickBtn.style, { ...btnBase, padding: '6px 12px', borderLeft: '1px solid rgba(245, 245, 240, 0.45)', flexShrink: '0', minWidth: '40px' })
          sharePickBtn.textContent = 'v'
          sharePickBtn.title = 'pick fan or guest link'
          Object.assign(sharePickMenu.style, {
            display: 'none',
            flexDirection: 'column',
            position: 'absolute',
            bottom: '100%',
            left: '0',
            right: '0',
            background: '#1a1a1a',
            border: '1px solid #333',
            marginBottom: '2px',
            zIndex: '5',
          })
          const fanPick = document.createElement('button')
          fanPick.type = 'button'
          fanPick.textContent = 'fan link - for people watching'
          Object.assign(fanPick.style, { background: '#1a1a1a', color: '#f5f5f0', border: '0', borderBottom: '1px solid #333', padding: '8px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', minHeight: '32px' })
          fanPick.onclick = () => pickShareKind('fan')
          const guestPick = document.createElement('button')
          guestPick.type = 'button'
          guestPick.textContent = 'co-host link - for your DJ or guest on camera'
          Object.assign(guestPick.style, { background: '#1a1a1a', color: '#f5f5f0', border: '0', padding: '8px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', minHeight: '32px' })
          guestPick.onclick = () => pickShareKind('guest')
          sharePickMenu.append(fanPick, guestPick)
          syncShareLabel()
          shareMainBtn.onclick = () => {
            closeSharePickMenu()
            void runMobileShare(shareLinkKind)
          }
          sharePickBtn.onclick = (e) => {
            e.stopPropagation()
            sharePickMenu.style.display = sharePickMenu.style.display === 'none' ? 'flex' : 'none'
          }
          shareSplit.append(shareMainBtn, sharePickBtn, sharePickMenu)
          shareRow.append(shareSplit)
        } else {
          shareBtn.textContent = 'share fan link'
          Object.assign(shareBtn.style, { background: 'var(--red)', fontWeight: 'bold', width: '100%', minHeight: '32px', padding: '6px 8px', fontSize: '12px' })
          shareBtnRow.append(shareBtn)
          shareRow.append(shareBtnRow)
        }
      } else if (this.canManageGuestPasses()) {
        let shareLinkKind: 'fan' | 'guest' = 'fan'
        const shareKindSel = document.createElement('select')
        Object.assign(shareKindSel.style, {
          width: '100%',
          background: '#1a1a1a',
          color: '#888',
          border: '1px solid #333',
          padding: '4px',
          fontFamily: 'inherit',
        })
        const fanOpt = document.createElement('option')
        fanOpt.value = 'fan'
        fanOpt.textContent = 'fan link - for people watching'
        const guestOpt = document.createElement('option')
        guestOpt.value = 'guest'
        guestOpt.textContent = 'co-host link - for your DJ or guest on camera'
        shareKindSel.append(fanOpt, guestOpt)
        const syncShareUrl = async () => {
          if (shareLinkKind === 'fan') {
            shareInput.value = showUrl
            return
          }
          shareInput.value = 'loading guest link...'
          const guestUrl = await this.resolveGuestShareUrl()
          if (!guestUrl) {
            shareLinkKind = 'fan'
            shareKindSel.value = 'fan'
            shareInput.value = showUrl
            return
          }
          shareInput.value = guestUrl
        }
        shareKindSel.onchange = () => {
          shareLinkKind = shareKindSel.value === 'guest' ? 'guest' : 'fan'
          void syncShareUrl()
        }
        wireDesktopShareActions(
          () => shareLinkKind,
          () => shareInput.value,
        )
        shareRow.append(shareKindSel, shareInput, shareBtnRow)
      } else {
        wireDesktopShareActions(
          () => 'fan',
          () => showUrl,
        )
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
    // "visual board": tab between the emote reactions and live video FX on the broadcast (desktop only).
    const reactRow = document.createElement('div')
    Object.assign(reactRow.style, { display: 'flex', flexDirection: 'column', gap: '4px' })
    reactRow.append(danceRow, emojiRow)

    let fxTabs: HTMLDivElement | null = null
    let fxRow: HTMLDivElement | null = null
    // solo-mode desktop preview is its own <video> bound to the raw track; captured here so the fx
    // toggle can re-point it to the processed track too (cohost mode's preview is the composite, which
    // already follows). assigned when the desktop preview is built.
    let fxSoloPreviewEl: HTMLVideoElement | null = null
    if (!mobile) {
      const tabStyle = (active: boolean): Record<string, string> => ({
        background: active ? '#333' : '#1a1a1a',
        color: active ? '#f5f5f0' : '#888',
        border: '1px solid #333',
        padding: '6px 10px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        flex: '1',
        minHeight: '32px',
      })
      const emotesTab = document.createElement('button')
      emotesTab.type = 'button'
      emotesTab.textContent = 'emotes'
      Object.assign(emotesTab.style, tabStyle(true))
      const fxTab = document.createElement('button')
      fxTab.type = 'button'
      fxTab.textContent = 'fx'
      Object.assign(fxTab.style, tabStyle(false))
      fxTabs = document.createElement('div')
      Object.assign(fxTabs.style, { display: 'flex', gap: '4px' })
      fxTabs.append(emotesTab, fxTab)

      fxRow = document.createElement('div')
      Object.assign(fxRow.style, { display: 'none', flexDirection: 'column', gap: '6px' })
      const fxHint = document.createElement('small')
      fxHint.textContent = 'live effect on your broadcast - reacts to your audio.'
      fxHint.style.color = '#888'
      // active effect (null = off), palette, per-effect remembered slider positions, and auto-mode state
      let fxActiveKey: string | null = null
      let fxPalette = FX_DEFAULT_PALETTE
      const fxSliderByKey: Record<string, number> = {}
      VIDEO_FX.forEach((f) => (fxSliderByKey[f.key] = f.defaultSlider))
      const MANUAL_FADE_MS = 500
      // auto mode: crossfade through a chosen subset of effects on a hold + fade timer
      let autoOn = false
      const autoSet = new Set<string>()
      let holdMs = 8000
      let fadeMs = 4000

      // palette picker (Voxelator colors) - applies to whichever effect is active
      const paletteSel = document.createElement('select')
      Object.assign(paletteSel.style, { background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: '6px', fontFamily: 'inherit' })
      FX_PALETTES.forEach((p, i) => {
        const o = document.createElement('option')
        o.value = String(i)
        o.textContent = p.label
        paletteSel.appendChild(o)
      })
      paletteSel.onchange = () => {
        fxPalette = FX_PALETTES[parseInt(paletteSel.value, 10) || 0].lut
        this.broadcastFxProcessor?.setPalette(fxPalette)
      }

      // one slider for the active effect's parameter (right = stronger/faster for every effect)
      const slider = document.createElement('input')
      slider.type = 'range'
      slider.min = '0'
      slider.max = '100'
      slider.step = '1'
      slider.value = '50'
      slider.style.width = '100%'
      slider.oninput = () => {
        const v = (parseInt(slider.value, 10) || 50) / 100
        if (fxActiveKey) fxSliderByKey[fxActiveKey] = v // remember it for this effect
        this.broadcastFxProcessor?.setSlider(v)
      }

      const fxGrid = document.createElement('div')
      Object.assign(fxGrid.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' })
      const fxButtons: Record<string, HTMLButtonElement> = {}
      // tile look: the effect on screen is red; in auto mode, effects in the rotation are amber, others dim.
      const refreshTiles = () => {
        Object.entries(fxButtons).forEach(([k, b]) => {
          const showing = k === fxActiveKey
          const inSet = autoSet.has(k)
          b.style.background = showing ? 'var(--red)' : '#1a1a1a'
          if (showing) {
            b.style.color = '#fff'
            b.style.border = '1px solid var(--red)'
          } else if (autoOn) {
            b.style.color = inSet ? '#f5b942' : '#888'
            b.style.border = inSet ? '1px solid #5a4718' : '1px solid #333'
          } else {
            b.style.color = '#f5f5f0'
            b.style.border = '1px solid #333'
          }
        })
      }

      // manual: turn fx on / crossfade between effects / turn off (tap the active one)
      const selectFx = async (key: string) => {
        if (!this.broadcastRoom || !liveVideoTrack) {
          app.showSnackbar('go live first to use fx', PanelType.Warning)
          return
        }
        const turningOff = fxActiveKey === key
        Object.values(fxButtons).forEach((b) => (b.disabled = true))
        try {
          if (turningOff) {
            await liveVideoTrack.stopProcessor()
            this.broadcastFxProcessor = null
            fxActiveKey = null
          } else if (!this.broadcastFxProcessor) {
            this.broadcastFxProcessor = new VideoFxProcessor(() => this.fxAudio)
            this.broadcastFxProcessor.setPalette(fxPalette)
            this.broadcastFxProcessor.setEffect(key)
            this.broadcastFxProcessor.setSlider(fxSliderByKey[key] ?? 0.5)
            await liveVideoTrack.setProcessor(this.broadcastFxProcessor)
            fxActiveKey = key
          } else {
            // crossfade to the new effect on the running processor; restore its remembered slider
            this.broadcastFxProcessor.setEffect(key, MANUAL_FADE_MS)
            this.broadcastFxProcessor.setSlider(fxSliderByKey[key] ?? 0.5)
            fxActiveKey = key
          }
        } catch (e) {
          console.error('showbox: fx toggle failed', e)
          if (this.broadcastFxProcessor) {
            void this.broadcastFxProcessor.destroy?.()
            this.broadcastFxProcessor = null
          }
          fxActiveKey = null
          app.showSnackbar('could not apply effect', PanelType.Warning)
        }
        // turning fx on/off swaps liveVideoTrack.mediaStreamTrack (processed <-> raw); re-point the host's
        // own view so they see what the audience sees (switching effects keeps the same processed track).
        this.syncBroadcastVideoFromTrack(liveVideoTrack)
        requestAnimationFrame(() => this.syncBroadcastVideoFromTrack(liveVideoTrack))
        if (fxSoloPreviewEl) syncVideoElFromTrack(fxSoloPreviewEl, liveVideoTrack)
        Object.values(fxButtons).forEach((b) => (b.disabled = false))
        refreshTiles()
        slider.value = String(Math.round((fxActiveKey ? fxSliderByKey[fxActiveKey] : 0.5) * 100))
      }

      // auto-mode driver: step to the next effect in the rotation, crossfading over `fadeMs`
      const stopAuto = () => {
        if (this.fxAutoTimer) {
          clearTimeout(this.fxAutoTimer)
          this.fxAutoTimer = null
        }
      }
      const autoStep = () => {
        // self-terminate if fx ended or the dock was closed (closure autoOn can't be reached from teardown)
        if (!autoOn || !this.broadcastFxProcessor || !this.broadcastPanel) {
          stopAuto()
          return
        }
        const members = VIDEO_FX.map((f) => f.key).filter((k) => autoSet.has(k))
        if (members.length < 2) {
          this.fxAutoTimer = setTimeout(autoStep, holdMs) // nothing to cross to - just wait
          return
        }
        const curIdx = members.indexOf(fxActiveKey ?? members[0])
        const next = members[(curIdx + 1) % members.length]
        this.broadcastFxProcessor.setEffect(next, fadeMs)
        this.broadcastFxProcessor.setSlider(fxSliderByKey[next] ?? 0.5)
        fxActiveKey = next
        slider.value = String(Math.round((fxSliderByKey[next] ?? 0.5) * 100))
        refreshTiles()
        this.fxAutoTimer = setTimeout(autoStep, holdMs + fadeMs)
      }
      const startAuto = async () => {
        const members = VIDEO_FX.map((f) => f.key).filter((k) => autoSet.has(k))
        if (!this.broadcastFxProcessor && members.length) await selectFx(members[0])
        stopAuto()
        this.fxAutoTimer = setTimeout(autoStep, holdMs)
      }

      // hold + fade sliders (shown only in auto mode)
      const labeledSlider = (label: string, min: number, max: number, val: number, onChange: (s: number) => void) => {
        const wrap = document.createElement('label')
        Object.assign(wrap.style, { display: 'none', alignItems: 'center', gap: '8px', color: '#888', fontSize: '12px' })
        const span = document.createElement('span')
        span.textContent = label
        span.style.minWidth = '32px'
        const r = document.createElement('input')
        r.type = 'range'
        r.min = String(min)
        r.max = String(max)
        r.step = '0.5'
        r.value = String(val)
        r.style.flex = '1'
        const out = document.createElement('span')
        out.style.minWidth = '34px'
        const sync = () => (out.textContent = r.value + 's')
        r.oninput = () => {
          sync()
          onChange(parseFloat(r.value) || val)
        }
        sync()
        wrap.append(span, r, out)
        return wrap
      }
      const holdRow = labeledSlider('hold', 1, 60, 8, (s) => (holdMs = s * 1000))
      const fadeRow = labeledSlider('fade', 0.5, 30, 4, (s) => (fadeMs = s * 1000))

      // auto on/off toggle
      const autoBtn = document.createElement('button')
      autoBtn.type = 'button'
      Object.assign(autoBtn.style, { padding: '8px', cursor: 'pointer', fontFamily: 'inherit', minHeight: '36px', fontWeight: 'bold', border: '1px solid #333' })
      const syncAutoBtn = () => {
        autoBtn.textContent = autoOn ? 'auto: on' : 'auto: off'
        autoBtn.style.background = autoOn ? 'var(--red)' : '#1a1a1a'
        autoBtn.style.color = autoOn ? '#fff' : '#888'
      }
      syncAutoBtn()
      autoBtn.onclick = () => {
        if (!this.broadcastRoom || !liveVideoTrack) {
          app.showSnackbar('go live first to use fx', PanelType.Warning)
          return
        }
        autoOn = !autoOn
        if (autoOn) {
          if (autoSet.size === 0) VIDEO_FX.forEach((f) => autoSet.add(f.key)) // default: cycle all of them
          holdRow.style.display = 'flex'
          fadeRow.style.display = 'flex'
          fxHint.textContent = 'auto: cross-fading the highlighted effects. tap tiles to add/remove.'
          void startAuto()
        } else {
          stopAuto()
          holdRow.style.display = 'none'
          fadeRow.style.display = 'none'
          fxHint.textContent = 'live effect on your broadcast - reacts to your audio.'
        }
        syncAutoBtn()
        refreshTiles()
      }

      VIDEO_FX.forEach((fx) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = fx.label
        Object.assign(b.style, { padding: '10px', cursor: 'pointer', fontFamily: 'inherit', minHeight: '44px', fontWeight: 'bold' })
        b.onclick = () => {
          if (autoOn) {
            // curate the rotation: add/remove this effect
            if (autoSet.has(fx.key)) {
              if (autoSet.size <= 1) return // keep at least one effect in the rotation
              autoSet.delete(fx.key)
              // if we removed the effect currently on screen, cross to a remaining one now so the
              // highlight isn't stuck on a non-member
              if (fxActiveKey === fx.key && this.broadcastFxProcessor) {
                const next = VIDEO_FX.map((f) => f.key).filter((k) => autoSet.has(k))[0]
                if (next) {
                  this.broadcastFxProcessor.setEffect(next, MANUAL_FADE_MS)
                  this.broadcastFxProcessor.setSlider(fxSliderByKey[next] ?? 0.5)
                  fxActiveKey = next
                  slider.value = String(Math.round((fxSliderByKey[next] ?? 0.5) * 100))
                }
              }
            } else {
              autoSet.add(fx.key)
            }
            refreshTiles()
          } else {
            void selectFx(fx.key)
          }
        }
        fxButtons[fx.key] = b
        fxGrid.appendChild(b)
      })
      refreshTiles()

      fxRow.append(fxHint, autoBtn, fxGrid, slider, paletteSel, holdRow, fadeRow)

      const selectTab = (fx: boolean) => {
        reactRow.style.display = fx ? 'none' : 'flex'
        fxRow!.style.display = fx ? 'flex' : 'none'
        Object.assign(emotesTab.style, tabStyle(!fx))
        Object.assign(fxTab.style, tabStyle(fx))
      }
      emotesTab.onclick = () => selectTab(false)
      fxTab.onclick = () => selectTab(true)
    }

    if (fxTabs && fxRow) moveRow.append(fxTabs, reactRow, fxRow)
    else moveRow.append(reactRow)

    const status = document.createElement('div')
    status.style.color = '#888'

    const goBtn = document.createElement('button')
    goBtn.type = 'button'
    goBtn.textContent = 'go live'
    Object.assign(goBtn.style, { background: 'var(--red)', color: '#f5f5f0', border: '0', padding: '12px 16px', cursor: 'pointer', fontFamily: 'inherit', flex: '2', minHeight: '44px', fontWeight: 'bold' })

    // Intermission control. A small secondary button left of "stop streaming" (in both the desktop and
    // mobile docks, since both append `row`), hidden until live. Raise opens the setup dialog; return is
    // one tap. The dock preview stays a live mirror of your camera during standby (so you can check your
    // look) - we just relabel it. The label ref is assigned when the preview is built.
    let intermissionPreviewLabel: HTMLElement | null = null
    // cold-open "starting soon" via the go-live checkbox sets these: standbyStartLabel makes the
    // return button read "start show" instead of "back to live"; pendingStandby is raised once live.
    let standbyStartLabel = false
    let pendingStandby: { label: string; mins: number | null } | null = null
    const intermissionBtn = document.createElement('button')
    intermissionBtn.type = 'button'
    intermissionBtn.textContent = 'take a break'
    Object.assign(intermissionBtn.style, {
      display: 'none',
      background: 'transparent',
      color: '#f5b942',
      border: '1px solid #5a4718',
      padding: mobile ? '10px 12px' : '6px 10px',
      cursor: 'pointer',
      fontFamily: 'inherit',
      flex: '0 0 auto',
      fontSize: mobile ? '14px' : '12px',
      minHeight: mobile ? '44px' : 'auto',
      whiteSpace: 'nowrap',
    })
    const syncIntermissionUi = () => {
      const on = !!this.intermission
      intermissionBtn.textContent = on ? (standbyStartLabel ? 'start show' : 'back to live') : 'take a break'
      // on break the return button fills in (the action to get back on); idle it's a quiet amber outline
      intermissionBtn.style.background = on ? 'var(--red)' : 'transparent'
      intermissionBtn.style.color = on ? '#f5f5f0' : '#f5b942'
      intermissionBtn.style.borderColor = on ? 'var(--red)' : '#5a4718'
      // keep showing your camera as a mirror; just say what's actually going out
      if (intermissionPreviewLabel) intermissionPreviewLabel.textContent = on ? 'your camera · audience sees the standby screen' : 'what your audience sees'
    }
    const stopIntermissionStatus = () => {
      if (this.intermissionStatusInterval) {
        clearInterval(this.intermissionStatusInterval)
        this.intermissionStatusInterval = null
      }
    }
    const clearIntermissionStatusLine = () => {
      stopIntermissionStatus()
      status.style.display = 'none'
      status.textContent = ''
      status.style.color = ''
    }
    const runIntermissionStatus = () => {
      stopIntermissionStatus()
      const render = () => {
        if (!this.intermission) {
          clearIntermissionStatusLine()
          return
        }
        const cd = this.intermissionCountdownLabel(this.intermission.until)
        status.style.display = 'block'
        status.style.color = '#f5b942'
        status.textContent = cd ? `${this.intermission.label} - ${cd}` : this.intermission.label
      }
      render()
      this.intermissionStatusInterval = setInterval(render, 1000)
    }
    intermissionBtn.onclick = () => {
      if (this.intermission) {
        this.dropIntermission()
        standbyStartLabel = false
        clearIntermissionStatusLine()
        syncIntermissionUi()
        return
      }
      // a mid-show break is always "be right back" -> "back to live", not a cold-open start
      standbyStartLabel = false
      this.openIntermissionPanel((label, untilMs) => {
        this.raiseIntermission(label, untilMs)
        syncIntermissionUi()
        runIntermissionStatus()
      })
    }

    // host quick-share: drop a screenshare onto a second screen for the room without walking to a mirror.
    // desktop only (screenshare is unreliable on phones), revealed once live alongside the intermission control.
    const shareScreenDockBtn = document.createElement('button')
    shareScreenDockBtn.type = 'button'
    shareScreenDockBtn.textContent = 'share a screen'
    Object.assign(shareScreenDockBtn.style, {
      display: 'none',
      background: 'transparent',
      color: '#f5b942',
      border: '1px solid #5a4718',
      padding: '6px 10px',
      cursor: 'pointer',
      fontFamily: 'inherit',
      flex: '0 0 auto',
      fontSize: '12px',
      whiteSpace: 'nowrap',
    })
    shareScreenDockBtn.onclick = () => this.openShareScreenChooser()

    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.gap = '0.5rem'
    row.append(intermissionBtn, shareScreenDockBtn, goBtn)

    // setup-only escape hatch: close the dialog without going live. hidden once streaming.
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = 'cancel'
    Object.assign(cancelBtn.style, { background: 'transparent', color: '#888', border: '0', padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: mobile ? '14px' : '12px', textDecoration: 'underline', flexShrink: '0' })
    cancelBtn.onclick = () => {
      if (this.broadcastChatDispose) {
        this.broadcastChatDispose()
        this.broadcastChatDispose = null
      }
      this.dismissBroadcastPanel()
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
      chatLabel.style.display = 'none'
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

      // dispose any effect left from a previous open/cancel or it re-renders a detached panel forever
      this.broadcastChatDispose?.()
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
        padding: '6px 8px',
        fontFamily: 'inherit',
        fontSize: '16px',
        height: '36px',
        boxSizing: 'border-box',
      })
      const chatSend = document.createElement('button')
      chatSend.textContent = 'send'
      Object.assign(chatSend.style, {
        background: '#333',
        color: '#f5f5f0',
        border: '0',
        padding: '6px 10px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        height: '36px',
        boxSizing: 'border-box',
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
        paddingTop: '4px',
        borderTop: '1px solid #333',
      })

      // keyboard pushes fan link + stop under the fold - hide them while typing so send stays obvious
      let mobileChatComposing = false
      const setMobileChatComposing = (on: boolean) => {
        if (!this.broadcastRoom) return
        mobileChatComposing = on
        if (dockFooter) dockFooter.style.display = on ? 'none' : 'flex'
        if (mobileExtrasBtn) mobileExtrasBtn.style.display = on ? 'none' : 'block'
        if (flipBtn && !screenChk.checked) flipBtn.style.display = on ? 'none' : 'block'
        if (micToggle.style.display === 'block') micToggle.style.display = on ? 'none' : 'block'
        if (on) {
          Object.assign(chatReplyRow!.style, {
            position: 'sticky',
            bottom: '0',
            zIndex: '3',
            background: '#0d0d0d',
            paddingBottom: 'max(6px, env(safe-area-inset-bottom))',
          })
        } else {
          Object.assign(chatReplyRow!.style, { position: '', bottom: '', zIndex: '', background: '', paddingBottom: '' })
          if (chatReplyRow) chatReplyRow.style.paddingTop = '4px'
        }
      }
      const onMobileVpResize = () => {
        const vv = window.visualViewport
        if (!vv) return
        const inset = Math.max(0, window.innerHeight - vv.height)
        panel.style.paddingBottom = mobileChatComposing && inset > 48 ? `${inset}px` : ''
      }
      chatInput.addEventListener('focus', () => {
        setMobileChatComposing(true)
        onMobileVpResize()
        window.visualViewport?.addEventListener('resize', onMobileVpResize)
        requestAnimationFrame(() => chatInput.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
      })
      chatInput.addEventListener('blur', () => {
        window.visualViewport?.removeEventListener('resize', onMobileVpResize)
        setTimeout(() => {
          if (document.activeElement === chatInput) return
          panel.style.paddingBottom = ''
          setMobileChatComposing(false)
        }, 150)
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
      // mobile live uses flip camera link instead of "change camera or mic" (pick cam/mic before go-live in deviceRow)
      mobileKids.push(deviceRow, screenOpt, screenHint, standbyOpt, standbyConfig, flipBtn, micToggle, chatRow, dockFooter!, mobileExtrasBtn!, moveRow, status, cancelBtn)
      panel.append(...mobileKids)
    } else {
      const desktopKids: Node[] = [title]
      if (identityRow) desktopKids.push(identityRow)
      desktopKids.push(deviceRow, screenOpt, screenHint, standbyOpt, standbyConfig, deviceToggle, micToggle)
      if (shareRow) desktopKids.push(shareRow)
      desktopKids.push(moveRow, status, row, cancelBtn)
      panel.append(...desktopKids)
    }
    this.attachBroadcastPanel(panel)

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
        analyser.fftSize = 1024 // finer bass resolution (~43Hz/bin) to catch the kick
        analyser.smoothingTimeConstant = 0.4 // less spectral smoothing so transients stay sharp
        source.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const freq = new Uint8Array(analyser.frequencyBinCount)
        const avgBins = (arr: Uint8Array, lo: number, hi: number) => {
          let s = 0
          for (let i = lo; i < hi; i++) s += arr[i]
          return hi > lo ? s / (hi - lo) / 255 : 0
        }
        let bassAvg = 0
        let punchEnv = 0
        let lastTs = performance.now()
        const tick = () => {
          if (!meterFillEl) return
          // overall loudness (RMS of the waveform) - drives the meter bar
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128
            sum += v * v
          }
          const level = Math.min(1, Math.sqrt(sum / data.length) * 2)
          // frequency bands for the video FX (so the visuals dance, not just pulse)
          analyser.getByteFrequencyData(freq)
          const n = freq.length
          const bass = Math.min(1, avgBins(freq, 1, Math.max(2, (n * 0.02) | 0)) * 1.3)
          const mid = Math.min(1, avgBins(freq, Math.max(2, (n * 0.02) | 0), (n * 0.25) | 0) * 1.3)
          const treble = Math.min(1, avgBins(freq, (n * 0.25) | 0, (n * 0.6) | 0) * 1.6)
          // beat-punch = the bass TRANSIENT (how far bass jumps above its own slow average), auto-gained
          // so it snaps on kicks across loud AND quiet music instead of pinning to 1. time-based decay.
          const now = performance.now()
          const dt = Math.min(0.1, (now - lastTs) / 1000 || 0.016)
          lastTs = now
          bassAvg += (bass - bassAvg) * 0.06
          const transient = Math.min(1, Math.max(0, (bass - bassAvg) * 6))
          punchEnv = Math.max(transient, punchEnv * Math.exp(-dt / 0.12))
          this.fxAudio = { level, bass, mid, treble, punch: punchEnv }
          const pct = Math.min(100, level * 100)
          meterFillEl.style.width = pct + '%'
          meterFillEl.style.background = pct > 85 ? 'var(--red)' : pct > 60 ? '#f5b942' : '#22c55e'
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
        this.syncBroadcastVideoFromTrack(liveVideoTrack)
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
        if (mobile) {
          holdMobileCanvasRefresh(3000)
          if (!confirm('stop streaming?')) return
        }
        this.broadcastStopping = true
        this.cameraResumeGen++
        this.mobileBroadcastHooksClear?.()
        // stopping ends the show - close the dock entirely instead of bouncing back to the go-live form
        this.stopBroadcast()
        this.dismissBroadcastPanel()
        this.clearBroadcastDockUi()
        this.setPreview()
        return
      }

      // stream already ended but the dock is still open - dismiss, don't start a second go-live
      if (this.broadcastLost) {
        this.dismissBroadcastPanel()
        this.clearBroadcastDockUi()
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

      // "open with a starting soon screen" - remember it so the live transition raises the card at once
      if (standbyChk.checked) {
        const mins = parseFloat(standbyMinInput.value)
        pendingStandby = { label: standbyMsgInput.value.trim() || 'starting soon', mins: !isNaN(mins) && mins > 0 ? mins : null }
      } else {
        pendingStandby = null
      }

      if (syntheticGuest) {
        const nextName = guestNameInput?.value.trim() || ''
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
        const tokenRes = await fetchShowboxRoomToken(showboxRoomTokenUrl(this.roomName(), true))
        const res = tokenRes
        if (!res?.token) {
          throw new Error(res?.error || 'could not get stream token - sign in again')
        }
        if (res.canPublish === false) {
          throw new Error('no permission to broadcast here - sign in as parcel owner or use a guest link')
        }
        saveShowboxPublisherIdentity(this.roomName(), res.token)

        // Acquire camera/screenshare BEFORE going live: the permission prompt can sit open for a while,
        // and we don't want the audience staring at "connecting..." for a stream that may never start.
        // Nothing is connected or flagged live yet, so a denial/cancel needs no teardown.
        let tracks: any[]
        try {
          if (screenChk.checked) {
            tracks = await createLocalScreenTracks({ audio: showboxAudioConstraints('external') })
          } else {
            tracks = await createLocalTracks({
              // exact: a plain string deviceId is only a preference, so 3-cam setups grab the wrong camera. Force the pick.
              video: showboxCameraVideoConstraints(camSel.value || undefined),
              audio: showboxAudioConstraints(audioMode, micSel.value || undefined),
            })
          }
        } catch (err) {
          // empty message = silent reset (user cancelled the screenshare picker). camera errors get a plain-language nudge.
          throw new Error(screenChk.checked ? '' : cameraErrorMessage(err))
        }
        acquiredTracks = tracks
        this.broadcastLiveTracks = tracks

        const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video)
        if (!videoTrack) {
          throw new Error('showbox needs a camera or screenshare. for audio only, drop a Boombox instead.')
        }
        if (mobile && !screenChk.checked) {
          await videoTrack.restartTrack(showboxMobileCameraConstraints('user')).catch(() => {})
        }

        const room = new Room()
        this.broadcastRoom = room
        this.broadcastReconnectAttempts = 0
        this.broadcastReconnecting = false
        this.broadcastDisconnectStrikes = 0
        this.wireBroadcastRoom(room)

        // Hear the co-host ASAP. broadcastRoom is set first so their audio routes straight to a
        // monitor. If we were already watching them, flip that (spatial) audience audio to a
        // monitor now; otherwise connect the viewer room in parallel with our broadcast connect so
        // their audio lands with their video instead of seconds later.
        let viewerConnect: Promise<void> = Promise.resolve()
        if (this.isCohostMode()) {
          this.cohostLiveSince = Date.now()
          if (this.livekitRoom) {
            for (const audioEl of [...this.streamAudioEls]) {
              this.silenceAudioEl(audioEl)
              this.untrackStreamAudio(audioEl)
            }
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
        this.liveStartedAt = Date.now()
        broadcastLiveStartedAt.value = this.liveStartedAt

        // mirror showboxes can't subscribe to our own feed (same client) - have them read it locally now
        this.parcel.getFeaturesByType('showbox').forEach((f) => (f as any).refreshMirrorVideo?.())

        if (!tracks.some((t) => t.kind === Track.Kind.Audio)) {
          status.textContent = 'live but no mic - check browser permissions'
        }

        liveVideoTrack = videoTrack
        liveAudioTrack = tracks.find((t) => t.kind === Track.Kind.Audio) ?? null
        this.broadcastLiveVideoTrack = liveVideoTrack
        this.broadcastLiveAudioTrack = liveAudioTrack
        this.wireCameraEndedListener(videoTrack)
        if (mobile) {
          const onVis = () => {
            if (document.visibilityState !== 'visible' || !this.broadcastRoom || this.broadcastStopping) return
            const brState = livekitRoomState(this.broadcastRoom)
            if (brState === 'disconnected') {
              void this.tryBroadcastReconnect('connection lost')
              return
            }
            if (brState === 'reconnecting') return
            if (this.broadcastCameraLost) {
              if (broadcastVideoTrackLive(this.broadcastRoom, liveVideoTrack)) {
                this.noteCameraHealthy(this.broadcastRoom)
                return
              }
              void this.tryResumeCamera()
              return
            }
            this.syncBroadcastVideoFromTrack(liveVideoTrack)
          }
          document.addEventListener('visibilitychange', onVis)
          clearMobileBroadcastHooks = () => {
            document.removeEventListener('visibilitychange', onVis)
            clearMobileBroadcastHooks = null
          }
          this.mobileBroadcastHooksClear = clearMobileBroadcastHooks
        }
        if (videoTrack) {
          const el = videoTrack.attach() as HTMLVideoElement
          el.muted = true
          el.playsInline = true
          el.setAttribute('playsinline', '')
          el.setAttribute('webkit-playsinline', 'true')
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

        duckRadio(this)

        goBtn.textContent = 'stop streaming'
        goBtn.style.background = '#444'
        goBtn.disabled = false
        status.textContent = ''
        ;[title, screenOpt, standbyOpt, standbyConfig, status, cancelBtn].forEach((el) => ((el as HTMLElement).style.display = 'none'))
        // intermission control only makes sense once you're live
        intermissionBtn.style.display = 'block'
        // quick screen-share to a second screen - desktop only, and only while you're the one broadcasting
        if (!mobile) shareScreenDockBtn.style.display = 'block'
        if (pendingStandby) {
          // "open with a starting soon screen" - raise the card immediately so the raw camera never airs
          const { label, mins } = pendingStandby
          pendingStandby = null
          standbyStartLabel = true
          this.raiseIntermission(label, mins && mins > 0 ? Date.now() + mins * 60_000 : null)
        }
        syncIntermissionUi()
        if (this.intermission) runIntermissionStatus()
        if (identityRow) identityRow.style.display = 'none'
        deviceRow.style.display = 'none'
        // screensharing has no camera and the mic is handled by the mic toggle below - hide the device picker
        if (mobile) {
          deviceToggle.style.display = 'none'
        } else {
          deviceToggle.style.display = screenChk.checked ? 'none' : 'block'
          deviceToggle.textContent = 'change camera or mic'
        }
        if (screenChk.checked) {
          // cohost screenshare is a two-way conversation, so default the mic on. solo screenshare stays muted (usually video playback).
          micOn = this.isCohostMode()
          micToggle.style.display = 'block'
          syncMicToggle()
          if (micOn) {
            const micOpts = liveAudioTrack ? undefined : showboxAudioConstraints(audioMode, micSel.value || undefined)
            this.broadcastRoom.localParticipant.setMicrophoneEnabled(true, micOpts).catch(() => {
              micOn = false
              syncMicToggle()
            })
          }
        }
        if (mobile) {
          mobileExtrasOpen = false
          if (shareRow) shareRow.style.display = 'flex'
          moveRow.style.display = 'none'
          if (mobileExtrasBtn) mobileExtrasBtn.style.display = 'block'
          if (!screenChk.checked) {
            flipBtn.style.display = 'block'
            if (liveAudioTrack) {
              micOn = true
              micToggle.style.display = 'block'
              Object.assign(micToggle.style, {
                background: 'transparent',
                border: '0',
                padding: '4px 0',
                fontSize: '12px',
                textAlign: 'left',
                textDecoration: 'underline',
                minHeight: '0',
              })
              syncMicToggle()
            }
          }
        } else {
          if (shareRow) shareRow.style.display = 'flex'
          moveRow.style.display = 'flex'
          // fx mangles a screenshare and makes no sense there - drop the tab bar so only emote reactions show.
          if (fxTabs) fxTabs.style.display = screenChk.checked ? 'none' : 'flex'
          if (!screenChk.checked && liveAudioTrack) {
            micOn = true
            micToggle.style.display = 'block'
            syncMicToggle()
          }
        }
        if (chatRow) {
          chatRow.style.display = 'flex'
          chatRow.style.flex = '1 1 0'
          chatRow.style.minHeight = '0'
        }
        if (chatReplyRow) {
          chatReplyRow.style.display = 'flex'
          chatReplyRow.style.paddingTop = '4px'
        }
        if (dockFooter) Object.assign(dockFooter.style, { gap: '4px', paddingBottom: '0' })
        if (mobile) {
          goBtn.style.minHeight = '36px'
          goBtn.style.padding = '8px 12px'
        }
        mobileShowWorld = false

        panel.querySelectorAll('[data-showbox-dock-live-h]').forEach((n) => n.remove())
        panel.querySelectorAll('[data-showbox-dock-preview]').forEach((n) => n.remove())

        // live header: pulsing red dot + count-up timer so the broadcaster sees they are actually streaming.
        const liveHeader = document.createElement('div')
        liveHeader.dataset.dot = '1'
        liveHeader.dataset.showboxDockLiveH = '1'
        Object.assign(liveHeader.style, { display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--red)', fontWeight: 'bold', fontSize: '14px', letterSpacing: '0.5px' })
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
        this.broadcastDockLiveDot = liveDot
        this.broadcastDockLiveLabel = liveLabel
        this.broadcastDockStatusEl = status
        this.broadcastLost = false

        // minimize is the close-X now: closing the sidebar while live drops to the pulsing
        // "live" edge tab (BroadcastSidebarTab) and clicking it brings the dock back.

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
            previewWrap.dataset.showboxDockPreview = '1'
            // match the showbox orientation so a portrait composite shows whole, not cropped.
            // portrait is driven by a capped height (centered) so it doesn't dominate the panel.
            const portraitPreview = this.isPortraitScreen()
            Object.assign(previewWrap.style, {
              position: 'relative',
              background: '#000',
              overflow: 'hidden',
              aspectRatio: portraitPreview ? '9 / 16' : '16 / 9',
              ...(portraitPreview ? { height: '280px', margin: '0 auto' } : { width: '100%' }),
            })
            const previewVideo = this.isCohostMode() ? this.mountCohostPreviewVideo('cover') : makeDockPreviewVideo(videoTrack)
            if (!this.isCohostMode()) {
              previewVideo.volume = 0
              Object.assign(previewVideo.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' })
              fxSoloPreviewEl = previewVideo
            }
            const previewLabel = document.createElement('div')
            previewLabel.textContent = this.intermission ? 'your camera · audience sees the standby screen' : 'what your audience sees'
            Object.assign(previewLabel.style, { position: 'absolute', top: '4px', left: '6px', color: '#f5f5f0', fontSize: '11px', background: 'rgba(0,0,0,0.6)', padding: '2px 6px' })
            intermissionPreviewLabel = previewLabel
            Object.assign(meterTrack.style, { position: 'absolute', bottom: '0', left: '0', right: '0' })
            previewWrap.append(previewVideo, previewLabel, meterTrack)
            panel.insertBefore(previewWrap, chatRow ?? moveRow)
            previewWrap.insertAdjacentElement('afterend', deviceToggle)
            deviceToggle.insertAdjacentElement('afterend', cameraReconnectBtn)
          } else {
            mobilePreviewWrap = document.createElement('div')
            mobilePreviewWrap.dataset.dot = '1'
            mobilePreviewWrap.dataset.showboxDockPreview = '1'
            Object.assign(mobilePreviewWrap.style, {
              position: 'relative',
              width: '100%',
              maxHeight: '18vh',
              minHeight: '80px',
              flexShrink: '0',
              background: '#000',
              overflow: 'hidden',
              aspectRatio: '9 / 16',
            })
            mobilePreviewVideo = this.isCohostMode() ? this.mountCohostPreviewVideo('contain') : makeDockPreviewVideo(videoTrack)
            this.mobilePreviewVideoEl = mobilePreviewVideo
            if (!this.isCohostMode()) mobilePreviewVideo.volume = 0
            syncMobilePreview = wireMobilePreviewVideo(mobilePreviewWrap, mobilePreviewVideo)
            this.syncMobilePreviewDock = syncMobilePreview
            const previewLabel = document.createElement('div')
            previewLabel.textContent = this.intermission ? 'your camera · audience sees the standby screen' : 'what your audience sees'
            Object.assign(previewLabel.style, { position: 'absolute', top: '4px', left: '6px', color: '#f5f5f0', fontSize: '11px', background: 'rgba(0,0,0,0.6)', padding: '2px 6px' })
            intermissionPreviewLabel = previewLabel
            Object.assign(meterTrack.style, { position: 'absolute', bottom: '0', left: '0', right: '0' })
            mobilePreviewWrap.append(mobilePreviewVideo, previewLabel, meterTrack)
            panel.insertBefore(mobilePreviewWrap, chatRow ?? moveRow)
            mobilePreviewWrap.insertAdjacentElement('afterend', flipBtn)
            flipBtn.insertAdjacentElement('afterend', cameraReconnectBtn)
            syncVideoElFromTrack(mobilePreviewVideo, videoTrack)
            mobilePreviewVideo.play().catch(() => {})
            syncMobilePreview?.()

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
        this.onViewerCountTick = (total) => {
          liveViewerCount = Math.max(0, total - 1)
          refreshMobileWorldBtn()
        }
        this.fetchViewerCount().then((total) => this.onViewerCountTick?.(total))
        this.startMilestonePoll()
      } catch (e) {
        clearMobileBroadcastHooks?.()
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
    if (this.hostDockAutoOpenedAt && Date.now() - this.hostDockAutoOpenedAt < 800) return
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
    this.behaviours?.dispatch(this.uuid, 'click')
  }
}

class Editor extends FeatureEditor<Showbox> {
  constructor(props: FeatureEditorProps<Showbox>) {
    super(props)
    this.state = {
      id: props.feature.description.id,
      rolloffFactor: props.feature.rolloffFactor,
      volume: props.feature.volume,
      guestMode: props.feature.guestMode === 'solo' ? 'solo' : 'cohost',
      mirrorSource: props.feature.mirrorSource,
      angleMode: props.feature.description.angleMode !== false, // default a mirror to second-screen mode
      screenShape: props.feature.screenShape === 'portrait' ? 'portrait' : 'landscape',
    }
  }

  componentDidUpdate(_prevProps: FeatureEditorProps<Showbox>, prevState: typeof this.state) {
    this.merge({
      rolloffFactor: this.state.rolloffFactor,
      volume: this.state.volume,
      guestMode: this.state.guestMode,
      mirrorSource: this.state.mirrorSource,
      angleMode: this.state.angleMode,
      screenShape: this.state.screenShape,
    })
    if (prevState.screenShape !== this.state.screenShape) {
      this.props.feature.set({
        scale: this.state.screenShape === 'portrait' ? PORTRAIT_SCALE : LANDSCAPE_SCALE,
      })
    }
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
          <EditorProps>
            <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
            <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
            <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />
            {isMirror ? (
              <div className="f">
                <label>Mode</label>
                <select value={this.state.angleMode ? 'second' : 'mirror'} onChange={(e) => this.setState({ angleMode: e.currentTarget.value === 'second' })}>
                  <option value="second">Second screen</option>
                  <option value="mirror">Mirror showbox</option>
                </select>
                {this.state.angleMode ? (
                  <div className="f">
                    <small>A dedicated screen for an extra feed, no audio. Share a screen or add a camera, then drag and resize it in-world.</small>
                    <div>
                      <button type="button" onClick={() => void this.props.feature.startAngleBroadcast(undefined, true)}>
                        Share screen
                      </button>{' '}
                      <button type="button" onClick={() => this.props.feature.openAnglePanel(true)}>
                        Add camera
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="f">
                    <label>Source</label>
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
            {!isMirror && (
              <div className="f">
                <label>Screen shape</label>
                <div>
                  <label>
                    <input type="radio" name="screenShape" checked={this.state.screenShape === 'landscape'} onChange={() => this.setState({ screenShape: 'landscape' })} />
                    landscape
                  </label>
                  <label>
                    <input type="radio" name="screenShape" checked={this.state.screenShape === 'portrait'} onChange={() => this.setState({ screenShape: 'portrait' })} />
                    portrait
                  </label>
                </div>
              </div>
            )}
            <Advanced>
              <FeatureID feature={this.props.feature} />
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
              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
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
    return this.props.feature.parcel.canEdit
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

  async copyGuestLink() {
    if (!this.canManagePasses()) {
      this.setState({ error: 'you need edit access on this parcel to copy guest links' })
      return
    }
    this.setState({ creating: true, error: null })
    try {
      let token = this.state.passes.find((p) => this.passActive(p))?.token ?? null
      if (!token) {
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
        token = pass.token
        this.applyPass(pass)
      }
      this.copy(this.liveUrl(token), 'co-host link copied')
    } catch (e: any) {
      const msg = e?.message ?? 'Could not create link'
      if (String(msg).toLowerCase().includes('revoke')) {
        await this.refresh()
        this.setState({ error: 'a guest link is already active - copy it below' })
      } else {
        this.setState({ error: msg })
      }
    } finally {
      this.setState({ creating: false })
    }
  }

  async create() {
    if (!this.canManagePasses()) {
      this.setState({ error: 'you need edit access on this parcel to create guest links' })
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
        this.setState({ error: 'a guest link is already active - copy or revoke it below' })
      } else {
        this.setState({ error: msg })
      }
    } finally {
      this.setState({ creating: false })
    }
  }

  async revoke(token: string) {
    if (!this.canManagePasses()) {
      this.setState({ error: 'you need edit access on this parcel to revoke guest links' })
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

  render() {
    if (!this.props.feature.parcel.canEdit) return null
    const active = this.state.passes.filter((p) => this.passActive(p))
    const canManage = this.canManagePasses()

    return (
      <div className="f">
        <label>Go Live</label>
        <small>
          From anywhere. <a href="/golive">http://voxels.com/golive</a>
        </small>

        <label>Co-host link</label>
        <small>Send this to your DJ, artist, or guest on camera. Not for the audience.</small>

        {canManage && (
          <button type="button" style={mobile ? { minHeight: '44px' } : undefined} onClick={() => void this.copyGuestLink()} disabled={this.state.creating}>
            {this.state.creating ? 'creating...' : 'copy co-host link'}
          </button>
        )}
        {!canManage && <small>edit access required</small>}

        {this.state.error && <div style={{ color: 'var(--red)' }}>{this.state.error}</div>}

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
                  {!!p.name?.trim() && <label>{p.name.trim()}</label>}
                  <input type="text" readOnly value={this.liveUrl(p.token)} onClick={(e) => (e.currentTarget as HTMLInputElement).select()} style={mobile ? { fontSize: '16px', minHeight: '44px' } : undefined} />
                </div>
                {canManage && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <button type="button" style={mobile ? { minHeight: '44px' } : undefined} onClick={() => this.revoke(p.token)}>
                      revoke
                    </button>
                  </div>
                )}
                <div className="f">
                  <label>Guest mode</label>
                  <div>
                    <label>
                      <input type="radio" name="guestMode" checked={this.props.guestMode === 'cohost'} onChange={() => this.props.onGuestModeChange('cohost')} />
                      Co-host
                    </label>
                    <label>
                      <input type="radio" name="guestMode" checked={this.props.guestMode === 'solo'} onChange={() => this.props.onGuestModeChange('solo')} />
                      Guest only
                    </label>
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
