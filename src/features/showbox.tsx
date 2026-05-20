import { Component, h } from 'preact'
import { decodeJwt } from 'jose'
import { isMobile } from '../../common/helpers/detector'
import { exitPointerLock } from '../../common/helpers/ui-helpers'
import { encodeCoords } from '../../common/helpers/utils'
import { ShowboxRecord } from '../../common/messages/feature'
import { effect } from '@preact/signals'
import { Room, RoomEvent, Track, createLocalScreenTracks, createLocalTracks } from 'livekit-client'
import { avatarName } from '../../common/messages/avatar-ref'
import { app } from '../../web/src/state'
import { messageList, type ChatMessageRecord } from '../connector'
import { Position, Rotation, Scale, Script } from '../../web/src/components/editor'
import { Animations } from '../avatar-animations'
import { EmoteAnimation, Idle } from '../states'
import { cameraPosition, cameraRotation } from '../utils/camera'
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
const LIVEKIT_URL = 'https://voxels-7pvk06qt.livekit.cloud'
const mobile = isMobile()

// True when the page was opened via /live/:token and the guest pass targets this showbox.
// The synthetic wallet `guest:*` and `?show=<uuid>` are both set by the server on redeem.
function isGuestForShowbox(uuid: string): boolean {
  const w = app.state.wallet
  if (!w || !w.startsWith('guest:')) return false
  try {
    return new URL(window.location.href).searchParams.get('show') === uuid
  } catch {
    return false
  }
}

function guestPassToken(): string | null {
  try {
    const key = app.state.key
    if (!key) return null
    const payload = decodeJwt(key) as { guest_pass?: string }
    return payload.guest_pass ?? null
  } catch {
    return null
  }
}

// Plain /play?coords= link for the audience. No isolate, ui=off, or show= - just drop people at the showbox.
function audienceShowUrl(feature: Showbox): string {
  const pos = feature.absolutePosition ?? new BABYLON.Vector3((feature.parcel.x1 + feature.parcel.x2) / 2, feature.parcel.y1, (feature.parcel.z1 + feature.parcel.z2) / 2)
  const coords = encodeCoords({ position: pos, rotation: new BABYLON.Vector3(0, 0, 0) })
  return `${window.location.origin}/play?coords=${encodeURIComponent(coords)}`
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

export default class Showbox extends Feature2D<ShowboxRecord> {
  static metadata: FeatureMetadata = {
    title: 'Showbox',
    subtitle: 'go live in the metaverse',
    type: 'showbox',
    image: '',
  }
  static template: FeatureTemplate = {
    type: 'showbox',
    scale: [2, 1, 0],
  }

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
  hasActiveVideo = false

  roomName() {
    return `parcel-${this.parcel.id}`
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
    return 1.2
  }

  get audio() {
    return window._audio
  }

  shouldBeInteractive(): boolean {
    return true
  }

  whatIsThis() {
    return <label>Live stream video and audio to anyone in the parcel.</label>
  }

  generate() {
    this.mesh = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    this.mesh.id = this.mesh.name + '/' + this.uuid
    this.setCommon()
    this.setPreview()
    if (this.isInCurrentParcel) {
      this.onEnter()
    }
    return Promise.resolve()
  }

  onEnter = () => {
    if (!this.livekitRoom) {
      this.connectViewer()
    }
    // Guest pass redirects with ?show=<uuid> - auto-open the broadcast dock so they don't have to find/click the panel.
    if (isGuestForShowbox(this.uuid) && !this.broadcastPanel) {
      setTimeout(() => this.openBroadcastPanel(), 250)
    }
  }

  onExit = () => {
    if (this.livekitRoom) {
      this.livekitRoom.disconnect()
      this.livekitRoom = null
      this.hasActiveVideo = false
      this.audio?.removeUserAudioReference(this)
    }
  }

  dispose() {
    this._dispose()
    this.livekitRoom?.disconnect()
    this.livekitRoom = null
    this.stopBroadcast(true)
    this.broadcastPanel?.remove()
    this.broadcastPanel = null
    this.audio?.removeUserAudioReference(this)
  }

  setPreview() {
    if (this.disposed) return
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

    const hasRemoteBroadcaster = [...((this.livekitRoom as any)?.remoteParticipants?.values() ?? [])].some((p: any) => p?.videoTrackPublications?.size > 0 || p?.audioTrackPublications?.size > 0)

    if (hasRemoteBroadcaster) {
      ctx.fillStyle = '#888'
      ctx.fillText('connecting to stream...', w / 2, h / 2)
    } else if (this.parcel.canEdit || isGuestForShowbox(this.uuid)) {
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
    } else if (mobile && this.livekitRoom) {
      ctx.fillStyle = '#888'
      ctx.fillText('tap screen to listen', w / 2, h / 2)
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

  async connectViewer() {
    if (this.livekitRoom) return
    const res = await fetch(`/api/rooms/${this.roomName()}/token`)
      .then((r) => r.json())
      .catch(() => null)
    if (!res?.token || this.disposed) return

    const room = new Room()
    this.livekitRoom = room

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLAudioElement
        el.volume = this.volume
        el.style.display = 'none'
        document.body.appendChild(el)
        this.audio?.addUserAudioReference(this)
        this.startBroadcastAudio()
        return
      }
      if (track.kind === Track.Kind.Video) {
        this.attachVideoToMesh(track.attach() as HTMLVideoElement)
        this.startBroadcastAudio()
      }
    })

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        this.audio?.removeUserAudioReference(this)
      }
      if (track.kind === Track.Kind.Video) {
        this.hasActiveVideo = false
      }
      this.setPreview()
    })

    room.on(RoomEvent.AudioPlaybackStatusChanged, (playing) => {
      if (playing) {
        this.audio?.addUserAudioReference(this)
      } else {
        this.armGestureUnblock()
      }
    })

    room.on(RoomEvent.ParticipantConnected, () => this.setPreview())
    room.on(RoomEvent.ParticipantDisconnected, () => this.setPreview())

    await room.connect(LIVEKIT_URL, res.token).catch(() => null)
    this.setPreview()
  }

  startBroadcastAudio() {
    if (!this.livekitRoom) return
    this.livekitRoom.startAudio().catch(() => {})
    this.audio?.addUserAudioReference(this)
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

  attachVideoToMesh(el: HTMLVideoElement, muted = false) {
    if (!this.mesh) return
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

  startThumbCapture(videoEl: HTMLVideoElement) {
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
        ctx.drawImage(videoEl, 0, 0, 256, 144)
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

  stopBroadcast(silent = false) {
    this.stopThumbCapture(silent)
    this.broadcastRoom?.disconnect()
    this.broadcastRoom = null
    this.hasActiveVideo = false
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
  }

  openBroadcastPanel() {
    if (this.broadcastPanel) {
      this.broadcastPanel.remove()
      this.broadcastPanel = null
      this.stopBroadcast()
      return
    }

    exitPointerLock()

    const showUrl = audienceShowUrl(this)

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

    const screenOpt = document.createElement('label')
    const screenChk = document.createElement('input')
    screenChk.type = 'checkbox'
    screenOpt.append(screenChk, ' use screenshare instead of camera')
    if (mobile) screenOpt.style.display = 'none' // screenshare from a phone is unreliable; stick to the camera

    const deviceRow = document.createElement('div')
    Object.assign(deviceRow.style, { display: 'flex', flexDirection: 'column', gap: '4px' })
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

    // Identity row. Owners use their voxels profile. Guests pick their own name here before going live.
    const isGuest = isGuestForShowbox(this.uuid)
    const guestToken = isGuest ? guestPassToken() : null
    let guestNameInput: HTMLInputElement | null = null

    const identityRow = document.createElement('div')
    Object.assign(identityRow.style, { display: 'flex', flexDirection: 'column', gap: '4px' })
    const identityLabel = document.createElement('label')
    identityLabel.textContent = isGuest ? 'Name' : 'streaming as'
    if (isGuest && guestToken) {
      const nameInput = document.createElement('input')
      guestNameInput = nameInput
      nameInput.type = 'text'
      nameInput.value = app.state.name ?? ''
      nameInput.placeholder = 'e.g. DJ ANON'
      nameInput.maxLength = 64
      Object.assign(nameInput.style, { width: '100%', background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: '8px', fontFamily: 'inherit', minHeight: '36px', boxSizing: 'border-box' })
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
        } catch {
          nameStatus.textContent = 'could not save'
        }
      }
      nameInput.oninput = () => {
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => save(false), 600)
      }
      nameInput.onblur = () => save(true)
      identityRow.append(identityLabel, nameInput, nameStatus)
    } else {
      const nameDisplay = document.createElement('div')
      nameDisplay.textContent = app.state.name ?? '(set your name in your voxels profile)'
      Object.assign(nameDisplay.style, { background: '#1a1a1a', border: '1px solid #333', padding: '8px', color: '#f5f5f0', minHeight: '36px', boxSizing: 'border-box', display: 'flex', alignItems: 'center' })
      identityRow.append(identityLabel, nameDisplay)
    }

    // share row - shown only once the broadcaster is actually live. Before going live it's noise;
    // after going live they want to drop the link on x / instagram to pull people in.
    const shareRow = document.createElement('div')
    Object.assign(shareRow.style, { display: 'none', flexDirection: 'column', gap: '4px', borderTop: '1px solid #222', borderBottom: '1px solid #222', padding: '8px 0' })
    const shareLabel = document.createElement('label')
    shareLabel.textContent = 'show link - share with your fans'
    shareLabel.style.color = '#888'
    const shareInput = document.createElement('input')
    shareInput.type = 'text'
    shareInput.readOnly = true
    shareInput.value = showUrl
    Object.assign(shareInput.style, { width: '100%', background: '#1a1a1a', color: '#f5f5f0', border: '1px solid #333', padding: '8px', fontFamily: 'inherit', minHeight: '36px' })
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
      const text = `going live in voxels - ${showUrl}`
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    }
    shareBtnRow.append(copyBtn, xBtn)
    shareRow.append(shareLabel, shareInput, shareBtnRow)
    if (mobile) {
      shareLabel.textContent = 'fan link'
      shareInput.style.display = 'none'
      copyBtn.textContent = 'copy link for fans'
      Object.assign(copyBtn.style, { background: '#dc1e1e', fontWeight: 'bold', flex: '2' })
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
    goBtn.textContent = 'go live'
    Object.assign(goBtn.style, { background: '#dc1e1e', color: '#f5f5f0', border: '0', padding: '12px 16px', cursor: 'pointer', fontFamily: 'inherit', flex: '2', minHeight: '44px', fontWeight: 'bold' })

    const closeBtn = document.createElement('button')
    closeBtn.textContent = 'close'
    Object.assign(closeBtn.style, { background: '#333', color: '#f5f5f0', border: '0', padding: '12px 16px', cursor: 'pointer', fontFamily: 'inherit', flex: '1', minHeight: '44px' })
    closeBtn.onclick = () => {
      panel.remove()
      this.broadcastPanel = null
      this.stopBroadcast()
    }

    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.gap = '0.5rem'
    row.append(goBtn, closeBtn)

    // Mobile chat lives in the dock when live - bottom sheet covers world chat. Desktop uses normal chat.
    let chatSection: HTMLDivElement | null = null
    let chatRow: HTMLDivElement | null = null
    let chatReplyRow: HTMLDivElement | null = null
    let dockFooter: HTMLDivElement | null = null
    if (mobile) {
      const chatLabel = document.createElement('label')
      chatLabel.textContent = 'chat'
      chatSection = document.createElement('div')
      Object.assign(chatSection.style, {
        flex: '1 1 auto',
        minHeight: '64px',
        maxHeight: 'none',
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

      const renderDockChat = () => {
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
        chatSection!.scrollTop = chatSection!.scrollHeight
      }

      this.broadcastChatDispose = effect(() => {
        messageList.value
        renderDockChat()
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
        flex: '1 1 auto',
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
      dockFooter.append(shareRow, row)

      panel.append(title, identityRow, deviceRow, screenOpt, deviceToggle, chatRow, dockFooter, mobileExtrasBtn!, moveRow, status)
    } else {
      panel.append(title, identityRow, deviceRow, screenOpt, deviceToggle, shareRow, moveRow, status, row)
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
    camSel.onchange = async () => {
      if (this.broadcastRoom && liveVideoTrack && camSel.value) {
        await liveVideoTrack.setDeviceId(camSel.value).catch(() => {})
      }
    }
    micSel.onchange = async () => {
      if (this.broadcastRoom && liveAudioTrack && micSel.value) {
        await liveAudioTrack.setDeviceId(micSel.value).catch(() => {})
        wireAudioMeter(liveAudioTrack.mediaStreamTrack)
      }
    }

    goBtn.onclick = async () => {
      if (this.broadcastRoom) {
        this.stopBroadcast()
        liveVideoTrack = null
        liveAudioTrack = null
        meterFillEl = null
        goBtn.textContent = 'go live'
        goBtn.style.background = '#dc1e1e'
        this.setPreview()
        panel.querySelectorAll('[data-dot]').forEach((el) => el.remove())
        if (this.liveTimerInterval) {
          clearInterval(this.liveTimerInterval)
          this.liveTimerInterval = null
        }
        this.liveStartedAt = null
        ;[title, identityRow, deviceRow, screenOpt, status].forEach((el) => ((el as HTMLElement).style.display = ''))
        deviceToggle.style.display = 'none'
        deviceRow.style.display = 'flex'
        deviceToggle.textContent = 'change camera or mic'
        shareRow.style.display = 'none'
        moveRow.style.display = 'none'
        if (chatRow) chatRow.style.display = 'none'
        if (chatReplyRow) chatReplyRow.style.display = 'none'
        setMobileDockLayout(false)
        setDesktopDockLayout(false)
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
          } catch {
            status.textContent = 'could not save name'
            return
          }
        } else if (guestToken) {
          syncGuestDisplayName(nextName)
        }
      }

      status.textContent = 'connecting...'
      goBtn.disabled = true

      try {
        const id = this.parcel.id
        const res = await fetch(`/api/rooms/${this.roomName()}/token`).then((r) => r.json())
        if (!res?.token) throw new Error('no token')

        const room = new Room()
        this.broadcastRoom = room
        await room.connect(LIVEKIT_URL, res.token)

        let tracks: any[]
        if (screenChk.checked) {
          tracks = await createLocalScreenTracks({ audio: true })
        } else {
          tracks = await createLocalTracks({
            video: { deviceId: camSel.value || undefined },
            audio: { deviceId: micSel.value || undefined },
          })
        }

        for (const t of tracks) {
          await room.localParticipant.publishTrack(t)
        }

        if (!tracks.some((t) => t.kind === Track.Kind.Audio)) {
          status.textContent = 'live but no mic - check browser permissions'
        }

        const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video)
        liveVideoTrack = videoTrack ?? null
        liveAudioTrack = tracks.find((t) => t.kind === Track.Kind.Audio) ?? null
        if (videoTrack) {
          const el = videoTrack.attach() as HTMLVideoElement
          this.attachVideoToMesh(el, true)
          this.startThumbCapture(el)
        }

        this.audio?.addUserAudioReference(this)

        goBtn.textContent = 'stop streaming'
        goBtn.style.background = '#444'
        goBtn.disabled = false
        status.textContent = ''
        ;[title, identityRow, screenOpt, status].forEach((el) => ((el as HTMLElement).style.display = 'none'))
        deviceRow.style.display = 'none'
        deviceToggle.style.display = 'block'
        deviceToggle.textContent = 'change camera or mic'
        if (mobile) {
          mobileExtrasOpen = false
          shareRow.style.display = 'flex'
          moveRow.style.display = 'none'
          if (mobileExtrasBtn) mobileExtrasBtn.style.display = 'block'
        } else {
          shareRow.style.display = 'flex'
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
            const previewVideo = videoTrack.attach() as HTMLVideoElement
            previewVideo.muted = true
            previewVideo.volume = 0
            previewVideo.playsInline = true
            Object.assign(previewVideo.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' })
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
            const previewVideo = videoTrack.attach() as HTMLVideoElement
            previewVideo.muted = true
            previewVideo.volume = 0
            previewVideo.playsInline = true
            Object.assign(previewVideo.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block' })
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

          const audioMst = (liveAudioTrack as any)?.mediaStreamTrack as MediaStreamTrack | undefined
          if (audioMst) wireAudioMeter(audioMst)
          else meterTrack.remove()
        }

        setMobileDockLayout(true)
        setDesktopDockLayout(true)
      } catch {
        status.textContent = 'failed to connect'
        goBtn.disabled = false
        this.broadcastRoom = null
      }
    }
  }

  onClick() {
    if (!this.broadcastRoom) {
      const hasRemoteBroadcaster = [...((this.livekitRoom as any)?.remoteParticipants?.values() ?? [])].some((p: any) => p?.videoTrackPublications?.size > 0 || p?.audioTrackPublications?.size > 0)
      if ((this.parcel.canEdit || isGuestForShowbox(this.uuid)) && !hasRemoteBroadcaster) {
        this.openBroadcastPanel()
      } else {
        this.startBroadcastAudio()
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
    }
  }

  componentDidUpdate() {
    this.merge({
      rolloffFactor: this.state.rolloffFactor,
      volume: this.state.volume,
    })
  }

  render() {
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
          <GuestPasses feature={this.props.feature} />
          <Advanced>
            <FeatureID feature={this.props.feature} />
            <SetParentDropdown feature={this.props.feature} />
            <div className="f">
              <label>Spatial Rolloff Factor</label>
              <input type="range" step="0.1" min="0" max="5" value={this.state.rolloffFactor} onChange={(e) => this.setState({ rolloffFactor: parseFloat(e.currentTarget.value) })} />
              <small>How quickly sound fades as players move away</small>
            </div>
            <div className="f">
              <label>Volume</label>
              <input type="range" step="0.01" min="0" max={MAX_VOLUME} value={this.state.volume} onChange={(e) => this.setState({ volume: parseFloat(e.currentTarget.value) })} />
            </div>
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

class GuestPasses extends Component<{ feature: Showbox }, { passes: Pass[]; loading: boolean; creating: boolean; error: string | null }> {
  state = { passes: [] as Pass[], loading: true, creating: false, error: null as string | null }

  componentDidMount() {
    this.refresh()
  }

  parcelId() {
    return this.props.feature.parcel.id
  }

  featureUuid() {
    return this.props.feature.uuid
  }

  async refresh() {
    try {
      const r = await fetch(`/api/parcels/${this.parcelId()}/guest-passes`, { credentials: 'include' })
      const j = await r.json()
      const all: Pass[] = j.passes ?? []
      this.setState({ passes: all.filter((p) => p.feature_uuid === this.featureUuid()), loading: false })
    } catch {
      this.setState({ loading: false })
    }
  }

  async create() {
    this.setState({ creating: true, error: null })
    try {
      const r = await fetch(`/api/parcels/${this.parcelId()}/guest-passes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ feature_uuid: this.featureUuid() }),
      })
      const j = await r.json()
      if (!j.success) throw new Error(j.error || 'Could not create link')
      await this.refresh()
    } catch (e: any) {
      this.setState({ error: e?.message ?? 'Could not create link' })
    } finally {
      this.setState({ creating: false })
    }
  }

  async revoke(token: string) {
    if (!confirm('Revoke this link? They will be kicked if currently live.')) return
    await fetch(`/api/parcels/${this.parcelId()}/guest-passes/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {})
    await this.refresh()
  }

  copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  liveUrl(token: string) {
    return `${window.location.origin}/live/${token}`
  }

  showUrl() {
    return audienceShowUrl(this.props.feature)
  }

  render() {
    if (!this.props.feature.parcel.canEdit) return null
    const active = this.state.passes.filter((p) => !p.revoked_at)
    const revoked = this.state.passes.filter((p) => p.revoked_at)

    return (
      <div className="f">
        <label>Guest broadcast links</label>
        <small>One-tap broadcast link for someone without a voxels account - artists, speakers, anyone you invite. They pick their own name when they open the link. No voxels account needed.</small>

        <div className="f">
          <label>show link - share with your fans</label>
          <input type="text" readOnly value={this.showUrl()} onClick={(e) => (e.currentTarget as HTMLInputElement).select()} />
          <small>Normal voxels url. Post on x or instagram so fans can find the show.</small>
        </div>

        <div className="f">
          <button onClick={() => this.create()} disabled={this.state.creating}>
            {this.state.creating ? 'creating...' : 'create link'}
          </button>
          {this.state.error && <div style={{ color: '#dc1e1e' }}>{this.state.error}</div>}
        </div>

        {this.state.loading && <small>loading...</small>}

        {active.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {active.map((p) => (
                <tr key={p.token}>
                  <td>
                    <strong>{p.name?.trim() || 'name not chosen yet'}</strong>
                    <br />
                    <small>broadcast link (guest only)</small>
                    <input type="text" readOnly value={this.liveUrl(p.token)} onClick={(e) => (e.currentTarget as HTMLInputElement).select()} style={{ width: '100%' }} />
                  </td>
                  <td style={{ verticalAlign: 'top' }}>
                    <button onClick={() => this.copy(this.liveUrl(p.token))}>copy</button>
                    <button onClick={() => this.revoke(p.token)}>revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {revoked.length > 0 && (
          <details>
            <summary>{revoked.length} revoked</summary>
            <ul>
              {revoked.map((p) => (
                <li key={p.token}>
                  <small>
                    {p.name} - revoked {new Date(p.revoked_at!).toLocaleDateString()}
                  </small>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    )
  }
}
