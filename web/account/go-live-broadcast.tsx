import Cookies from 'js-cookie'
import { decodeJwt } from 'jose'
import { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client'
import { effect } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
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
import { drawVideoCover } from '../../common/helpers/draw-video-cover'
import { showboxAudioConstraints, showboxRoomHint, SHOWBOX_ROOM_OPTIONS, type ShowboxAudioMode } from '../../common/helpers/showbox-audio-constraints'
import { isMobile } from '../../common/helpers/detector'
import { consumeGuestFreshFromUrl, maybeRefreshGuestJwt } from '../../common/helpers/guest-pass-client'
import { cohostPaneRects, MAX_COHOST_PANES } from '../../common/helpers/cohost-panes'
import ParcelHelper, { showboxAudiencePlayCoordsFromRecord, showboxFanSharePlayQuery } from '../../common/helpers/parcel-helper'
import { avatarName } from '../../common/messages/avatar-ref'
import { Login } from '../src/auth/login'
import cachedFetch, { invalidateUrl } from '../src/helpers/cached-fetch'
import { announceShowLive, chatMessages, connectShardChat, disconnectShardChat, sendChat } from '../src/shard-chat'
import { Spinner } from '../src/spinner'
import { app, AppEvent } from '../src/state'
import { fetchOptions } from '../src/utils'

const LIVEKIT_URL = 'https://voxels-7pvk06qt.livekit.cloud'
const mobile = isMobile()

function showboxMobileCameraConstraints(facing: 'user' | 'environment' = 'user') {
  return { facingMode: facing, aspectRatio: { ideal: 16 / 9 } }
}

async function restartMobileCameraTrack(track: any, facing: 'user' | 'environment') {
  if (!track?.restartTrack) return
  try {
    await track.restartTrack(showboxMobileCameraConstraints(facing))
  } catch {
    await track.restartTrack({ facingMode: facing }).catch(() => {})
  }
}

function showboxCameraVideoConstraints(deviceId: string | undefined) {
  if (mobile) return showboxMobileCameraConstraints('user')
  const c: Record<string, any> = {}
  if (deviceId) c.deviceId = { exact: deviceId }
  return c
}

// livekit attach() can set width/height attrs that fight object-fit; sync the preview box to real frame size.
function wireDockPreview(wrap: HTMLElement, el: HTMLVideoElement, mobilePreview: boolean) {
  el.removeAttribute('width')
  el.removeAttribute('height')
  Object.assign(el.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  })
  const sync = () => {
    el.removeAttribute('width')
    el.removeAttribute('height')
    if (mobilePreview) {
      wrap.style.aspectRatio = '16 / 9'
      el.style.objectFit = 'contain'
      return
    }
    const w = el.videoWidth
    const h = el.videoHeight
    if (w <= 0 || h <= 0) return
    wrap.style.aspectRatio = `${w} / ${h}`
    el.style.objectFit = 'cover'
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

function cameraErrorMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'camera blocked - allow camera access in your browser, then go live again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no camera found - plug one in and try again.'
  if (name === 'NotReadableError' || name === 'AbortError') return 'your camera is busy in another app - close it and try again.'
  return 'could not start your camera - check browser permissions, then go live again.'
}

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

function guestJwtPayload(): { wallet?: string; guest_pass?: string; feature_uuid?: string } | null {
  try {
    const key = app.state.key || Cookies.get('jwt')
    if (!key) return null
    return decodeJwt(key) as { wallet?: string; guest_pass?: string; feature_uuid?: string }
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
    const fromUrl = new URL(window.location.href).searchParams.get('guest_pass')
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

function isGuestForShowbox(showUuid: string): boolean {
  const url = new URL(window.location.href)
  if (url.searchParams.get('host') === '1') return false
  const showMatch = url.searchParams.get('show')?.toLowerCase() === showUuid.toLowerCase()
  if (!showMatch) return false
  if (isSyntheticGuestWallet()) {
    const payload = guestJwtPayload()
    if (payload?.feature_uuid?.toLowerCase() === showUuid.toLowerCase()) return true
    return true
  }
  if (url.searchParams.get('guest_pass') || guestJwtPayload()?.guest_pass) return true
  return false
}

function roomTokenUrl(roomName: string, reusePublisher = false) {
  let base = `/api/rooms/${roomName}/token`
  const pass = guestPassToken()
  if (pass && !guestJwtPayload()?.guest_pass) {
    base = `${base}?guest_pass=${encodeURIComponent(pass)}`
  }
  return showboxTokenUrlWithIdentity(base, roomName, reusePublisher)
}

function parcelOwnerWallet(parcel: any): string {
  const o = parcel?.owner
  if (!o) return ''
  if (typeof o === 'object') return String(o.owner || '').toLowerCase()
  return String(o).toLowerCase()
}

function parcelEditorWallets(parcel: any): string[] {
  const out = new Set<string>()
  const ownerWallet = parcelOwnerWallet(parcel)
  if (ownerWallet) out.add(ownerWallet)
  for (const pu of parcel?.parcel_users ?? []) {
    if (pu?.role === 'owner' || pu?.role === 'contributor' || pu?.role === 'moderator') {
      if (pu.wallet) out.add(String(pu.wallet).toLowerCase())
    }
  }
  return [...out]
}

function canManageGuestPasses(parcel: any): boolean {
  const wallet = app.state.wallet
  if (!wallet || !parcel) return false
  const h = new ParcelHelper(parcel)
  if (h.isOwner(wallet) || h.isContributor(wallet)) return true
  return parcelEditorWallets(parcel).includes(wallet.toLowerCase())
}

function formatTimer(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function viewerCountLabel(n: number) {
  return n === 1 ? '1 viewer' : `${n} viewers`
}

function isSelfConnection(identity: string, hostWallet: string) {
  if (!hostWallet) return false
  return cohostIdentityPrefix(identity).toLowerCase() === hostWallet.toLowerCase()
}

function participantLabel(identity: string, radarNames: Map<string, string>) {
  const prefix = cohostIdentityPrefix(identity).toLowerCase()
  if (prefix.startsWith('guest-')) return 'co-host'
  const named = radarNames.get(prefix)
  if (named) return named
  if (prefix.startsWith('anon-') || prefix === 'anon') return 'anon'
  if (prefix.startsWith('0x')) {
    const n = avatarName(prefix)
    return n === '...' ? 'anon' : n
  }
  return 'anon'
}

function audienceFromRoom(room: Room | null, hostWallet: string, radarNames: Map<string, string>) {
  if (!room) return []
  const byWallet = new Map<string, string>()
  for (const p of room.participants.values()) {
    const identity = p.identity ?? ''
    if (!identity || isSelfConnection(identity, hostWallet)) continue
    const wallet = cohostIdentityPrefix(identity).toLowerCase()
    if (!wallet) continue
    byWallet.set(wallet, participantLabel(identity, radarNames))
  }
  return [...byWallet.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

function radarParcelLabel(avatar: any, hostWallet: string): string | null {
  const wallet = (typeof avatar === 'string' ? avatar : avatar?.owner)?.toLowerCase() || ''
  if (wallet && wallet === hostWallet) return null
  if (typeof avatar === 'object' && avatar?.name?.trim()) return avatar.name.trim()
  return 'anon'
}

function parcelFeature(parcel: any, showUuid: string) {
  let raw = parcel?.features
  if (!raw && parcel?.content) {
    const c = parcel.content
    raw = typeof c === 'string' ? JSON.parse(c)?.features : c?.features
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : []
  return list.find((f: any) => f?.uuid?.toLowerCase() === showUuid.toLowerCase())
}

type CohostPane = { key: string; el: HTMLVideoElement; hadFrame: boolean; editor: boolean }

type CohostBag = {
  // one pane per publisher: 'local' is our camera, remotes key by identity prefix
  panes: CohostPane[]
  cohostCanvas: HTMLCanvasElement | null
  cohostMonitorEls: HTMLAudioElement[]
  cohostCompositeRaf: number | null
  cohostCompositeRetryRaf: number | null
  editorWallets: string[]
  isGuest: boolean
  showUuid: string
  // showbox feature uuids - angle feeds publish video named with their mirror's uuid and
  // must never land in the dock composite
  angleTrackNames: string[]
  onRedraw: () => void
}

function isAngleTrackPub(bag: CohostBag, pub: any) {
  const name = String(pub?.trackName ?? '').toLowerCase()
  return !!name && bag.angleTrackNames.includes(name)
}

// removing a playing media element from the DOM does not stop it - the livekit track still
// feeds it. kill the source before dropping the element or audio/decoders stack up.
function silenceMediaEl(el: HTMLMediaElement | null) {
  if (!el) return
  try {
    el.pause()
    el.srcObject = null
  } catch {}
  el.remove()
}

function parcelEditorWallet(bag: CohostBag, wallet: string) {
  const w = (wallet || '').toLowerCase().trim()
  if (!w || w.startsWith('anon-')) return false
  return bag.editorWallets.includes(w)
}

function isGuestPublisherIdentity(bag: CohostBag, identity: string) {
  const prefix = cohostIdentityPrefix(identity)
  if (prefix.startsWith('guest-')) return true
  return !parcelEditorWallet(bag, prefix)
}

function shouldPlayCohostAudio(bag: CohostBag, broadcastRoom: Room | null, viewerRoom: Room | null, participantIdentity: string) {
  if (!broadcastRoom || !viewerRoom) return false
  const theirs = cohostIdentityPrefix(participantIdentity)
  const myPub = cohostIdentityPrefix(broadcastRoom.localParticipant.identity)
  const mySub = cohostIdentityPrefix(viewerRoom.localParticipant.identity)
  // every other publisher gets a monitor. camp gating (editors hear guests, guests hear
  // editors) left host<->collaborator and guest<->guest pairs mutually silent.
  return theirs !== myPub && theirs !== mySub
}

function cohostPaneFor(bag: CohostBag, key: string) {
  return bag.panes.find((p) => p.key === key)
}

function setCohostPane(bag: CohostBag, key: string, el: HTMLVideoElement, editor: boolean) {
  const existing = cohostPaneFor(bag, key)
  if (existing) {
    if (existing.el !== el) {
      silenceMediaEl(existing.el)
      existing.el = el
      existing.hadFrame = false
    }
    existing.editor = editor
    return
  }
  // the dock has no unsubscribe cleanup - evict a dead pane before refusing a live one
  if (bag.panes.length >= MAX_COHOST_PANES) {
    const dead = bag.panes.findIndex((p) => !cohostVideoTrackLive(p.el))
    if (dead < 0) {
      // stage is full - everyone is still heard, but the preview caps at host + 4
      silenceMediaEl(el)
      return
    }
    silenceMediaEl(bag.panes[dead].el)
    bag.panes.splice(dead, 1)
  }
  bag.panes.push({ key, el, hadFrame: false, editor })
}

function drawCohostFrame(bag: CohostBag) {
  if (!bag.cohostCanvas) return false
  // mobile hidden videos flicker videoWidth - once a pane had frames it keeps its spot
  for (const p of bag.panes) {
    if (!cohostVideoTrackLive(p.el)) p.hadFrame = false
    else if (cohostVideoReady(p.el)) p.hadFrame = true
  }
  const visible = bag.panes.filter((p) => p.hadFrame)
  if (!visible.length) return false

  // host-anchored: the first editor with video is the big pane, guests fill the rest
  const anchor = visible.find((p) => p.editor) ?? visible[0]
  const ordered = [anchor, ...visible.filter((p) => p !== anchor)]

  const canvas = bag.cohostCanvas
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0d0d0d'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const rects = cohostPaneRects(ordered.length, canvas.width, canvas.height, false)
  ordered.forEach((p, i) => {
    const r = rects[i]
    if (r && p.el.videoWidth > 0) drawVideoCover(ctx, p.el, r.x, r.y, r.w, r.h)
  })
  return true
}

function updateCohostComposite(bag: CohostBag) {
  if (!bag.cohostCanvas) {
    bag.cohostCanvas = document.createElement('canvas')
    bag.cohostCanvas.width = 640
    bag.cohostCanvas.height = 360
  }
  if (!drawCohostFrame(bag)) {
    if (!bag.cohostCompositeRetryRaf) {
      bag.cohostCompositeRetryRaf = requestAnimationFrame(() => {
        bag.cohostCompositeRetryRaf = null
        updateCohostComposite(bag)
      })
    }
    bag.onRedraw()
    return
  }
  if (bag.cohostCompositeRetryRaf) {
    cancelAnimationFrame(bag.cohostCompositeRetryRaf)
    bag.cohostCompositeRetryRaf = null
  }
  if (!bag.cohostCompositeRaf) {
    const tick = () => {
      if (!bag.cohostCanvas) {
        bag.cohostCompositeRaf = null
        return
      }
      if (!drawCohostFrame(bag)) {
        bag.cohostCompositeRaf = null
        if (!bag.cohostCompositeRetryRaf) {
          bag.cohostCompositeRetryRaf = requestAnimationFrame(() => {
            bag.cohostCompositeRetryRaf = null
            updateCohostComposite(bag)
          })
        }
        return
      }
      bag.onRedraw()
      bag.cohostCompositeRaf = requestAnimationFrame(tick)
    }
    bag.cohostCompositeRaf = requestAnimationFrame(tick)
  }
  bag.onRedraw()
}

function routeCohostVideo(bag: CohostBag, track: any, identity: string, broadcastRoom: Room | null, viewerRoom: Room | null, onRemote?: () => void) {
  // same self/non-self gate as audio: every other publisher gets a pane
  if (!shouldPlayCohostAudio(bag, broadcastRoom, viewerRoom, identity)) return
  onRemote?.()
  const el = track.attach() as HTMLVideoElement
  el.muted = true
  el.playsInline = true
  el.autoplay = true
  el.style.display = 'none'
  document.body.appendChild(el)
  el.play().catch(() => {})
  el.addEventListener('loadeddata', () => updateCohostComposite(bag), { once: true })
  setCohostPane(bag, cohostIdentityPrefix(identity), el, !isGuestPublisherIdentity(bag, identity))
  updateCohostComposite(bag)
}

function routeCohostAudio(bag: CohostBag, track: any, identity: string, broadcastRoom: Room | null, viewerRoom: Room | null, room: Room) {
  if (!shouldPlayCohostAudio(bag, broadcastRoom, viewerRoom, identity)) return
  const prefix = cohostIdentityPrefix(identity)
  for (let i = bag.cohostMonitorEls.length - 1; i >= 0; i--) {
    const el = bag.cohostMonitorEls[i] as HTMLAudioElement & { dataset: { cohostPrefix?: string } }
    if (el.dataset?.cohostPrefix === prefix) {
      silenceMediaEl(el)
      bag.cohostMonitorEls.splice(i, 1)
    }
  }
  const el = track.attach() as HTMLAudioElement
  el.dataset.cohostPrefix = prefix
  el.style.display = 'none'
  document.body.appendChild(el)
  bag.cohostMonitorEls.push(el)
  room.startAudio().catch(() => {})
}

function wireLocalCohostVideo(bag: CohostBag, el: HTMLVideoElement) {
  el.muted = true
  el.playsInline = true
  el.autoplay = true
  el.style.display = 'none'
  document.body.appendChild(el)
  el.play().catch(() => {})
  setCohostPane(bag, 'local', el, !bag.isGuest)
  updateCohostComposite(bag)
}

function stopCohost(bag: CohostBag) {
  if (bag.cohostCompositeRaf) cancelAnimationFrame(bag.cohostCompositeRaf)
  if (bag.cohostCompositeRetryRaf) cancelAnimationFrame(bag.cohostCompositeRetryRaf)
  bag.cohostCompositeRaf = null
  bag.cohostCompositeRetryRaf = null
  for (const p of bag.panes) silenceMediaEl(p.el)
  bag.panes = []
  for (const el of bag.cohostMonitorEls) silenceMediaEl(el)
  bag.cohostCanvas = null
  bag.cohostMonitorEls = []
}

function dockClass(live: boolean, chatFocus = false) {
  let c = `showbox-dock ${mobile ? 'showbox-dock-mobile' : 'showbox-dock-desktop'} ${live ? 'showbox-dock-live' : 'showbox-dock-setup'}`
  if (chatFocus) c += ' showbox-dock-chat-focus'
  return c
}

export default function GoLiveBroadcast() {
  const params = new URL(window.location.href).searchParams
  const parcelId = parseInt(params.get('parcel') || '', 10)
  const showUuid = (params.get('show') || '').trim()

  const [signedIn, setSignedIn] = useState(app.signedIn)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [parcel, setParcel] = useState<any>(null)
  const [feature, setFeature] = useState<any>(null)
  const [live, setLive] = useState(false)
  // room event handlers are wired in goLive's render (live === false) - they must read live
  // through a ref or every Disconnected handler sees a stale false and never reconnects
  const liveRef = useRef(false)
  // bumped by stopAll so reconnects sleeping through a stop can't resurrect a dead session
  const sessionGen = useRef(0)
  const [status, setStatus] = useState('')
  const [viewers, setViewers] = useState(0)
  const [viewerLines, setViewerLines] = useState<{ id: string; name: string }[]>([])
  const [viewerListOpen, setViewerListOpen] = useState(false)
  const [stageGuests, setStageGuests] = useState<{ identity: string; name: string; audioMuted: boolean }[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [micOn, setMicOn] = useState(true)
  const [chatDraft, setChatDraft] = useState('')
  const [guestName, setGuestName] = useState(() => (isSyntheticGuestWallet() ? '' : app.state.name || ''))
  const [fanUrl, setFanUrl] = useState('')
  const [guestUrl, setGuestUrl] = useState('')
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [camId, setCamId] = useState('')
  const [micId, setMicId] = useState('')
  const [audioMode, setAudioMode] = useState<ShowboxAudioMode>('voice')
  const [flipFacing, setFlipFacing] = useState<'user' | 'environment'>('user')
  const flipFacingRef = useRef<'user' | 'environment'>('user')
  flipFacingRef.current = flipFacing
  const [remoteCohostLive, setRemoteCohostLive] = useState(false)
  const [chatComposing, setChatComposing] = useState(false)
  const [shareLinkKind, setShareLinkKind] = useState<'fan' | 'guest'>('fan')
  const [sharePickOpen, setSharePickOpen] = useState(false)
  const [, setChatRev] = useState(0)
  const [broadcastLost, setBroadcastLost] = useState(false)
  const [cameraLost, setCameraLost] = useState(false)
  const cameraLostRef = useRef(false)
  cameraLostRef.current = cameraLost
  const [healthStatus, setHealthStatus] = useState('')

  const broadcastRoom = useRef<Room | null>(null)
  const liveTracks = useRef<any[]>([])
  const broadcastStopping = useRef(false)
  const broadcastReconnecting = useRef(false)
  const broadcastReconnectAttempts = useRef(0)
  const broadcastDisconnectStrikes = useRef(0)
  const cameraResumeGen = useRef(0)
  const cameraHealthStrikes = useRef(0)
  const cameraEndedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewerRoom = useRef<Room | null>(null)
  const viewerReconnectAttempts = useRef(0)
  const viewerReconnecting = useRef(false)
  const viewerDisconnectStrikes = useRef(0)
  const viewerConnectGen = useRef(0)
  const liveVideoTrack = useRef<any>(null)
  const liveAudioTrack = useRef<any>(null)
  const liveStartedAt = useRef(0)
  const thumbInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const thumbCanvas = useRef<HTMLCanvasElement | null>(null)
  const previewVideo = useRef<HTMLVideoElement | null>(null)
  const previewWrap = useRef<HTMLDivElement | null>(null)
  const previewSync = useRef<(() => void) | null>(null)
  const displayCanvas = useRef<HTMLCanvasElement | null>(null)
  const cohostBag = useRef<CohostBag | null>(null)
  const liveChatAnnounced = useRef(false)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const chatBox = useRef<HTMLDivElement | null>(null)
  const chatInputRef = useRef<HTMLInputElement | null>(null)
  const radarNames = useRef(new Map<string, string>())
  const parcelPresence = useRef(new Map<string, string>())

  const isGuest = showUuid ? isGuestForShowbox(showUuid) : false
  const canManageGuests = parcel ? canManageGuestPasses(parcel) : false
  const syntheticGuest = isGuest && isSyntheticGuestWallet()
  const guestMode = feature?.guestMode === 'solo' ? 'solo' : 'cohost'
  const isCohost = guestMode === 'cohost'
  const roomName = parcelId ? `parcel-${parcelId}` : ''
  const parcelLabel = parcel ? new ParcelHelper(parcel).ownerName || parcel.name?.trim() || parcel.address?.trim() || `parcel #${parcelId}` : ''

  useEffect(() => {
    const sync = () => setSignedIn(app.signedIn)
    app.on(AppEvent.Login, sync)
    app.on(AppEvent.Logout, sync)
    return () => {
      app.removeListener(AppEvent.Login, sync)
      app.removeListener(AppEvent.Logout, sync)
    }
  }, [])

  useEffect(() => {
    if (consumeGuestFreshFromUrl((n) => app.setName(n))) setGuestName('')
  }, [])

  useEffect(() => {
    if (!parcelId || !showUuid) {
      setError('missing parcel or showbox')
      setLoading(false)
      return
    }
    if (!isGuest && !signedIn) {
      setLoading(false)
      return
    }

    let dead = false
    const run = async () => {
      try {
        await invalidateUrl(`/api/parcels/${parcelId}.json`, true)
        const r = await cachedFetch(`/api/parcels/${parcelId}.json`, fetchOptions())
        const j = await r.json()
        const p = j?.parcel
        const f = parcelFeature(p, showUuid)
        if (!p || !f || f.type !== 'showbox') {
          if (!dead) setError('showbox not found on this parcel')
          return
        }
        if (!dead) {
          setParcel(p)
          setFeature(f)
          const helper = new ParcelHelper(p)
          const audienceCoords = showboxAudiencePlayCoordsFromRecord(helper, f)
          setFanUrl(`${window.location.origin}/play?${showboxFanSharePlayQuery(audienceCoords, showUuid)}`)
        }
        if (!isGuest && app.signedIn) {
          try {
            const gr = await fetch(`/api/parcels/${parcelId}/guest-passes?feature_uuid=${encodeURIComponent(showUuid)}`, { credentials: 'include', cache: 'no-store' })
            const gj = await gr.json().catch(() => null)
            const pass = (gj?.passes ?? []).find((x: any) => !x.revoked_at)
            if (pass?.token) {
              setGuestUrl(`${window.location.origin}/live/${pass.token}`)
            }
          } catch {}
        }
      } catch {
        if (!dead) setError('could not load parcel')
      } finally {
        if (!dead) setLoading(false)
      }
    }
    run()
    return () => {
      dead = true
    }
  }, [parcelId, showUuid, isGuest, signedIn])

  const scrollChatToEnd = () => {
    const el = chatBox.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }

  useEffect(() => {
    const dispose = effect(() => {
      chatMessages.value
      setChatRev((n) => n + 1)
      scrollChatToEnd()
    })
    return dispose
  }, [])

  useEffect(() => {
    if (!live) return
    scrollChatToEnd()
  }, [live])

  useEffect(() => {
    if (!mobile || !live) return
    const dock = dockRef.current
    const onVp = () => {
      const vv = window.visualViewport
      if (!dock || !vv) return
      const inset = Math.max(0, window.innerHeight - vv.height)
      dock.style.paddingBottom = chatComposing && inset > 48 ? `${inset}px` : ''
    }
    onVp()
    window.visualViewport?.addEventListener('resize', onVp)
    window.visualViewport?.addEventListener('scroll', onVp)
    return () => {
      if (dock) dock.style.paddingBottom = ''
      window.visualViewport?.removeEventListener('resize', onVp)
      window.visualViewport?.removeEventListener('scroll', onVp)
    }
  }, [live, chatComposing])

  useEffect(() => {
    if (!isSyntheticGuestWallet()) return
    void maybeRefreshGuestJwt()
    const t = setInterval(() => void maybeRefreshGuestJwt(), 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    connectShardChat()
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devs) => {
        setCameras(devs.filter((d) => d.kind === 'videoinput'))
        setMics(devs.filter((d) => d.kind === 'audioinput'))
      })
      .catch(() => {})
    return () => {
      stopAll()
      disconnectShardChat()
    }
  }, [])

  useEffect(() => {
    if (live || loading) return
    let dead = false
    let tracks: any[] = []
    createLocalTracks({
      video: showboxCameraVideoConstraints(camId || undefined),
      audio: false,
    })
      .then((t) => {
        if (dead) {
          t.forEach((x) => x.stop())
          return
        }
        tracks = t
        const vt = t.find((x) => x.kind === Track.Kind.Video)
        if (vt) syncPreviewVideo(vt)
        // first-time visitors get blank device labels from the pre-permission enumerate -
        // now that the permission prompt resolved, list them again with real names
        navigator.mediaDevices
          ?.enumerateDevices()
          .then((devs) => {
            if (dead) return
            setCameras(devs.filter((d) => d.kind === 'videoinput'))
            setMics(devs.filter((d) => d.kind === 'audioinput'))
          })
          .catch(() => {})
      })
      .catch(() => {})
    return () => {
      dead = true
      tracks.forEach((x) => x.stop())
    }
  }, [camId, live, loading])

  useEffect(() => {
    if (isCohost && live && remoteCohostLive) return
    const wrap = previewWrap.current
    const el = previewVideo.current
    if (!wrap || !el) return
    previewSync.current = wireDockPreview(wrap, el, mobile)
  }, [live, remoteCohostLive, isCohost, loading])

  const refreshViewers = () => {
    const hostWallet = (app.state.wallet || '').toLowerCase()
    const lkLines = audienceFromRoom(broadcastRoom.current, hostWallet, radarNames.current)

    const merged = new Map<string, string>()
    for (const [uuid, name] of parcelPresence.current) merged.set(uuid, name)
    for (const l of lkLines) {
      if (radarNames.current.has(l.id)) continue
      merged.set(`lk:${l.id}`, l.name)
    }

    const lines = [...merged.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

    setViewerLines(lines)
    setViewers(lines.length)
  }

  useEffect(() => {
    if (!live) return
    const hostWallet = (app.state.wallet || '').toLowerCase()

    const applyRadarSnapshot = (users: any[]) => {
      const names = new Map<string, string>()
      const presence = new Map<string, string>()
      for (const u of users ?? []) {
        if (Number(u?.parcel) !== parcelId || !u?.uuid) continue
        const label = radarParcelLabel(u.avatar, hostWallet)
        if (!label) continue
        presence.set(u.uuid, label)
        const wallet = (typeof u.avatar === 'string' ? u.avatar : u.avatar?.owner)?.toLowerCase()
        if (wallet) names.set(wallet, label)
      }
      radarNames.current = names
      parcelPresence.current = presence
      refreshViewers()
    }

    const applyRadarMove = (u: any) => {
      if (!u?.uuid) return
      if (Number(u.parcel) !== parcelId) {
        parcelPresence.current.delete(u.uuid)
      } else {
        const label = radarParcelLabel(u.avatar, hostWallet)
        if (!label) parcelPresence.current.delete(u.uuid)
        else {
          parcelPresence.current.set(u.uuid, label)
          const wallet = (typeof u.avatar === 'string' ? u.avatar : u.avatar?.owner)?.toLowerCase()
          if (wallet) radarNames.current.set(wallet, label)
        }
      }
      refreshViewers()
    }

    const es = new EventSource('/api/users/live')
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'snapshot') applyRadarSnapshot(msg.users ?? [])
        else if (msg.type === 'move') applyRadarMove(msg)
        else if (msg.type === 'leave') {
          if (msg.uuid) parcelPresence.current.delete(msg.uuid)
          refreshViewers()
        }
      } catch {}
    }
    return () => es.close()
  }, [live, parcelId])

  useEffect(() => {
    if (!live) return
    const onOnline = () => {
      if (broadcastRoom.current && livekitRoomState(broadcastRoom.current) === 'disconnected') {
        maybeReconnectAfterDisconnect('back online')
      }
      if (viewerRoom.current && livekitRoomState(viewerRoom.current) === 'disconnected') {
        maybeReconnectViewer('back online')
      } else if (isCohost && !viewerRoom.current) {
        void connectViewer()
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [live, isCohost, roomName])

  const refreshStageGuests = async () => {
    if (!canManageGuests) return
    try {
      const r = await fetch(`/api/parcels/${parcelId}/showbox-guests`, { credentials: 'include', cache: 'no-store' })
      const j = await r.json().catch(() => null)
      if (j?.success) setStageGuests(j.guests ?? [])
    } catch {}
  }

  const moderateGuest = async (identity: string, action: 'mute' | 'kick') => {
    if (action === 'kick' && !confirm('Remove this guest from the stage? They can rejoin with their link.')) return
    try {
      await fetch(`/api/parcels/${parcelId}/showbox-moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identity, action }),
      })
    } catch {}
    void refreshStageGuests()
  }

  useEffect(() => {
    if (!live || !canManageGuests) return
    void refreshStageGuests()
    const t = setInterval(() => void refreshStageGuests(), 10000)
    return () => clearInterval(t)
  }, [live, canManageGuests])

  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setElapsed(Date.now() - liveStartedAt.current), 1000)
    refreshViewers()
    const v = setInterval(() => {
      checkBroadcastHealth()
      refreshViewers()
      void maybeRefreshGuestJwt()
    }, BROADCAST_HEALTH_POLL_MS)
    return () => {
      clearInterval(t)
      clearInterval(v)
    }
  }, [live, roomName, isCohost, broadcastLost])

  const syncPreviewVideo = (track: any) => {
    const el = previewVideo.current
    const mst = track?.mediaStreamTrack as MediaStreamTrack | undefined
    if (!el || !mst || mst.readyState === 'ended') return
    el.srcObject = new MediaStream([mst])
    el.play().catch(() => {})
    const bumpPreview = () => {
      previewSync.current?.()
      requestAnimationFrame(() => previewSync.current?.())
    }
    bumpPreview()
    el.addEventListener('loadedmetadata', bumpPreview, { once: true })
    el.addEventListener('resize', bumpPreview, { once: true })
  }

  const stopThumb = () => {
    if (thumbInterval.current) {
      clearInterval(thumbInterval.current)
      thumbInterval.current = null
    }
    fetch(`/api/rooms/${roomName}/thumbnail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thumbnail: null }),
    }).catch(() => {})
  }

  const startThumb = (videoEl: HTMLVideoElement | null) => {
    if (thumbInterval.current) {
      clearInterval(thumbInterval.current)
      thumbInterval.current = null
    }
    if (!thumbCanvas.current) {
      thumbCanvas.current = document.createElement('canvas')
      thumbCanvas.current.width = 256
      thumbCanvas.current.height = 144
    }
    const canvas = thumbCanvas.current
    const ctx = canvas.getContext('2d')!
    const parcelMeta = { id: parcelId, name: parcel?.name, address: parcel?.address }
    const coord = feature ? showboxAudiencePlayCoordsFromRecord(new ParcelHelper(parcel), feature) : ''
    thumbInterval.current = setInterval(() => {
      try {
        if (isCohost && cohostBag.current?.cohostCanvas) {
          if (!drawCohostFrame(cohostBag.current)) return
          drawVideoCover(ctx, cohostBag.current.cohostCanvas, 0, 0, 256, 144)
        } else if (videoEl && videoEl.videoWidth > 0) {
          drawVideoCover(ctx, videoEl, 0, 0, 256, 144)
        } else return
        const thumbnail = canvas.toDataURL('image/jpeg', 0.2)
        fetch(`/api/rooms/${roomName}/thumbnail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: app.avatarRef, parcel: parcelMeta, coord, thumbnail }),
        }).catch(() => {})
      } catch {}
    }, 1000)
  }

  const armLivePreview = () => {
    const vt = liveVideoTrack.current
    if (!vt) return
    syncPreviewVideo(vt)
    if (isCohost && cohostBag.current && !remoteCohostLive) {
      const bag = cohostBag.current
      if (!cohostPaneFor(bag, 'local')) wireLocalCohostVideo(bag, vt.attach() as HTMLVideoElement)
    }
    startThumb(previewVideo.current)
    const el = previewVideo.current
    if (el && el.videoWidth === 0) {
      el.addEventListener('loadeddata', () => startThumb(previewVideo.current), { once: true })
    }
  }

  useEffect(() => {
    if (!live) return
    requestAnimationFrame(() => requestAnimationFrame(armLivePreview))
  }, [live, remoteCohostLive, isCohost])

  const setShowboxLive = async (on: boolean) => {
    try {
      await fetch(`/api/parcels/${parcelId}/showbox-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ feature_uuid: showUuid, live: on }),
      })
    } catch {}
  }

  const clearHealthUi = () => {
    setCameraLost(false)
    setHealthStatus('')
  }

  const onBroadcastLost = (reason: string) => {
    if (broadcastLost) return
    broadcastReconnecting.current = false
    broadcastDisconnectStrikes.current = 0
    setCameraLost(false)
    setBroadcastLost(true)
    setHealthStatus(reason)
    void setShowboxLive(false)
  }

  const noteCameraHealthy = (room: Room) => {
    cameraHealthStrikes.current = 0
    const pub = publishedVideoTrack(room)
    if (pub) liveVideoTrack.current = pub
    if (cameraLostRef.current) clearHealthUi()
  }

  const noteCameraUnhealthy = () => {
    cameraHealthStrikes.current++
    if (cameraHealthStrikes.current >= BROADCAST_CAMERA_STRIKES) onCameraDisconnected()
  }

  const scheduleCameraEndedCheck = () => {
    if (cameraEndedTimer.current) clearTimeout(cameraEndedTimer.current)
    cameraEndedTimer.current = setTimeout(() => {
      cameraEndedTimer.current = null
      if (!broadcastRoom.current || broadcastStopping.current) return
      if (broadcastVideoTrackLive(broadcastRoom.current, liveVideoTrack.current)) {
        noteCameraHealthy(broadcastRoom.current)
        return
      }
      noteCameraUnhealthy()
    }, BROADCAST_CAMERA_ENDED_DELAY_MS)
  }

  const onCameraDisconnected = () => {
    if (broadcastLost || cameraLost || !broadcastRoom.current) return
    setCameraLost(true)
    setHealthStatus('camera disconnected')
  }

  const wireCameraEndedListener = (track: any) => {
    const mst = track?.mediaStreamTrack as MediaStreamTrack | undefined
    if (!mst) return
    mst.addEventListener('ended', () => {
      if (!broadcastRoom.current || broadcastStopping.current) return
      if (liveStartedAt.current && Date.now() - liveStartedAt.current < BROADCAST_LIVE_GRACE_MS) return
      scheduleCameraEndedCheck()
    })
  }

  const refreshBroadcastPreview = () => {
    const vt = liveVideoTrack.current
    if (!vt) return
    syncPreviewVideo(vt)
  }

  const wireBroadcastRoom = (room: Room) => {
    room.on(RoomEvent.Disconnected, () => {
      if (broadcastLost || !broadcastRoom.current || broadcastStopping.current) return
      maybeReconnectAfterDisconnect('connection lost')
    })
    const reconnected = (RoomEvent as any).Reconnected
    if (reconnected) {
      room.on(reconnected, () => {
        if (broadcastLost || broadcastStopping.current) return
        broadcastReconnecting.current = false
        broadcastReconnectAttempts.current = 0
        broadcastDisconnectStrikes.current = 0
        clearHealthUi()
        void setShowboxLive(true)
        refreshBroadcastPreview()
      })
    }
  }

  const maybeReconnectAfterDisconnect = (reason: string) => {
    if (broadcastLost || broadcastReconnecting.current || broadcastStopping.current || !liveRef.current) return
    if (livekitRoomState(broadcastRoom.current) === 'reconnecting') return
    broadcastDisconnectStrikes.current++
    if (broadcastDisconnectStrikes.current < BROADCAST_DISCONNECT_STRIKES) {
      setHealthStatus('connection unstable...')
      return
    }
    void tryBroadcastReconnect(reason)
  }

  const tryBroadcastReconnect = async (reason: string) => {
    if (broadcastLost || broadcastReconnecting.current || broadcastStopping.current || !liveRef.current) return
    const gen = sessionGen.current
    const tracks = liveTracks.current
    if (!tracks.length) {
      onBroadcastLost(reason)
      return
    }
    if (broadcastReconnectAttempts.current >= BROADCAST_RECONNECT_MAX) {
      onBroadcastLost(reason)
      return
    }
    broadcastReconnectAttempts.current++
    broadcastReconnecting.current = true
    setHealthStatus(`reconnecting (${broadcastReconnectAttempts.current}/${BROADCAST_RECONNECT_MAX})...`)
    await new Promise((r) => setTimeout(r, 1000 * broadcastReconnectAttempts.current))
    try {
      // the host may have stopped (or navigated away) during the backoff sleep - reconnecting
      // now would resurrect a dead session and flag the showbox live with stopped tracks
      if (gen !== sessionGen.current || broadcastStopping.current || !liveRef.current) {
        broadcastReconnecting.current = false
        return
      }
      if (livekitRoomState(broadcastRoom.current) === 'reconnecting') {
        broadcastReconnecting.current = false
        return
      }
      broadcastRoom.current?.disconnect()
      const res = await fetchShowboxRoomToken(roomTokenUrl(roomName, true))
      if (!res?.token) throw new Error('no token')
      if (gen !== sessionGen.current) {
        broadcastReconnecting.current = false
        return
      }
      saveShowboxPublisherIdentity(roomName, res.token)
      const room = new Room()
      broadcastRoom.current = room
      wireBroadcastRoom(room)
      await room.connect(LIVEKIT_URL, res.token)
      if (gen !== sessionGen.current) {
        room.disconnect()
        if (broadcastRoom.current === room) broadcastRoom.current = null
        broadcastReconnecting.current = false
        return
      }
      await setShowboxLive(true)
      for (const t of tracks) await room.localParticipant.publishTrack(t)
      broadcastReconnecting.current = false
      broadcastReconnectAttempts.current = 0
      broadcastDisconnectStrikes.current = 0
      clearHealthUi()
      refreshBroadcastPreview()
    } catch {
      broadcastReconnecting.current = false
      if (broadcastReconnectAttempts.current >= BROADCAST_RECONNECT_MAX) onBroadcastLost(reason)
    }
  }

  const checkBroadcastHealth = () => {
    const room = broadcastRoom.current
    if (!room || broadcastLost || broadcastStopping.current || !liveRef.current) return
    if (broadcastReconnecting.current) return
    const state = (room as any).state
    if (state === 'disconnected') {
      maybeReconnectAfterDisconnect('connection lost')
      return
    }
    if (state === 'reconnecting') {
      setHealthStatus('reconnecting...')
      return
    }
    if (!cameraLostRef.current && !broadcastReconnecting.current) setHealthStatus('')
    if (liveStartedAt.current && Date.now() - liveStartedAt.current < BROADCAST_LIVE_GRACE_MS) return
    if (broadcastVideoTrackLive(room, liveVideoTrack.current)) {
      noteCameraHealthy(room)
    } else {
      noteCameraUnhealthy()
    }
    broadcastDisconnectStrikes.current = 0
    void setShowboxLive(true)
  }

  const tryResumeCamera = async () => {
    if (!broadcastRoom.current || broadcastLost || broadcastStopping.current) return
    if (broadcastVideoTrackLive(broadcastRoom.current, liveVideoTrack.current)) {
      noteCameraHealthy(broadcastRoom.current)
      return
    }
    if (!cameraLost) return
    const gen = ++cameraResumeGen.current
    setHealthStatus('reconnecting camera...')
    const room = broadcastRoom.current
    const lp = room.localParticipant
    let vt = liveVideoTrack.current
    try {
      const mst = vt?.mediaStreamTrack as MediaStreamTrack | undefined
      const dead = !mst || mst.readyState === 'ended'
      if (!dead && vt?.restartTrack) {
        if (mobile) await restartMobileCameraTrack(vt, flipFacingRef.current)
        else await vt.restartTrack({})
        if (gen !== cameraResumeGen.current || broadcastStopping.current || !broadcastRoom.current) return
      } else {
        const tracks = await createLocalTracks({
          video: showboxCameraVideoConstraints(camId || undefined),
          audio: false,
        })
        const newVt = tracks.find((t) => t.kind === Track.Kind.Video)
        if (!newVt) throw new Error('no camera')
        if (gen !== cameraResumeGen.current || broadcastStopping.current || !broadcastRoom.current) {
          // resume lost the race to a stop - kill the fresh camera or its light stays on
          for (const t of tracks) {
            try {
              t.stop()
            } catch {}
          }
          return
        }
        if (vt) {
          try {
            await lp.unpublishTrack(vt, true)
          } catch {}
          try {
            vt.stop()
          } catch {}
        }
        if (mobile) await restartMobileCameraTrack(newVt, flipFacingRef.current)
        await lp.publishTrack(newVt)
        vt = newVt
        const rest = liveTracks.current.filter((t) => t.kind !== Track.Kind.Video)
        liveTracks.current = [...rest, newVt]
      }
      liveVideoTrack.current = vt
      wireCameraEndedListener(vt)
      clearHealthUi()
      refreshBroadcastPreview()
      startThumb(previewVideo.current)
    } catch {
      if (gen !== cameraResumeGen.current || broadcastStopping.current) return
      setCameraLost(false)
      onBroadcastLost('camera reconnect failed')
    }
  }

  const stopAll = () => {
    broadcastStopping.current = true
    sessionGen.current++
    viewerConnectGen.current++
    cameraResumeGen.current++
    broadcastReconnecting.current = false
    broadcastReconnectAttempts.current = 0
    broadcastDisconnectStrikes.current = 0
    viewerReconnectAttempts.current = 0
    viewerDisconnectStrikes.current = 0
    viewerReconnecting.current = false
    cameraHealthStrikes.current = 0
    if (cameraEndedTimer.current) {
      clearTimeout(cameraEndedTimer.current)
      cameraEndedTimer.current = null
    }
    liveTracks.current = []
    setBroadcastLost(false)
    clearHealthUi()
    stopThumb()
    if (cohostBag.current) stopCohost(cohostBag.current)
    cohostBag.current = null
    try {
      broadcastRoom.current?.disconnect()
      viewerRoom.current?.disconnect()
    } catch {}
    broadcastRoom.current = null
    viewerRoom.current = null
    liveVideoTrack.current = null
    liveAudioTrack.current = null
    setRemoteCohostLive(false)
    liveRef.current = false
    setLive(false)
    setViewerListOpen(false)
    setViewerLines([])
    radarNames.current = new Map()
    parcelPresence.current = new Map()
    void setShowboxLive(false)
    // stays true until the next goLive - async reconnects woken after a stop must see it
  }

  const onRemoteCohostVideo = () => {
    setRemoteCohostLive(true)
    const bag = cohostBag.current
    const vt = liveVideoTrack.current
    if (bag && vt) {
      if (!cohostPaneFor(bag, 'local')) wireLocalCohostVideo(bag, vt.attach() as HTMLVideoElement)
      updateCohostComposite(bag)
      startThumb(null)
    }
  }

  const wireViewerRoom = (room: Room) => {
    room.on(RoomEvent.Disconnected, () => {
      if (viewerRoom.current !== room || !liveRef.current) return
      maybeReconnectViewer('connection lost')
    })
    const reconnected = (RoomEvent as any).Reconnected
    if (reconnected) {
      room.on(reconnected, () => {
        if (viewerRoom.current !== room) return
        viewerReconnecting.current = false
        viewerReconnectAttempts.current = 0
        viewerDisconnectStrikes.current = 0
        const bag = cohostBag.current
        if (bag && broadcastRoom.current) {
          for (const p of (room as any).participants?.values() ?? []) {
            for (const pub of p.videoTracks?.values() ?? []) {
              if (isAngleTrackPub(bag, pub)) continue
              if (pub.isSubscribed && pub.track) routeCohostVideo(bag, pub.track, p.identity, broadcastRoom.current, room, onRemoteCohostVideo)
            }
            for (const pub of p.audioTracks?.values() ?? []) {
              if (pub.isSubscribed && pub.track) routeCohostAudio(bag, pub.track, p.identity, broadcastRoom.current, room, room)
            }
          }
          updateCohostComposite(bag)
        }
      })
    }
  }

  const maybeReconnectViewer = (_reason: string) => {
    if (viewerReconnecting.current || !liveRef.current || !isCohost) return
    if (livekitRoomState(viewerRoom.current) === 'reconnecting') return
    // no strike threshold: there is no health poll on the viewer room, so Disconnected (which
    // fires once) is the only trigger - waiting for a second strike left it dead forever
    viewerDisconnectStrikes.current++
    void tryViewerReconnect(_reason)
  }

  const tryViewerReconnect = async (_reason: string) => {
    if (viewerReconnecting.current || !liveRef.current || !isCohost) return
    const gen = sessionGen.current
    if (viewerReconnectAttempts.current >= BROADCAST_RECONNECT_MAX) {
      viewerReconnectAttempts.current = 0
      viewerDisconnectStrikes.current = 0
      viewerRoom.current?.disconnect()
      viewerRoom.current = null
      await connectViewer()
      return
    }
    viewerReconnectAttempts.current++
    viewerReconnecting.current = true
    await new Promise((r) => setTimeout(r, 500 * viewerReconnectAttempts.current))
    if (!liveRef.current || gen !== sessionGen.current) {
      viewerReconnecting.current = false
      return
    }
    if (livekitRoomState(viewerRoom.current) === 'reconnecting') {
      viewerReconnecting.current = false
      return
    }
    viewerConnectGen.current++
    viewerRoom.current?.disconnect()
    viewerRoom.current = null
    viewerReconnecting.current = false
    await connectViewer()
    if (viewerRoom.current) {
      viewerReconnectAttempts.current = 0
      viewerDisconnectStrikes.current = 0
    }
  }

  const connectViewer = async () => {
    if (!isCohost) return
    const gen = ++viewerConnectGen.current
    const res = await fetchShowboxRoomToken(roomTokenUrl(roomName))
    if (!res?.token) return

    const room = new Room()
    viewerRoom.current = room
    wireViewerRoom(room)
    const bag = cohostBag.current!

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (viewerRoom.current !== room) return
      const identity = participant?.identity ?? ''
      if (track.kind === Track.Kind.Video && !isAngleTrackPub(bag, _pub)) routeCohostVideo(bag, track, identity, broadcastRoom.current, room, onRemoteCohostVideo)
      if (track.kind === Track.Kind.Audio) routeCohostAudio(bag, track, identity, broadcastRoom.current, room, room)
    })

    room.on(RoomEvent.ParticipantConnected, () => {
      if (viewerRoom.current !== room || !broadcastRoom.current) return
      for (const p of (room as any).participants?.values() ?? []) {
        for (const pub of p.videoTracks?.values() ?? []) {
          if (isAngleTrackPub(bag, pub)) continue
          if (pub.isSubscribed && pub.track) routeCohostVideo(bag, pub.track, p.identity, broadcastRoom.current, room, onRemoteCohostVideo)
        }
      }
    })

    try {
      await room.connect(LIVEKIT_URL, res.token)
      if (gen !== viewerConnectGen.current) {
        room.disconnect()
        return
      }
      for (const p of (room as any).participants?.values() ?? []) {
        for (const pub of p.videoTracks?.values() ?? []) {
          if (isAngleTrackPub(bag, pub)) continue
          if (pub.isSubscribed && pub.track) routeCohostVideo(bag, pub.track, p.identity, broadcastRoom.current, room, onRemoteCohostVideo)
        }
        for (const pub of p.audioTracks?.values() ?? []) {
          if (pub.isSubscribed && pub.track) routeCohostAudio(bag, pub.track, p.identity, broadcastRoom.current, room, room)
        }
      }
      updateCohostComposite(bag)
      viewerReconnectAttempts.current = 0
      viewerDisconnectStrikes.current = 0
    } catch {
      if (gen !== viewerConnectGen.current) return
      room.disconnect()
      viewerRoom.current = null
    }
  }

  const goLive = async () => {
    if (live) {
      stopAll()
      setStatus('')
      return
    }

    if (syntheticGuest) {
      const nextName = guestName.trim()
      if (!nextName) {
        setStatus('pick a name first')
        return
      }
      const token = guestPassToken()
      if (token && nextName !== app.state.name) {
        setStatus('saving name...')
        try {
          const r = await fetch(`/api/guest/${token}/name`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: nextName }),
          })
          const j = await r.json()
          if (!j.success) throw new Error(j.error || 'failed')
          app.setState({ name: nextName })
        } catch (e) {
          setStatus((e as Error)?.message || 'could not save name')
          return
        }
      }
    }

    broadcastStopping.current = false
    setBroadcastLost(false)
    clearHealthUi()
    setStatus('connecting...')
    // declared outside the try so a failed connect/publish can still stop them - otherwise
    // the camera light stays on after "could not go live"
    let tracks: any[] = []
    try {
      const tokenRes = await fetchShowboxRoomToken(roomTokenUrl(roomName, true))
      const res = tokenRes
      if (!res?.token) throw new Error(res?.error || 'could not get stream token - sign in again')
      if (res.canPublish === false) throw new Error('no permission to broadcast here')
      saveShowboxPublisherIdentity(roomName, res.token)

      try {
        tracks = await createLocalTracks({
          video: showboxCameraVideoConstraints(camId || undefined),
          audio: showboxAudioConstraints(audioMode, micId || undefined),
        })
      } catch (err) {
        throw new Error(cameraErrorMessage(err))
      }

      const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video)
      if (!videoTrack) throw new Error('showbox needs a camera')
      if (mobile) {
        await restartMobileCameraTrack(videoTrack, 'user')
        // every go-live starts front-facing - reset the flip state or the flip button needs
        // two taps and an auto camera-resume can silently switch to the rear camera
        flipFacingRef.current = 'user'
        setFlipFacing('user')
      }

      if (isCohost) {
        cohostBag.current = {
          panes: [],
          cohostCanvas: null,
          cohostMonitorEls: [],
          cohostCompositeRaf: null,
          cohostCompositeRetryRaf: null,
          editorWallets: parcelEditorWallets(parcel),
          isGuest,
          showUuid,
          // any showbox uuid as a track name marks an angle feed - main feeds are unnamed
          angleTrackNames: ((parcel?.content?.features ?? []) as any[]).filter((f) => f?.type === 'showbox').map((f) => String(f?.uuid || '').toLowerCase()),
          onRedraw: () => {
            const src = cohostBag.current?.cohostCanvas
            const dst = displayCanvas.current
            if (!src || !dst) return
            const ctx = dst.getContext('2d')
            if (!ctx) return
            if (dst.width !== src.width) dst.width = src.width
            if (dst.height !== src.height) dst.height = src.height
            ctx.drawImage(src, 0, 0)
          },
        }
      }

      const room = new Room()
      broadcastRoom.current = room
      wireBroadcastRoom(room)

      let viewerConnect = Promise.resolve()
      if (isCohost && !viewerRoom.current) viewerConnect = connectViewer()

      await room.connect(LIVEKIT_URL, res.token)
      await setShowboxLive(true)

      const bumpViewers = () => refreshViewers()
      room.on(RoomEvent.ParticipantConnected, bumpViewers)
      room.on(RoomEvent.ParticipantDisconnected, bumpViewers)
      refreshViewers()

      for (const t of tracks) await room.localParticipant.publishTrack(t)

      liveTracks.current = tracks
      liveStartedAt.current = Date.now()
      liveVideoTrack.current = videoTrack
      liveAudioTrack.current = tracks.find((t) => t.kind === Track.Kind.Audio) ?? null
      wireCameraEndedListener(videoTrack)
      setMicOn(!!liveAudioTrack.current)

      if (isCohost && cohostBag.current) await viewerConnect

      liveRef.current = true
      setLive(true)
      setStatus('')
      setElapsed(0)

      if (!liveChatAnnounced.current) {
        const hostName = (app.state.name || guestName || '').trim()
        if (hostName && parcel) {
          const helper = new ParcelHelper(parcel)
          const encoded = showboxAudiencePlayCoordsFromRecord(helper, feature)
          const location = parcel.name || parcel.address || 'the world'
          announceShowLive(hostName, location, encoded)
          liveChatAnnounced.current = true
        }
      }
    } catch (e) {
      for (const t of tracks) {
        try {
          t.stop()
        } catch {}
      }
      stopAll()
      setStatus((e as Error)?.message || 'could not go live')
    }
  }

  const flipCamera = async () => {
    const next = flipFacing === 'user' ? 'environment' : 'user'
    flipFacingRef.current = next
    setFlipFacing(next)
    const vt = liveVideoTrack.current
    if (vt && mobile) await restartMobileCameraTrack(vt, next)
    if (vt) wireCameraEndedListener(vt)
    if (broadcastRoom.current) noteCameraHealthy(broadcastRoom.current)
    syncPreviewVideo(vt)
    if (remoteCohostLive && cohostBag.current && broadcastRoom.current) {
      const el = vt?.attach() as HTMLVideoElement
      if (el) wireLocalCohostVideo(cohostBag.current, el)
    }
  }

  const toggleMic = async () => {
    if (!broadcastRoom.current) return
    const next = !micOn
    const lp = broadcastRoom.current.localParticipant
    // mic is already published at go-live - passing deviceId on unmute can open a second audio track (echo).
    // when there never was a mic, publish with the chosen room preset, not livekit defaults.
    const opts = next && !liveAudioTrack.current ? showboxAudioConstraints(audioMode, micId || undefined) : undefined
    await lp.setMicrophoneEnabled(next, opts).catch(() => {})
    setMicOn(next)
  }

  const copyUrl = (url: string) => {
    if (!url) return
    navigator.clipboard?.writeText(url).catch(() => {})
  }

  const replyToChat = () => {
    if (!sendChat(chatDraft)) return
    setChatDraft('')
    scrollChatToEnd()
    chatInputRef.current?.blur()
  }

  const onChatFocus = () => {
    setChatComposing(true)
    requestAnimationFrame(() => chatInputRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  const onChatBlur = () => {
    setTimeout(() => {
      if (document.activeElement === chatInputRef.current) return
      setChatComposing(false)
    }, 150)
  }

  const createGuestPassToken = async () => {
    if (!canManageGuests) return null
    try {
      const r = await fetch(`/api/parcels/${parcelId}/guest-passes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ feature_uuid: showUuid }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) return null
      return j.pass?.token ?? null
    } catch {
      return null
    }
  }

  const resolveGuestShareUrl = async () => {
    if (guestUrl) return guestUrl
    let token: string | null = null
    try {
      const gr = await fetch(`/api/parcels/${parcelId}/guest-passes?feature_uuid=${encodeURIComponent(showUuid)}`, { credentials: 'include', cache: 'no-store' })
      const gj = await gr.json().catch(() => null)
      const pass = (gj?.passes ?? []).find((x: any) => !x.revoked_at)
      token = pass?.token ?? null
    } catch {}
    if (!token && canManageGuests) {
      token = await createGuestPassToken()
      if (!token) {
        setStatus('could not create guest link')
        return null
      }
    }
    if (!token) return null
    const url = `${window.location.origin}/live/${token}`
    setGuestUrl(url)
    return url
  }

  const copyGuestUrl = async () => {
    const url = await resolveGuestShareUrl()
    if (url) copyUrl(url)
    else if (!canManageGuests) setStatus('ask someone with edit access for a co-host link')
  }

  const shareShowUrl = async (kind: 'fan' | 'guest') => {
    if (kind === 'guest') {
      const url = await resolveGuestShareUrl()
      if (!url) {
        if (!canManageGuests) setStatus('no guest link yet - ask someone with edit access')
        return
      }
      const text = `Join my show on camera in voxels: ${url}`
      if (navigator.share) {
        try {
          await navigator.share({ title: 'voxels show', text, url })
          return
        } catch (e) {
          if ((e as DOMException)?.name === 'AbortError') return
        }
      }
      copyUrl(url)
      return
    }
    if (!fanUrl) return
    const text = `Going live in voxels - Teleport in! ${fanUrl}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'voxels show', text, url: fanUrl })
        return
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return
      }
    }
    copyUrl(fanUrl)
  }

  if (!isGuest && !signedIn) return <Login reason="go live" />

  if (loading) {
    return (
      <div class={dockClass(false)}>
        <Spinner size={24} />
      </div>
    )
  }

  if (error) {
    return (
      <div class={dockClass(false)}>
        <div class="showbox-dock-title">Showbox</div>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div ref={dockRef} class={dockClass(live, chatComposing)}>
      <div class="showbox-dock-title">Showbox</div>
      {isGuest && !live && <small class="showbox-dock-hint">{isCohost ? 'Co-host: go live when ready. Use headphones to reduce echo.' : `You're joining as a guest at ${parcelLabel}.`}</small>}

      {syntheticGuest && !live && (
        <div class="showbox-dock-device-row">
          <label>Name</label>
          <input type="text" value={guestName} placeholder="e.g. DJ ANON" onInput={(e) => setGuestName((e.target as HTMLInputElement).value)} />
        </div>
      )}

      {live && (
        <>
          <div class="showbox-dock-live-head" style={broadcastLost ? 'color:#888' : ''}>
            <span class="showbox-dock-live-dot" style={broadcastLost ? 'color:#888;animation:none' : ''}>
              &#9679;
            </span>{' '}
            {broadcastLost ? 'offline' : 'live'}{' '}
            {mobile ? (
              <button type="button" class="showbox-dock-viewer-count" onClick={() => setViewerListOpen(!viewerListOpen)}>
                {viewerCountLabel(viewers)}
              </button>
            ) : (
              <span>{viewerCountLabel(viewers)}</span>
            )}
            <span class="showbox-dock-timer">{formatTimer(elapsed)}</span>
          </div>
          {mobile && viewerListOpen && <div class="showbox-dock-viewer-list">{viewerLines.length ? viewerLines.map((v) => <div key={v.id}>{v.name}</div>) : <div class="showbox-dock-viewer-empty">no one watching yet</div>}</div>}

          <div ref={previewWrap} class={`showbox-dock-preview ${mobile ? 'mobile' : 'desktop'}`}>
            {isCohost && remoteCohostLive ? (
              <canvas ref={displayCanvas} width={640} height={360} style={{ position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', display: 'block' }} />
            ) : (
              <video ref={previewVideo} playsInline muted autoplay />
            )}
            <div class="showbox-dock-preview-label">what your audience sees</div>
          </div>

          <div class="showbox-dock-live-tools">
            <button type="button" class="showbox-dock-link-btn" onClick={toggleMic}>
              {micOn ? 'mute mic' : 'unmute mic'}
            </button>
            {mobile && (
              <button type="button" class="showbox-dock-link-btn" onClick={flipCamera}>
                flip camera
              </button>
            )}
          </div>
          {!isGuest && canManageGuests && stageGuests.length > 0 && (
            <div class="f">
              <label>on stage</label>
              {stageGuests.map((g) => (
                <div key={g.identity} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name || 'guest'}</span>
                  {!g.audioMuted && (
                    <button type="button" class="showbox-dock-link-btn" onClick={() => void moderateGuest(g.identity, 'mute')}>
                      mute
                    </button>
                  )}
                  <button type="button" class="showbox-dock-link-btn" onClick={() => void moderateGuest(g.identity, 'kick')}>
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {cameraLost && !broadcastLost && (
            <button type="button" class="showbox-dock-link-btn" onClick={() => void tryResumeCamera()}>
              reconnect camera
            </button>
          )}
          {healthStatus && (
            <div class="showbox-dock-status" style="color:#f5b942">
              {healthStatus}
            </div>
          )}

          <div class="showbox-dock-chat-block">
            <div ref={chatBox} class="showbox-dock-chat-box">
              {chatMessages.value.slice(-30).map((m, i) => (
                <div key={m.uuid || i}>
                  <span class="showbox-dock-chat-who">{m.who || 'anon'}: </span>
                  <span>{m.text}</span>
                </div>
              ))}
              {!chatMessages.value.length && <div class="showbox-dock-chat-empty">audience chat shows up here</div>}
            </div>
            <div class="showbox-dock-chat-reply">
              <input
                ref={chatInputRef}
                type="text"
                value={chatDraft}
                placeholder="reply to chat"
                onInput={(e) => setChatDraft((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    replyToChat()
                  }
                }}
                onFocus={onChatFocus}
                onBlur={onChatBlur}
              />
              <button type="button" onClick={replyToChat}>
                send
              </button>
            </div>
          </div>
        </>
      )}

      {!live && (
        <div class="showbox-dock-device-row">
          <label>camera</label>
          <select value={camId} onChange={(e) => setCamId((e.target as HTMLSelectElement).value)}>
            <option value="">default</option>
            {cameras.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'camera'}
              </option>
            ))}
          </select>
          <label>microphone</label>
          <select value={micId} onChange={(e) => setMicId((e.target as HTMLSelectElement).value)}>
            <option value="">default</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'mic'}
              </option>
            ))}
          </select>
          <label>what's your room like?</label>
          <select value={audioMode} onChange={(e) => setAudioMode((e.target as HTMLSelectElement).value as ShowboxAudioMode)}>
            {SHOWBOX_ROOM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <small class="showbox-dock-hint">{showboxRoomHint(audioMode)}</small>
        </div>
      )}

      {!live && status && <div class="showbox-dock-status">{status}</div>}

      <div class="showbox-dock-footer">
        {live && !isGuest && canManageGuests && mobile && (
          <div class="showbox-dock-share-split">
            {sharePickOpen && (
              <div class="showbox-dock-share-menu">
                <button
                  type="button"
                  onClick={() => {
                    setShareLinkKind('fan')
                    setSharePickOpen(false)
                  }}
                >
                  fan link - for people watching
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShareLinkKind('guest')
                    setSharePickOpen(false)
                  }}
                >
                  co-host link - for your DJ or guest on camera
                </button>
              </div>
            )}
            <button
              type="button"
              class="showbox-dock-share-main"
              onClick={() => {
                setSharePickOpen(false)
                void shareShowUrl(shareLinkKind)
              }}
            >
              {shareLinkKind === 'fan' ? 'share fan link' : 'share co-host link'}
            </button>
            <button
              type="button"
              class="showbox-dock-share-pick"
              title="pick fan or guest link"
              onClick={(e) => {
                e.stopPropagation()
                setSharePickOpen(!sharePickOpen)
              }}
            >
              v
            </button>
          </div>
        )}
        {live && !isGuest && !canManageGuests && mobile && fanUrl && (
          <button type="button" class="showbox-dock-share-main" onClick={() => void shareShowUrl('fan')}>
            share fan link
          </button>
        )}
        {live && isGuest && mobile && (
          <button type="button" class="showbox-dock-share-main" onClick={() => void shareShowUrl('fan')}>
            share fan link
          </button>
        )}
        {live && !isGuest && canManageGuests && !mobile && (
          <div class="showbox-dock-share-block">
            <label>fan link - share with your audience</label>
            <div class="showbox-dock-share-row">
              <input type="text" readonly value={fanUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button type="button" onClick={() => copyUrl(fanUrl)}>
                copy
              </button>
            </div>
            <label>co-host link - for your DJ or guest on camera</label>
            <div class="showbox-dock-share-row">
              <input type="text" readonly value={guestUrl || 'tap copy to get co-host link'} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button type="button" onClick={() => void copyGuestUrl()}>
                copy
              </button>
            </div>
          </div>
        )}
        {live && !isGuest && !canManageGuests && !mobile && fanUrl && (
          <div class="showbox-dock-share-block">
            <label>fan link - share with your audience</label>
            <div class="showbox-dock-share-row">
              <input type="text" readonly value={fanUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button type="button" onClick={() => copyUrl(fanUrl)}>
                copy
              </button>
            </div>
          </div>
        )}
        <div class="showbox-dock-footer-row">
          <button type="button" class={`showbox-dock-go${live ? ' stop' : ''}`} onClick={goLive}>
            {live ? 'stop streaming' : 'go live'}
          </button>
          {!live && (
            <button type="button" class="showbox-dock-cancel" onClick={() => window.history.back()}>
              close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
