import Cookies from 'js-cookie'
import { decodeJwt } from 'jose'
import { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client'
import { useEffect, useRef, useState } from 'preact/hooks'
import { isMobile } from '../../common/helpers/detector'
import ParcelHelper, { showboxAudiencePlayCoordsFromRecord } from '../../common/helpers/parcel-helper'
import { Login } from '../src/auth/login'
import cachedFetch from '../src/helpers/cached-fetch'
import { announceShowLive, chatMessages, connectShardChat, disconnectShardChat, sendChat } from '../src/shard-chat'
import { Spinner } from '../src/spinner'
import { app } from '../src/state'
import { fetchOptions } from '../src/utils'

const LIVEKIT_URL = 'https://voxels-7pvk06qt.livekit.cloud'
const mobile = isMobile()

function showboxMobileCameraConstraints(facing: 'user' | 'environment' = 'user') {
  const c: Record<string, any> = { facingMode: facing }
  if (facing === 'user') c.aspectRatio = { ideal: 9 / 16 }
  return c
}

function showboxCameraVideoConstraints(deviceId: string | undefined) {
  if (mobile) return showboxMobileCameraConstraints('user')
  const c: Record<string, any> = {}
  if (deviceId) c.deviceId = { exact: deviceId }
  return c
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
  const showMatch = new URL(window.location.href).searchParams.get('show')?.toLowerCase() === showUuid.toLowerCase()
  if (isSyntheticGuestWallet()) {
    const payload = guestJwtPayload()
    if (payload?.feature_uuid?.toLowerCase() === showUuid.toLowerCase()) return true
    return showMatch
  }
  if (app.signedIn && guestPassToken() && showMatch) return true
  return false
}

function roomTokenUrl(roomName: string) {
  const pass = guestPassToken()
  if (pass && !guestJwtPayload()?.guest_pass) {
    return `/api/rooms/${roomName}/token?guest_pass=${encodeURIComponent(pass)}`
  }
  return `/api/rooms/${roomName}/token`
}

function parcelEditorWallets(parcel: any): string[] {
  const out = new Set<string>()
  if (parcel?.owner) out.add(String(parcel.owner).toLowerCase())
  for (const pu of parcel?.parcel_users ?? []) {
    if (pu?.role === 'owner' || pu?.role === 'contributor' || pu?.role === 'moderator') {
      if (pu.wallet) out.add(String(pu.wallet).toLowerCase())
    }
  }
  return [...out]
}

function formatTimer(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
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

function routeCohostVideo(bag: CohostBag, track: any, identity: string) {
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

const panelStyle: Record<string, string> = {
  background: '#1a1a1a',
  color: '#f5f5f0',
  padding: '1rem',
  maxWidth: '480px',
  margin: '0 auto',
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
  const [elapsed, setElapsed] = useState(0)
  const [micOn, setMicOn] = useState(true)
  const [chatDraft, setChatDraft] = useState('')
  const [guestName, setGuestName] = useState(app.state.name || '')
  const [fanUrl, setFanUrl] = useState('')
  const [guestUrl, setGuestUrl] = useState('')
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [camId, setCamId] = useState('')
  const [micId, setMicId] = useState('')
  const [flipFacing, setFlipFacing] = useState<'user' | 'environment'>('user')
  const [previewTick, setPreviewTick] = useState(0)

  const broadcastRoom = useRef<Room | null>(null)
  const viewerRoom = useRef<Room | null>(null)
  const liveVideoTrack = useRef<any>(null)
  const liveAudioTrack = useRef<any>(null)
  const liveStartedAt = useRef(0)
  const thumbInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const thumbCanvas = useRef<HTMLCanvasElement | null>(null)
  const previewVideo = useRef<HTMLVideoElement | null>(null)
  const previewWrap = useRef<HTMLDivElement | null>(null)
  const cohostBag = useRef<CohostBag | null>(null)
  const liveChatAnnounced = useRef(false)

  const isGuest = showUuid ? isGuestForShowbox(showUuid) : false
  const syntheticGuest = isGuest && isSyntheticGuestWallet()
  const guestMode = feature?.guestMode === 'solo' ? 'solo' : 'cohost'
  const isCohost = guestMode === 'cohost'
  const roomName = parcelId ? `parcel-${parcelId}` : ''
  const parcelLabel = parcel ? new ParcelHelper(parcel).ownerName || parcel.name?.trim() || parcel.address?.trim() || `parcel #${parcelId}` : ''

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
          setFanUrl(`${window.location.origin}/play?coords=${encodeURIComponent(audienceCoords)}&show=${encodeURIComponent(showUuid)}&isolate=true&distance=close`)
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
    if (!live) return
    const t = setInterval(() => setElapsed(Date.now() - liveStartedAt.current), 1000)
    const v = setInterval(async () => {
      try {
        const r = await fetch(`/api/rooms/${roomName}`, { credentials: 'include' })
        const j = await r.json().catch(() => null)
        setViewers(j?.room?.numParticipants ?? 0)
      } catch {}
    }, 5000)
    return () => {
      clearInterval(t)
      clearInterval(v)
    }
  }, [live, roomName])

  const syncPreviewVideo = (track: any) => {
    const el = previewVideo.current
    const mst = track?.mediaStreamTrack as MediaStreamTrack | undefined
    if (!el || !mst || mst.readyState === 'ended') return
    el.srcObject = new MediaStream([mst])
    el.play().catch(() => {})
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

  const stopAll = () => {
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
    setLive(false)
    void setShowboxLive(false)
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
      if (track.kind === Track.Kind.Video) routeCohostVideo(bag, track, identity)
      if (track.kind === Track.Kind.Audio && shouldPlayCohostAudio(bag, broadcastRoom.current, room, identity)) {
        const el = track.attach() as HTMLAudioElement
        el.style.display = 'none'
        document.body.appendChild(el)
        bag.cohostMonitorEls.push(el)
        room.startAudio().catch(() => {})
      }
    })

    room.on(RoomEvent.ParticipantConnected, () => {
      if (viewerRoom.current !== room || !broadcastRoom.current) return
      for (const p of (room as any).participants?.values() ?? []) {
        for (const pub of p.videoTracks?.values() ?? []) {
          if (pub.isSubscribed && pub.track) routeCohostVideo(bag, pub.track, p.identity)
        }
      }
    })

    try {
      await room.connect(LIVEKIT_URL, res.token)
      for (const p of (room as any).participants?.values() ?? []) {
        for (const pub of p.videoTracks?.values() ?? []) {
          if (pub.isSubscribed && pub.track) routeCohostVideo(bag, pub.track, p.identity)
        }
        if (shouldPlayCohostAudio(bag, broadcastRoom.current, room, p.identity)) {
          for (const pub of p.audioTracks?.values() ?? []) {
            if (pub.isSubscribed && pub.track) {
              const el = pub.track.attach() as HTMLAudioElement
              el.style.display = 'none'
              document.body.appendChild(el)
              bag.cohostMonitorEls.push(el)
            }
          }
        }
      }
      room.startAudio().catch(() => {})
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
          audio: { deviceId: micId ? { exact: micId } : undefined },
        })
      } catch (err) {
        throw new Error(cameraErrorMessage(err))
      }

      const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video)
      if (!videoTrack) throw new Error('showbox needs a camera')
      if (mobile) await videoTrack.restartTrack(showboxMobileCameraConstraints('user')).catch(() => {})

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
            const wrap = previewWrap.current
            const canvas = cohostBag.current?.cohostCanvas
            if (wrap && canvas && canvas.parentElement !== wrap) {
              canvas.style.width = '100%'
              canvas.style.display = 'block'
              wrap.replaceChildren(canvas)
            }
            setPreviewTick((n) => n + 1)
          },
        }
      }

      const room = new Room()
      broadcastRoom.current = room

      let viewerConnect = Promise.resolve()
      if (isCohost && !viewerRoom.current) viewerConnect = connectViewer()

      await room.connect(LIVEKIT_URL, res.token)
      await setShowboxLive(true)

      for (const t of tracks) await room.localParticipant.publishTrack(t)

      liveStartedAt.current = Date.now()
      liveVideoTrack.current = videoTrack
      liveAudioTrack.current = tracks.find((t) => t.kind === Track.Kind.Audio) ?? null
      setMicOn(!!liveAudioTrack.current)

      const el = videoTrack.attach() as HTMLVideoElement
      el.muted = true
      el.playsInline = true

      if (isCohost && cohostBag.current) {
        await viewerConnect
        wireLocalCohostVideo(cohostBag.current, el)
        updateCohostComposite(cohostBag.current)
        startThumb(null)
      } else {
        syncPreviewVideo(videoTrack)
        startThumb(previewVideo.current)
      }

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

      setLive(true)
      setStatus('')
      setElapsed(0)
    } catch (e) {
      stopAll()
      setStatus((e as Error)?.message || 'could not go live')
    }
  }

  const flipCamera = async () => {
    const next = flipFacing === 'user' ? 'environment' : 'user'
    setFlipFacing(next)
    const vt = liveVideoTrack.current
    if (vt && mobile) await vt.restartTrack(showboxMobileCameraConstraints(next)).catch(() => {})
    syncPreviewVideo(vt)
    if (cohostBag.current && broadcastRoom.current) {
      const el = vt?.attach() as HTMLVideoElement
      if (el) wireLocalCohostVideo(cohostBag.current, el)
    }
  }

  const toggleMic = async () => {
    if (!broadcastRoom.current) return
    const next = !micOn
    await broadcastRoom.current.localParticipant.setMicrophoneEnabled(next, next ? { deviceId: micId || undefined } : undefined).catch(() => {})
    setMicOn(next)
  }

  const copyUrl = (url: string) => {
    if (!url) return
    navigator.clipboard?.writeText(url).catch(() => {})
  }

  if (!isGuest && !app.signedIn) return <Login reason="go live" />

  if (loading) {
    return (
      <section style={panelStyle}>
        <Spinner size={24} />
      </section>
    )
  }

  if (error) {
    return (
      <section style={panelStyle}>
        <p>{error}</p>
      </section>
    )
  }

  return (
    <section style={panelStyle}>
      <h1>{parcelLabel}</h1>
      {isGuest && <p>you're joining as guest</p>}

      {syntheticGuest && !live && (
        <div class="f">
          <label>name</label>
          <input type="text" value={guestName} onInput={(e) => setGuestName((e.target as HTMLInputElement).value)} />
        </div>
      )}

      {live && (
        <p>
          * live {viewers} viewers {formatTimer(elapsed)}
        </p>
      )}

      <div ref={previewWrap} style={{ position: 'relative', width: '100%', background: '#0d0d0d', minHeight: '180px' }}>
        {!(isCohost && live) && <video ref={previewVideo} playsInline muted autoplay style={{ width: '100%', display: 'block' }} />}
      </div>

      {!live && (
        <>
          <div class="f">
            <label>mic</label>
            <select value={micId} onChange={(e) => setMicId((e.target as HTMLSelectElement).value)}>
              <option value="">default</option>
              {mics.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'mic'}
                </option>
              ))}
            </select>
          </div>
          <div class="f">
            <label>camera</label>
            <select value={camId} onChange={(e) => setCamId((e.target as HTMLSelectElement).value)}>
              <option value="">default</option>
              {cameras.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'camera'}
                </option>
              ))}
            </select>
          </div>
          {mobile && (
            <p>
              <button type="button" onClick={flipCamera}>
                flip camera
              </button>
            </p>
          )}
          {status && <p>{status}</p>}
        </>
      )}

      {live && (
        <>
          <p>chat</p>
          <div style={{ maxHeight: '120px', overflowY: 'auto', padding: '0.5rem 0' }}>
            {chatMessages.value.map((m, i) => (
              <div key={i}>{m.text}</div>
            ))}
          </div>
          <div class="f">
            <input type="text" value={chatDraft} placeholder="reply..." onInput={(e) => setChatDraft((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && (sendChat(chatDraft), setChatDraft(''))} />
            <button type="button" onClick={() => (sendChat(chatDraft), setChatDraft(''))}>
              send
            </button>
          </div>

          {!isGuest && (
            <>
              <div class="f">
                <label>fan link</label>
                <input type="text" readonly value={fanUrl} />
                <button type="button" onClick={() => copyUrl(fanUrl)}>
                  copy
                </button>
              </div>
              <div class="f">
                <label>guest link</label>
                <input type="text" readonly value={guestUrl || 'no guest link yet'} />
                <button type="button" onClick={() => copyUrl(guestUrl)} disabled={!guestUrl}>
                  copy
                </button>
              </div>
            </>
          )}

          {mobile && micOn && (
            <p>
              <button type="button" onClick={toggleMic}>
                mute mic
              </button>
            </p>
          )}
          {mobile && (
            <p>
              <button type="button" onClick={flipCamera}>
                flip camera
              </button>
            </p>
          )}
        </>
      )}

      <p>
        <button type="button" onClick={goLive}>
          {live ? 'stop streaming' : 'go live'}
        </button>
      </p>
      {!live && !status && <p>tap go live when ready</p>}
    </section>
  )
}
