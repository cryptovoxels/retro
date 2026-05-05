import { h } from 'preact'
import { isBatterySaver, isMobile } from '../../common/helpers/detector'
import { exitPointerLock } from '../../common/helpers/ui-helpers'
import { YoutubeRecord } from '../../common/messages/feature'
import { CSS3DObject, CSS3DRenderer } from '../../vendor/CSS3DRenderer'
import { Position, Rotation, Scale, Script } from '../../web/src/components/editor'
import type { Scene } from '../scene'
import { fetchNoImageTexture, fetchTexture } from '../textures/textures'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, SetParentDropdown, Toolbar, UuidReadOnly } from '../ui/features'
import { isURL } from '../utils/helpers'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D } from './feature'

const DEFAULT_VOLUME = 0.7
const MAX_VOLUME = 1
const AUTOPLAY_FADE_TIME = 6
const VOLUME_REFRESH_INTERVAL = 200 // ms
const { setInterval } = window

const mobile = isMobile()

// Whitelist of commands the Youtube iframe API will honor. Twitch is handled out-of-world
// via the PiP overlay, so only Youtube commands live here.
const YOUTUBE_COMMANDS = new Set(['setVolume', 'setMuted', 'playVideo', 'pauseVideo'] as const)
type YoutubeCommand = Parameters<typeof YOUTUBE_COMMANDS.has>[0]

const stopSignal = new EventTarget()

// Twitch embeds refuse to play inside any CSS3D-transformed container (see twitchdev/issues#1127).
// We render Twitch as a fixed-position picture-in-picture overlay instead, which has no transform
// ancestors and therefore plays normally on desktop and mobile. One PiP at a time.
let twitchPip: { root: HTMLDivElement; channel: string; onClose?: () => void } | null = null

function openTwitchPip(channel: string, onClose?: () => void) {
  if (twitchPip?.channel === channel) return
  closeTwitchPip()

  // Release pointer lock so the user can actually click the Twitch play button.
  exitPointerLock()

  const font = '13px "Source Code Pro", monospace'

  const root = document.createElement('div')
  root.id = 'twitch-pip'
  const base: Partial<CSSStyleDeclaration> = {
    position: 'fixed',
    zIndex: '999999',
    background: '#181511',
    color: '#f5f5f0',
    border: '1px solid #090807',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    font,
  }
  const dw = 480
  const dh = 300
  const applyMobileLayout = () => {
    // Portrait: full-width top sheet. Landscape: small top-right window so the D-pad
    // (bottom-left on most mobile control layouts) stays usable with both thumbs.
    const landscape = window.innerWidth > window.innerHeight
    const layout: Partial<CSSStyleDeclaration> = landscape
      ? { left: 'auto', right: '12px', top: '12px', bottom: 'auto', width: '320px', height: '200px', borderRadius: '1rem' }
      : { left: '0', right: '0', top: '0', bottom: 'auto', width: '100%', height: '40vh', borderRadius: '0' }
    Object.assign(root.style, layout)
  }
  const placement: Partial<CSSStyleDeclaration> = mobile
    ? {}
    : {
        left: Math.max(0, Math.round((window.innerWidth - dw) / 2)) + 'px',
        top: '16px',
        width: dw + 'px',
        height: dh + 'px',
        borderRadius: '1rem',
        resize: 'both',
        minWidth: '280px',
        minHeight: '180px',
      }
  Object.assign(root.style, base, placement)
  if (mobile) {
    applyMobileLayout()
    // Re-apply on orientation flip; self-cleans when the PiP is removed from DOM.
    const onResize = () => {
      if (!root.isConnected) {
        window.removeEventListener('resize', onResize)
        return
      }
      applyMobileLayout()
    }
    window.addEventListener('resize', onResize)
  }

  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    borderBottom: '1px solid #090807',
    flex: '0 0 auto',
    cursor: mobile ? 'default' : 'move',
    userSelect: 'none',
    touchAction: 'none',
  })
  const label = document.createElement('span')
  label.textContent = 'twitch / ' + channel
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '\u2715'
  closeBtn.setAttribute('aria-label', 'Close Twitch player')
  Object.assign(closeBtn.style, {
    background: 'transparent',
    border: '0',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: '1',
  })
  closeBtn.onclick = closeTwitchPip
  header.append(label, closeBtn)

  // Drag from header. Disabled on mobile where the bottom-sheet layout pins it.
  if (!mobile) {
    header.onpointerdown = (e) => {
      if (e.target === closeBtn) return
      const rect = root.getBoundingClientRect()
      const dx = e.clientX - rect.left
      const dy = e.clientY - rect.top
      header.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent) => {
        const maxX = window.innerWidth - rect.width
        const maxY = window.innerHeight - rect.height
        root.style.left = Math.max(0, Math.min(maxX, ev.clientX - dx)) + 'px'
        root.style.top = Math.max(0, Math.min(maxY, ev.clientY - dy)) + 'px'
      }
      const up = () => {
        header.removeEventListener('pointermove', move)
        header.removeEventListener('pointerup', up)
      }
      header.addEventListener('pointermove', move)
      header.addEventListener('pointerup', up)
    }
  }

  const iframe = document.createElement('iframe')
  // Open paused; the user taps Twitch's own play button inside the iframe to start.
  // That click is a real gesture inside the player's origin, so it plays unmuted
  // without running into browser autoplay policy or Twitch's visibility gate.
  iframe.src = 'https://player.twitch.tv/?channel=' + encodeURIComponent(channel) + '&parent=' + location.hostname + '&autoplay=false'
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation')
  iframe.allow = 'autoplay; fullscreen'
  iframe.referrerPolicy = 'strict-origin-when-cross-origin'
  Object.assign(iframe.style, { width: '100%', flex: '1 1 auto', border: '0', background: '#000' })

  root.append(header, iframe)
  document.body.appendChild(root)
  twitchPip = { root, channel, onClose }
}

function closeTwitchPip() {
  const prev = twitchPip
  twitchPip = null
  prev?.root.remove()
  prev?.onClose?.()
}

export function buildYoutubeThumbnailUrl(videoId: string | undefined): string | null {
  if (!videoId) {
    return null
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

export async function loadYoutubeThumbnail(scene: Scene, videoId: string | undefined, signal: AbortSignal): Promise<BABYLON.Texture> {
  const thumbnailUrl = buildYoutubeThumbnailUrl(videoId)
  if (!thumbnailUrl) {
    return fetchNoImageTexture(scene)
  }

  return new Promise((resolve) => {
    const texture = new BABYLON.Texture(
      thumbnailUrl,
      scene,
      false,
      true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      () => resolve(texture),
      async () => resolve(await fetchNoImageTexture(scene)),
    )

    signal.addEventListener('abort', () => texture.dispose(), { once: true })
  })
}

export default class Youtube extends Feature2D<YoutubeRecord> {
  static metadata: FeatureMetadata = {
    title: 'Youtube / Twitch',
    subtitle: 'Embed videos and livestreams',
    type: 'youtube',
    image: '/icons/youtube.png',
  }
  static template: FeatureTemplate = {
    type: 'youtube',
    scale: [2, 1, 0],
    url: '',
  }
  playing = false
  paused = false
  player: YoutubePlayer | null = null
  autoStopTimeout: NodeJS.Timeout | null = null
  hasBeenGeneratedAtLeastOnce = false // First generate has been called? Feature has loaded but it having a mesh is not guaranteed

  get autoplay() {
    return !!this.description.autoplay
  }

  get volume() {
    if (typeof this.description.volume === 'number') {
      return Math.max(0, Math.min(this.description.volume, MAX_VOLUME))
    } else {
      return DEFAULT_VOLUME
    }
  }

  get rolloffFactor() {
    if (typeof this.description.rolloffFactor === 'number') {
      return this.description.rolloffFactor
    } else {
      return this.autoplay ? 1 : 1.2
    }
  }

  get hasAudio() {
    return this.volume > 0
  }

  get loop() {
    return !!this.description.loop
  }

  // https://www.youtube.com/watch?v=wIft-t-MQuE&
  get videoId() {
    if (!this.url) {
      return undefined
    }
    try {
      if (this.isYoutube) {
        if (this.url.match('youtu.be')) {
          // handle shortened youtube links
          return (this.url.match(/youtu\.be\/([^?]+)/) || [])[1]
        } else {
          return (this.url.match(/\?v=([^&]+)/) || [])[1]
        }
      } else if (this.isTwitch) {
        return (this.url.match(/(com|tv)\/(\w+)/) || [])[2]
      }
    } catch (e) {
      return undefined
    }
  }

  get isYoutube() {
    return !!this.url?.match('youtube.com|youtu.be')
  }

  get isTwitch() {
    return !!this.url?.match('twitch')
  }

  get previewUrl(): string | null {
    if (this.description.previewUrl && typeof this.description.previewUrl === 'string') {
      return this.description.previewUrl
    } else if (this.isYoutube) {
      return `https://i.ytimg.com/vi/${this.videoId}/hqdefault.jpg`
    } else if (this.isTwitch) {
      // Twitch's own live preview image (falls back to offline banner if the channel isn't live).
      return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${this.videoId}-640x360.jpg`
    } else {
      return null
    }
  }

  // fixme
  get audio() {
    return window._audio
  }

  toString() {
    return this.url || super.toString()
  }

  shouldBeInteractive(): boolean {
    return !!this.url && isURL(this.url)
  }

  whatIsThis() {
    return <label>Display a youtube or twitch video in-world. </label>
  }

  generate() {
    this.mesh = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    this.mesh.id = this.mesh.name + '/' + this.uuid
    this.setCommon()
    this.setPreview()

    this.playing = false
    this.paused = false
    this.addEvents()

    if (this.deprecatedSince('5.31.0')) {
      this.description.autoplay = false
    }

    /// onEnter is called onFeature creation now (if the user is inside the parcel), therefore
    /// this.hasBeenGeneratedAtLeastOnce catches the case where the feature is being edited for example;
    /// (so enabling autoplay in featureEditor should start playing the video)
    if (!this.playing && this.hasBeenGeneratedAtLeastOnce && this.isInCurrentParcel) {
      this.onEnter()
    }

    this.hasBeenGeneratedAtLeastOnce = true

    return Promise.resolve()
  }

  onEnter = () => {
    // tablets and mobile devices don't autoplay,
    if (!this.autoplay || this.scene.config.isOrbit || isMobile()) {
      return
    }
    // disable autoplay in battery saver mode
    if (isBatterySaver()) {
      console.log('Battery saver mode, skipping video autoplay')
      return
    }
    this.autoStopTimeout && clearTimeout(this.autoStopTimeout)

    if (this.playing) {
      this.hasAudio && this.audio?.addUserAudioReference(this)

      // fade it back in!
      this.fadeIn(AUTOPLAY_FADE_TIME)
    } else if (this.autoplay && !this.scene.config.isOrbit) {
      this.play()
    }
  }

  onExit = () => {
    this.autoStopTimeout && clearTimeout(this.autoStopTimeout)

    const fadeoutTime = this.rolloffFactor > 0 ? AUTOPLAY_FADE_TIME : 2

    // start fading out sound when leaving parcel, only remove once zero, fade back in on reentry (if not too late)
    this.fadeOut(fadeoutTime)

    this.audio?.removeUserAudioReference(this)

    // give them 10 seconds to come back before restarting audio
    this.autoStopTimeout = setTimeout(
      () => {
        this.stop()
      },
      (fadeoutTime + 2) * 1000,
    )
  }

  afterSetCommon = () => {
    if (this.player) {
      this.player.refreshPosition()
      this.player.volume = this.volume
    }
  }

  fadeIn(time: number, fromZero = false) {
    if (this.player) {
      this.player.fadeIn(time, fromZero)
    }
  }

  fadeOut(time: number) {
    if (this.player) {
      this.player.fadeOut(time)
    }
  }

  async setPreview() {
    if (this.disposed) return

    if (this.isTwitch) {
      // Twitch gets a composited preview with a "click to play" or "LIVE" badge so
      // users can tell whether the PiP is currently streaming.
      await this.setTwitchPreview()
      return
    }

    let texture: BABYLON.Texture
    if (this.description.previewUrl) {
      texture = await fetchTexture(this.scene, this.previewUrl, this.abortController.signal, { transparent: false, stretch: true })
    } else {
      texture = await loadYoutubeThumbnail(this.scene, this.videoId, this.abortController.signal)
    }
    texture.hasAlpha = false

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = texture
    material.backFaceCulling = false
    material.zOffset = -4
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 1, 1)
    material.blockDirtyMechanism = true

    if (this.mesh) {
      this.mesh.material = material
    }
  }

  async setTwitchPreview() {
    if (this.disposed) return
    const url = this.previewUrl
    if (!url) return

    const w = 640
    const h = 360
    const tex = new BABYLON.DynamicTexture(this.uniqueEntityName('tpreview'), { width: w, height: h }, this.scene, false)
    const ctx = tex.getContext() as CanvasRenderingContext2D

    // Background: solid dark. If the Twitch CDN allows CORS (it does for previews),
    // draw the stream thumbnail over it. If CORS fails, the badges still render over
    // the dark background so users know what to do.
    ctx.fillStyle = '#1a1a1e'
    ctx.fillRect(0, 0, w, h)
    await new Promise<void>((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, w, h)
        } catch {}
        resolve()
      }
      img.onerror = () => resolve()
      img.src = url
    })

    // Terminal-style monochrome badges. No decorative color, monospace font.
    const labelFont = 'bold 20px "Source Code Pro", monospace'

    if (this.playing) {
      // Streaming indicator, top-left. Red only because style guide permits red for semantic state.
      const txt = '\u25CF STREAMING'
      ctx.font = labelFont
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(txt).width
      const padX = 12
      const padY = 8
      const bw = tw + padX * 2
      const bh = 20 + padY * 2
      ctx.fillStyle = 'rgba(9,8,7,0.85)'
      ctx.fillRect(14, 14, bw, bh)
      ctx.strokeStyle = '#090807'
      ctx.lineWidth = 1
      ctx.strokeRect(14.5, 14.5, bw, bh)
      ctx.fillStyle = '#e91916'
      ctx.fillText(txt, 14 + padX, 14 + bh / 2)
    }

    // Call-to-action badge, bottom-right
    const label = this.playing ? '\u25A0 STOP' : '\u25B6 PLAY'
    ctx.font = labelFont
    ctx.textBaseline = 'middle'
    const padX = 14
    const padY = 10
    const textW = ctx.measureText(label).width
    const bw = textW + padX * 2
    const bh = 20 + padY * 2
    const bx = w - bw - 14
    const by = h - bh - 14
    ctx.fillStyle = 'rgba(9,8,7,0.85)'
    ctx.fillRect(bx, by, bw, bh)
    ctx.strokeStyle = '#090807'
    ctx.lineWidth = 1
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh)
    ctx.fillStyle = '#f5f5f0'
    ctx.fillText(label, bx + padX, by + bh / 2)

    tex.update()
    tex.hasAlpha = false

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = tex
    material.backFaceCulling = false
    material.zOffset = -4
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 1, 1)
    material.blockDirtyMechanism = true

    if (this.mesh) {
      this.mesh.material = material
    }
  }

  onClick() {
    if (this.isTwitch) {
      // Twitch renders as an out-of-world PiP overlay; clicking the mesh toggles it.
      if (this.playing) this.stop()
      else this.play()
      this.parcelScript?.dispatch('click', this, {})
      return
    }
    if (this.playing) {
      if (this.paused) {
        this.unpause()
      } else {
        this.pause()
      }
    } else {
      this.play()
    }
    this.parcelScript?.dispatch('click', this, {})
  }

  pause() {
    if (this.player) {
      this.player.pause()
      this.paused = true
      this.audio?.removeUserAudioReference(this)
    }
  }

  unpause() {
    if (this.player) {
      this.player.unpause()
      this.paused = false
      this.hasAudio && this.audio?.addUserAudioReference(this)
    }
  }

  stop() {
    if (!this.playing) return

    this.playing = false

    if (this.isTwitch) {
      closeTwitchPip()
      this.setTwitchPreview()
      return
    }

    // allow soundtrack to play again
    this.audio?.removeUserAudioReference(this)

    if (this.player) {
      this.player.dispose()
      this.player = null
    }

    this.setPreview()
  }

  dispose() {
    this._dispose()
    if (this.isTwitch) closeTwitchPip()
    if (this.player) {
      this.player.dispose()
      this.player = null
    }
    this.audio?.removeUserAudioReference(this)
  }

  play() {
    if (this.disposed) return
    if (this.playing) return

    if (this.isTwitch) {
      // Twitch can't play inside our CSS3D-transformed iframe (visibility gate), so we
      // spawn a fixed-position PiP overlay outside the 3D pipeline. Re-render the mesh
      // preview with a "STREAMING" badge so players know the feature is active.
      // If the PiP is closed externally (X button, fullscreen exit, etc.), sync state
      // so the mesh preview drops the STREAMING badge.
      this.playing = true
      openTwitchPip(this.videoId, () => {
        if (this.playing) this.stop()
      })
      this.setTwitchPreview()
      return
    }

    if (!this.audio?.running) {
      // if the audio context isn't running yet, wait a second and try again
      setTimeout(() => this.play(), 1000)
      return
    }

    this.playing = true
    if (mobile) {
      // if mobile stop all other youtube videos, only one can play at a time
      stopSignal.dispatchEvent(new CustomEvent('stop'))
      stopSignal.addEventListener(
        'stop',
        () => {
          console.debug('Stopping playback due to new video playing')
          this.stop()
        },
        { once: true, signal: this.abortController.signal },
      )
    }

    let ratio = 16 / 9
    if (this.description.screenRatio === '43') {
      ratio = 4 / 3
    }

    this.player = new YoutubePlayer(this, this.scene, ratio)
    this.player.volume = this.volume
    this.player.rolloffFactor = this.rolloffFactor

    if (this.mesh) {
      this.mesh.material = YoutubePlayer.depthMask
    }

    // prevent soundtrack from playing
    this.hasAudio && this.audio?.addUserAudioReference(this)
  }
}

class Editor extends FeatureEditor<Youtube> {
  constructor(props: FeatureEditorProps<Youtube>) {
    super(props)

    if (!props.feature.description.screenRatio) {
      props.feature.description.screenRatio = '169'
    }

    this.state = {
      id: props.feature.description.id,
      url: props.feature.description.url,
      previewUrl: props.feature.description.previewUrl,
      screenRatio: props.feature.description.screenRatio,
      autoplay: !!props.feature.description.autoplay,
      loop: props.feature.description.loop,
      rolloffFactor: props.feature.rolloffFactor,
      volume: props.feature.volume, // use the prop for default values
    }
  }

  get player(): YoutubePlayer | null {
    return this.props.feature.player
  }

  componentDidUpdate() {
    this.merge({
      url: this.state.url,
      previewUrl: this.state.previewUrl,
      screenRatio: this.state.screenRatio,
      inverted: !!this.state.inverted,
      autoplay: this.state.autoplay,
      loop: this.state.loop,
      rolloffFactor: this.state.rolloffFactor,
      volume: this.state.volume,
    })
  }

  changeRatio(e: h.JSX.TargetedEvent<HTMLInputElement, Event>) {
    this.props.feature.description.screenRatio = e.currentTarget.value
    this.setState({ screenRatio: e.currentTarget.value })
  }

  streamingServiceName = () => {
    if (this.props.feature.isYoutube) {
      return 'Youtube'
    }
    if (this.props.feature.isTwitch) {
      return 'Twitch'
    }
    return 'Youtube or Twitch'
  }

  render() {
    return (
      <section>
        <header>
          <h2>{`Edit ${this.streamingServiceName()}`}</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={this.props.feature} scene={this.props.scene} />
          {/* keys are provided so that the getState in the component is reset after gizmo is used */}
          <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
          <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
          <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />

          <div className="f">
            <label>URL</label>
            <input type="text" value={this.state.url} onInput={(e) => this.setState({ url: e.currentTarget.value })} />

            <small>
              Supported URLs:
              <br /> * Youtube single video
              <br /> * Twitch channel
            </small>
          </div>

          <div className="f">
            <label>Preview Image URL (optional)</label>
            <input type="text" value={this.state.previewUrl} onInput={(e) => this.setState({ previewUrl: e.currentTarget.value })} />
            <small>This image will show before the user plays the video. If left empty, uses thumbnail provided by the service.</small>
          </div>
          <Advanced>
            <FeatureID feature={this.props.feature} />
            <SetParentDropdown feature={this.props.feature} />

            <div className="f">
              <label>Video size ratio</label>
              <input type="radio" checked={this.props.feature.description.screenRatio === '43'} onChange={this.changeRatio.bind(this)} name="ratio" value="43" /> 4:3&nbsp;&nbsp;&nbsp;
              <input type="radio" checked={this.props.feature.description.screenRatio === '169'} onChange={this.changeRatio.bind(this)} name="ratio" value="169" /> 16:9
            </div>

            <div className="f">
              <label>
                <input checked={this.state.autoplay} onInput={(e) => this.setState({ autoplay: e.currentTarget.checked })} type="checkbox" />
                Autoplay
              </label>
              <small>Play when someone enters the parcel</small>
            </div>

            <div className="f">
              <label>
                <input checked={this.state.loop} onInput={(e) => this.setState({ loop: e.currentTarget.checked })} type="checkbox" />
                Loop (repeat forever)
              </label>
              <small>Loop playback until the player leaves your parcel</small>
            </div>

            <div className="f">
              <label>Spatial Rolloff Factor</label>
              <input type="range" step="0.1" min="0" max="5" value={this.state.rolloffFactor} onChange={(e) => this.setState({ rolloffFactor: parseFloat(e.currentTarget.value) })} />
              <small>Choose how quickly the sound fades away as the player moves away from the emitter (higher values fade away faster)</small>
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

interface FadeState {
  from: number
  to: number
  startTime: number
  duration: number
}

Youtube.Editor = Editor

export interface IYoutubePlayer {
  refreshVolume: () => void
  refreshPosition: () => void
  refreshRotation: () => void
}

class YoutubePlayer {
  static depthMask: BABYLON.StandardMaterial
  static initiated: boolean
  static renderObservable: BABYLON.Observer<BABYLON.Scene> | null
  static renderer: CSS3DRenderer
  div: HTMLDivElement | undefined = undefined
  iframe: HTMLIFrameElement | undefined = undefined
  scene: Scene
  CSSobject: CSS3DObject | undefined = undefined
  width = 480
  height = 360 // Twitch minimum height is 300
  playing = false
  feature: Youtube
  volume = 1
  updateVolumeTimer: number
  rolloffFactor = 1
  refDistance = 1
  fadeState: FadeState | undefined = undefined
  disposed = false

  constructor(feature: Youtube, scene: Scene, ratio: number) {
    this.feature = feature
    this.scene = scene
    this.playing = false
    this.height = Math.floor(this.width / ratio)

    if (!YoutubePlayer.initiated) {
      // Create css3d renderer
      YoutubePlayer.initiate(scene)
    }

    this.updateVolumeTimer = setInterval(this.refreshVolume.bind(this), VOLUME_REFRESH_INTERVAL)

    this.createCSSobject()
    this.createMaskingScreen()

    this.addIframe()
    this.playing = true
  }

  get audio() {
    return window._audio
  }

  get plane() {
    return this.feature.mesh
  }

  get engine() {
    return this.scene.getEngine()
  }

  // COMMANDER WORF - INITIATE!
  static initiate(scene: Scene) {
    if (YoutubePlayer.initiated) {
      return
    }
    // Babylon 5 added a performance improvement that affects rendering order.
    // To guarantee the youtube feature to work, we add this little line below which nerfs that perf Improvement.
    // @todo: remove and start using renderGroupId https://forum.babylonjs.com/t/depth-mask-broken-in-5-5-6/30217/3
    scene.setRenderingOrder(0, () => 0)

    YoutubePlayer.initiated = true

    // Create depthmask
    YoutubePlayer.depthMask = new BABYLON.StandardMaterial('feature/youtube-depth-mask', scene)
    YoutubePlayer.depthMask.backFaceCulling = false
    YoutubePlayer.depthMask.zOffset = -16
    YoutubePlayer.depthMask.blockDirtyMechanism = true

    const container = document.createElement('div')
    container.id = 'youtube-css-container'
    document.body.insertBefore(container, document.body.firstChild)

    YoutubePlayer.renderer = new CSS3DRenderer()
    container.appendChild(YoutubePlayer.renderer.domElement)
    YoutubePlayer.renderer.setSize(window.innerWidth, window.innerHeight)

    window.addEventListener('resize', () => {
      YoutubePlayer.renderer.setSize(window.innerWidth, window.innerHeight)
    })
  }

  refreshVolume() {
    const parcelOutVolume = this.audio?.parcelOut.gain.value || 0
    let volume = parcelOutVolume * 2 * this.volume * this.getFadeMultiplier()

    // YouTube's setVolume API takes 0-100; Twitch is handled elsewhere via the PiP overlay.
    const serviceMultiplier = 100

    // no need to do the distance rollOff calc if volume is 0
    if (volume > 0) {
      const distanceMultiplier = this.getVolumeMultiplier()
      volume = volume * serviceMultiplier * distanceMultiplier
    }

    this.send('setVolume', [volume])
  }

  refreshPosition() {
    if (!this.feature.mesh) {
      console.error('Youtube: No mesh to refresh position')
      return
    }
    if (!this.disposed && this.CSSobject) {
      this.CSSobject.position.copyFrom(this.feature.mesh.getAbsolutePosition())
      this.CSSobject.scaling.copyFrom(this.feature.mesh.scaling)
      this.refreshRotation()
    }
  }

  refreshRotation = () => {
    if (!this.feature.mesh) {
      console.error('Youtube: No mesh to refresh rotation')
      return
    }
    if (this.CSSobject) {
      this.CSSobject.rotation.y = -this.feature.mesh.rotation.y
      this.CSSobject.rotation.x = -this.feature.mesh.rotation.x
      this.CSSobject.rotation.z = this.feature.mesh.rotation.z
    }
  }

  getFadeMultiplier() {
    if (this.fadeState) {
      if (Date.now() <= this.fadeState.startTime) {
        return this.fadeState.from
      } else if (Date.now() >= this.fadeState.duration + this.fadeState.startTime) {
        return this.fadeState.to
      } else {
        const position = (Date.now() - this.fadeState.startTime) / this.fadeState.duration
        const easedPosition = position * (2 - position)
        const range = this.fadeState.to - this.fadeState.from
        return this.fadeState.from + range * easedPosition
      }
    } else {
      return 1
    }
  }

  getVolumeMultiplier() {
    const distance = this.scene.activeCamera ? this.feature.positionInGrid.subtract(this.scene.cameraPosition).length() : 5.0
    return Math.pow(Math.max(distance, this.refDistance) / this.refDistance, -this.rolloffFactor)
  }

  dispose() {
    // ensure can only be disposed once
    if (this.disposed) return
    this.disposed = true

    this.scene.onBeforeRenderObservable.remove(YoutubePlayer.renderObservable)
    YoutubePlayer.renderObservable = null
    this.CSSobject?.dispose()
    this.iframe?.remove()
    this.div?.remove()

    clearInterval(this.updateVolumeTimer)

    this.plane?.onBeforeRenderObservable.clear()
    this.plane?.onAfterRenderObservable.clear()
  }

  createCSSobject() {
    YoutubePlayer.renderObservable = this.scene.onBeforeRenderObservable.add(() => {
      if (!this.scene.activeCamera) return
      YoutubePlayer.renderer.render(this.scene, this.scene.activeCamera, this.height)
    })

    const div = document.createElement('div')
    div.style.width = this.width + 'px'
    div.style.height = this.height + 'px'
    div.style.backgroundColor = '#000'
    this.div = div
    this.CSSobject = new CSS3DObject(div, this.scene)
    this.refreshPosition()
  }

  iframeUrl() {
    const loopParams = this.feature.loop ? `&loop=1&playlist=${this.feature.videoId}` : ''
    return ['https://www.youtube.com/embed/', this.feature.videoId, '?rel=0&enablejsapi=1&disablekb=1&autoplay=1&playsinline=1&controls=0&fs=0&modestbranding=1', loopParams].join('')
  }

  addIframe() {
    this.iframe = document.createElement('iframe')
    this.iframe.id = 'video-' + this.feature.videoId
    this.iframe.style.width = this.width + 'px'
    this.iframe.style.height = this.height + 'px'
    this.iframe.style.border = '0px'

    // Privacy
    this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation')
    // this.iframe.sandbox = 'allow-scripts allow-same-origin allow-presentation allow-autoplay'
    this.iframe.referrerPolicy = 'strict-origin-when-cross-origin' //REFERRERPOLICY="strict-origin-when-cross-origin"
    // this.iframe.loading = 'lazy' // for perf
    this.iframe.allowFullscreen = false // (or true if you want fullscreen)

    // fill the seams
    this.iframe.style.outline = '10px solid black'
    this.iframe.style.visibility = 'visible'

    this.iframe.allow = 'autoplay'
    this.iframe.src = this.iframeUrl() || ''
    this.div?.appendChild(this.iframe)
  }

  fadeIn(seconds: number, fromZero = false) {
    const from = fromZero ? 0 : this.getFadeMultiplier()
    this.fadeState = {
      from,
      to: 1,
      startTime: Date.now(),
      duration: seconds * 1000,
    }
  }

  fadeOut(seconds: number) {
    this.fadeState = {
      from: this.getFadeMultiplier(),
      to: 0,
      startTime: Date.now(),
      duration: seconds * 1000,
    }
  }

  send(func: YoutubeCommand, args: unknown[] = []) {
    if (!this.iframe || !YOUTUBE_COMMANDS.has(func)) return
    this.iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*')
  }

  pause() {
    this.send('pauseVideo')
  }

  unpause() {
    this.send('playVideo')
  }

  createMaskingScreen() {
    if (!this.plane) {
      throw new Error('YoutubePlayer: No plane to create mask')
    }
    this.plane.material = YoutubePlayer.depthMask

    const scene = this.scene
    // There's probably a better way to refer to 'engine'
    this.plane.onBeforeRenderObservable.add(() => this.engine.setColorWrite(false))
    this.plane.onAfterRenderObservable.add(() => this.engine.setColorWrite(true))

    // swap meshes to put mask first
    const mask_index = scene.meshes.indexOf(this.plane)

    // If there are videos already at the start of the list (most likely videos that were just playing)
    // make sure to keep them there and swap out the next available mesh
    let i = 0
    let blnEnd = false

    // Find the next available mesh that we can swap out
    while (i < mask_index && !blnEnd) {
      const refMesh = scene.meshes[i]
      if (!refMesh.name.startsWith('feature/youtube')) {
        blnEnd = true
      } else {
        i++
      }
    }
    scene.meshes[mask_index] = scene.meshes[i]
    scene.meshes[i] = this.plane
  }
}
