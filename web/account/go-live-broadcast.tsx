import Cookies from 'js-cookie'
import { decodeJwt } from 'jose'
import { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client'
import { effect } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  BROADCAST_DISCONNECT_STRIKES,
  BROADCAST_HEALTH_POLL_MS,
  BROADCAST_LIVE_GRACE_MS,
  BROADCAST_RECONNECT_MAX,
  broadcastVideoTrackLive,
} from '../../common/helpers/showbox-broadcast-health'
import { showboxAudioConstraints, showboxRoomHint, SHOWBOX_ROOM_OPTIONS, type ShowboxAudioMode } from '../../common/helpers/showbox-audio-constraints'
import { isMobile } from '../../common/helpers/detector'
import { consumeGuestFreshFromUrl } from '../../common/helpers/guest-pass-client'
import ParcelHelper, { showboxAudiencePlayCoordsFromRecord, showboxFanSharePlayQuery } from '../../common/helpers/parcel-helper'
import { avatarName } from '../../common/messages/avatar-ref'
import { Login } from '../src/auth/login'
import cachedFetch, { invalidateUrl } from '../src/helpers/cached-fetch'
import { announceShowLive, chatMessages, connectShardChat, disconnectShardChat, sendChat } from '../src/shard-chat'
import { Spinner } from '../src/spinner'
import { app } from '../src/state'
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

function roomTokenUrl(roomName: string) {
  const pass = guestPassToken()
  if (pass && !guestJwtPayload()?.guest_pass) {
    return `/api/rooms/${roomName}/token?guest_pass=${encodeURIComponent(pass)}`
  }
  return `/api/rooms/${roomName}/token`
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
  return [...byWallet.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
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

type CohostBag = {
  ownerVideoEl: HTMLVideoElement | null
  guestVideoEl: HTMLVideoElement | null
  cohostCanvas: HTMLCanvasElement | null
  cohostMonitorEls: HTMLAudioElement[]
  cohostOwnerHadFrame: boolean
  cohostGuestHadFrame: boolean
  cohostCompositeRaf: number | null
  cohostCompositeRetryRaf: number | null
  editorWallets: string[]
  isGuest: boolean
  showUuid: string
  onRedraw: () => void
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
  if (theirs === myPub || theirs === mySub) return false
  if (bag.isGuest) return !isGuestPublisherIdentity(bag, participantIdentity)
  return isGuestPublisherIdentity(bag, participantIdentity)
}

function shouldRouteCohostVideo(bag: CohostBag, broadcastRoom: Room | null, viewerRoom: Room | null, participantIdentity: string) {
  return shouldPlayCohostAudio(bag, broadcastRoom, viewerRoom, participantIdentity)
}

function drawCohostFrame(bag: CohostBag) {
  if (!bag.cohostCanvas) return false
  const ownerEl = bag.ownerVideoEl
  const guestEl = bag.guestVideoEl
  if (ownerEl && !cohostVideoTrackLive(ownerEl)) bag.cohostOwnerHadFrame = false
  else if (cohostVideoReady(ownerEl)) bag.cohostOwnerHadFrame = true
  if (guestEl && !cohostVideoTrackLive(guestEl)) bag.cohostGuestHadFrame = false
  else if (cohostVideoReady(guestEl)) bag.cohostGuestHadFrame = true

  const ownerDraw = bag.cohostOwnerHadFrame && ownerEl
  const guestDraw = bag.cohostGuestHadFrame && guestEl
  if (!ownerDraw && !guestDraw) return false

  const canvas = bag.cohostCanvas
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  ctx.fillStyle = '#0d0d0d'
  ctx.fillRect(0, 0, w, h)
  const drawVid = (el: HTMLVideoElement, x: number, dw: number) => {
    if (el.videoWidth > 0) ctx.drawImage(el, x, 0, dw, h)
  }
  if (ownerDraw && guestDraw) {
    drawVid(ownerEl!, 0, w / 2)
    drawVid(guestEl!, w / 2, w / 2)
  } else if (ownerDraw) {
    drawVid(ownerEl!, 0, w)
  } else if (guestDraw) {
    drawVid(guestEl!, 0, w)
  }
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

function routeCohostVideo(
  bag: CohostBag,
  track: any,
  identity: string,
  broadcastRoom: Room | null,
  viewerRoom: Room | null,
  onRemote?: () => void,
) {
  if (!shouldRouteCohostVideo(bag, broadcastRoom, viewerRoom, identity)) return
  onRemote?.()
  const isGuest = isGuestPublisherIdentity(bag, identity)
  const el = track.attach() as HTMLVideoElement
  el.muted = true
  el.playsInline = true
  el.autoplay = true
  el.style.display = 'none'
  document.body.appendChild(el)
  el.play().catch(() => {})
  el.addEventListener('loadeddata', () => updateCohostComposite(bag), { once: true })
  if (isGuest) {
    bag.guestVideoEl?.remove()
    bag.guestVideoEl = el
  } else {
    bag.ownerVideoEl?.remove()
    bag.ownerVideoEl = el
  }
  updateCohostComposite(bag)
}

function routeCohostAudio(bag: CohostBag, track: any, identity: string, broadcastRoom: Room | null, viewerRoom: Room | null, room: Room) {
  if (!shouldPlayCohostAudio(bag, broadcastRoom, viewerRoom, identity)) return
  const prefix = cohostIdentityPrefix(identity)
  for (let i = bag.cohostMonitorEls.length - 1; i >= 0; i--) {
    const el = bag.cohostMonitorEls[i] as HTMLAudioElement & { dataset: { cohostPrefix?: string } }
    if (el.dataset?.cohostPrefix === prefix) {
      el.remove()
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
  if (bag.isGuest) {
    bag.guestVideoEl?.remove()
    bag.guestVideoEl = el
  } else {
    bag.ownerVideoEl?.remove()
    bag.ownerVideoEl = el
  }
  updateCohostComposite(bag)
}

function stopCohost(bag: CohostBag) {
  if (bag.cohostCompositeRaf) cancelAnimationFrame(bag.cohostCompositeRaf)
  if (bag.cohostCompositeRetryRaf) cancelAnimationFrame(bag.cohostCompositeRetryRaf)
  bag.cohostCompositeRaf = null
  bag.cohostCompositeRetryRaf = null
  bag.ownerVideoEl?.remove()
  bag.guestVideoEl?.remove()
  for (const el of bag.cohostMonitorEls) el.remove()
  bag.ownerVideoEl = null
  bag.guestVideoEl = null
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

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [parcel, setParcel] = useState<any>(null)
  const [feature, setFeature] = useState<any>(null)
  const [live, setLive] = useState(false)
  const [status, setStatus] = useState('tap go live when ready')
  const [viewers, setViewers] = useState(0)
  const [viewerLines, setViewerLines] = useState<{ id: string; name: string }[]>([])
  const [viewerListOpen, setViewerListOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [micOn, setMicOn] = useState(true)
  const [chatDraft, setChatDraft] = useState('')
  const [guestName, setGuestName] = useState(() => (isSyntheticGuestWallet() ? '' : (app.state.name || '')))
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
  const viewerRoom = useRef<Room | null>(null)
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
    if (consumeGuestFreshFromUrl((n) => app.setName(n))) setGuestName('')
  }, [])

  useEffect(() => {
    if (!parcelId || !showUuid) {
      setError('missing parcel or showbox')
      setLoading(false)
      return
    }
    if (!isGuest && !app.signedIn) {
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
              setGuestUrl(`${window.location.origin}/live/${pass.token}?light=1`)
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
  }, [parcelId, showUuid, isGuest])

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

    const lines = [...merged.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

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
    const t = setInterval(() => setElapsed(Date.now() - liveStartedAt.current), 1000)
    refreshViewers()
    const v = setInterval(() => {
      checkBroadcastHealth()
      refreshViewers()
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
          ctx.drawImage(cohostBag.current.cohostCanvas, 0, 0, 256, 144)
        } else if (videoEl && videoEl.videoWidth > 0) {
          ctx.drawImage(videoEl, 0, 0, 256, 144)
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
      const slot = bag.isGuest ? bag.guestVideoEl : bag.ownerVideoEl
      if (!slot) wireLocalCohostVideo(bag, vt.attach() as HTMLVideoElement)
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
      onCameraDisconnected()
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
    if (broadcastLost || broadcastReconnecting.current || broadcastStopping.current || !live) return
    broadcastDisconnectStrikes.current++
    if (broadcastDisconnectStrikes.current < BROADCAST_DISCONNECT_STRIKES) {
      setHealthStatus('connection unstable...')
      return
    }
    void tryBroadcastReconnect(reason)
  }

  const tryBroadcastReconnect = async (reason: string) => {
    if (broadcastLost || broadcastReconnecting.current || broadcastStopping.current || !live) return
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
      broadcastRoom.current?.disconnect()
      const tokenRes = await fetch(roomTokenUrl(roomName), { credentials: 'include' })
      const res = await tokenRes.json().catch(() => null)
      if (!tokenRes.ok || !res?.token) throw new Error('no token')
      const room = new Room()
      broadcastRoom.current = room
      wireBroadcastRoom(room)
      await room.connect(LIVEKIT_URL, res.token)
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
    if (!room || broadcastLost || broadcastStopping.current || !live) return
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
    if (cameraLostRef.current) return
    if (liveStartedAt.current && Date.now() - liveStartedAt.current < BROADCAST_LIVE_GRACE_MS) return
    if (!broadcastVideoTrackLive(room, liveVideoTrack.current)) {
      onCameraDisconnected()
      return
    }
    broadcastDisconnectStrikes.current = 0
    void setShowboxLive(true)
  }

  const tryResumeCamera = async () => {
    if (!broadcastRoom.current || broadcastLost || !cameraLost || broadcastStopping.current) return
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
        if (gen !== cameraResumeGen.current || broadcastStopping.current || !broadcastRoom.current) return
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
    cameraResumeGen.current++
    broadcastReconnecting.current = false
    broadcastReconnectAttempts.current = 0
    broadcastDisconnectStrikes.current = 0
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
    setLive(false)
    setViewerListOpen(false)
    setViewerLines([])
    radarNames.current = new Map()
    parcelPresence.current = new Map()
    void setShowboxLive(false)
    broadcastStopping.current = false
  }

  const onRemoteCohostVideo = () => {
    setRemoteCohostLive(true)
    const bag = cohostBag.current
    const vt = liveVideoTrack.current
    if (bag && vt) {
      const localSlot = bag.isGuest ? bag.guestVideoEl : bag.ownerVideoEl
      if (!localSlot) wireLocalCohostVideo(bag, vt.attach() as HTMLVideoElement)
      updateCohostComposite(bag)
      startThumb(null)
    }
  }

  const connectViewer = async () => {
    if (!isCohost) return
    const tokenRes = await fetch(roomTokenUrl(roomName), { credentials: 'include' })
    const res = await tokenRes.json().catch(() => null)
    if (!tokenRes.ok || !res?.token) return

    const room = new Room()
    viewerRoom.current = room
    const bag = cohostBag.current!

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (viewerRoom.current !== room) return
      const identity = participant?.identity ?? ''
      if (track.kind === Track.Kind.Video) routeCohostVideo(bag, track, identity, broadcastRoom.current, room, onRemoteCohostVideo)
      if (track.kind === Track.Kind.Audio) routeCohostAudio(bag, track, identity, broadcastRoom.current, room, room)
    })

    room.on(RoomEvent.ParticipantConnected, () => {
      if (viewerRoom.current !== room || !broadcastRoom.current) return
      for (const p of (room as any).participants?.values() ?? []) {
        for (const pub of p.videoTracks?.values() ?? []) {
          if (pub.isSubscribed && pub.track) routeCohostVideo(bag, pub.track, p.identity, broadcastRoom.current, room, onRemoteCohostVideo)
        }
      }
    })

    try {
      await room.connect(LIVEKIT_URL, res.token)
      for (const p of (room as any).participants?.values() ?? []) {
        for (const pub of p.videoTracks?.values() ?? []) {
          if (pub.isSubscribed && pub.track) routeCohostVideo(bag, pub.track, p.identity, broadcastRoom.current, room, onRemoteCohostVideo)
        }
        for (const pub of p.audioTracks?.values() ?? []) {
          if (pub.isSubscribed && pub.track) routeCohostAudio(bag, pub.track, p.identity, broadcastRoom.current, room, room)
        }
      }
      updateCohostComposite(bag)
    } catch {
      room.disconnect()
      viewerRoom.current = null
    }
  }

  const goLive = async () => {
    if (live) {
      stopAll()
      setStatus('tap go live when ready')
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
    try {
      const tokenRes = await fetch(roomTokenUrl(roomName), { credentials: 'include' })
      const res = await tokenRes.json().catch(() => null)
      if (!tokenRes.ok || !res?.token) throw new Error(res?.error || 'could not get stream token - sign in again')
      if (res.canPublish === false) throw new Error('no permission to broadcast here')

      let tracks: any[]
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
      if (mobile) await restartMobileCameraTrack(videoTrack, 'user')

      if (isCohost) {
        cohostBag.current = {
          ownerVideoEl: null,
          guestVideoEl: null,
          cohostCanvas: null,
          cohostMonitorEls: [],
          cohostOwnerHadFrame: false,
          cohostGuestHadFrame: false,
          cohostCompositeRaf: null,
          cohostCompositeRetryRaf: null,
          editorWallets: parcelEditorWallets(parcel),
          isGuest,
          showUuid,
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
    const opts = next && !liveAudioTrack.current ? { deviceId: micId || undefined } : undefined
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
      if (!confirm('create a guest link?')) return null
      token = await createGuestPassToken()
      if (!token) {
        setStatus('could not create guest link')
        return null
      }
    }
    if (!token) return null
    const url = `${window.location.origin}/live/${token}?light=1`
    setGuestUrl(url)
    return url
  }

  const shareShowUrl = async (kind: 'fan' | 'guest') => {
    if (kind === 'guest') {
      const url = await resolveGuestShareUrl()
      if (!url) {
        if (!canManageGuests) setStatus('no guest link yet - ask someone with edit access')
        return
      }
      const text = `Join my show in voxels - go live here: ${url}`
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

  if (!isGuest && !app.signedIn) return <Login reason="go live" />

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
      {isCohost && (
        <small class="showbox-dock-hint">
          {isGuest ? 'co-host -- go live when ready. use headphones to reduce echo' : 'co-host -- share the guest link, then go live. use headphones to reduce echo'}
        </small>
      )}
      {isGuest && !live && <small class="showbox-dock-hint">you're joining as guest at {parcelLabel}</small>}

      {syntheticGuest && !live && (
        <div class="showbox-dock-device-row">
          <label>Name</label>
          <input type="text" value={guestName} placeholder="e.g. DJ ANON" onInput={(e) => setGuestName((e.target as HTMLInputElement).value)} />
        </div>
      )}

      {live && (
        <>
          <div class="showbox-dock-live-head" style={broadcastLost ? 'color:#888' : ''}>
            <span class="showbox-dock-live-dot" style={broadcastLost ? 'color:#888;animation:none' : ''}>&#9679;</span>{' '}
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
          {mobile && viewerListOpen && (
            <div class="showbox-dock-viewer-list">
              {viewerLines.length ? (
                viewerLines.map((v) => <div key={v.id}>{v.name}</div>)
              ) : (
                <div class="showbox-dock-viewer-empty">no one watching yet</div>
              )}
            </div>
          )}

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
          {cameraLost && !broadcastLost && (
            <button type="button" class="showbox-dock-link-btn" onClick={() => void tryResumeCamera()}>
              reconnect camera
            </button>
          )}
          {healthStatus && <div class="showbox-dock-status" style="color:#f5b942">{healthStatus}</div>}

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
        {live && mobile && !isGuest && (
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
                  guest link - for your co-host or DJ/Artist
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
              {shareLinkKind === 'fan' ? 'share fan link' : 'share guest link'}
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
        {live && mobile && isGuest && (
          <button type="button" class="showbox-dock-share-main" onClick={() => void shareShowUrl('fan')}>
            share fan link
          </button>
        )}
        {live && !mobile && (
          <div class="showbox-dock-share-block">
            <label>fan link - share with your audience</label>
            <div class="showbox-dock-share-row">
              <input type="text" readonly value={fanUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button type="button" onClick={() => copyUrl(fanUrl)}>
                copy
              </button>
            </div>
            {!isGuest && (
              <>
                <label>guest link - for your co-host or DJ/Artist</label>
                <div class="showbox-dock-share-row">
                  <input type="text" readonly value={guestUrl || 'no guest link yet'} onClick={(e) => (e.target as HTMLInputElement).select()} />
                  <button type="button" onClick={() => copyUrl(guestUrl)} disabled={!guestUrl}>
                    copy
                  </button>
                </div>
              </>
            )}
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
