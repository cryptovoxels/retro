import { h } from 'preact'
import { isBatterySaver, isMobile } from '../../common/helpers/detector'
import { YoutubeRecord } from '../../common/messages/feature'
import { CSS3DObject, CSS3DRenderer } from '../../vendor/CSS3DRenderer'
import { Position, Rotation, Scale, Script } from '../../web/src/components/editor'
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

const TWITCH_YOUTUBE_FUNCTION_LOOKUP = {
  setVolume: 11,
  setMuted: 10,
  playVideo: true,
  pauseVideo: true,
}

const stopSignal = new EventTarget()

export function buildYoutubeThumbnailUrl(videoId: string | undefined): string | null {
  if (!videoId) {
    return null
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

export async function loadYoutubeThumbnail(scene: BABYLON.Scene, videoId: string | undefined, signal: AbortSignal): Promise<BABYLON.Texture> {
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
    if (!this.autoplay || window.config.isOrbit || isMobile()) {
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
    } else if (this.autoplay && !window.config.isOrbit) {
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
      this.setTwitchPreview()
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

  setTwitchPreview() {
    if (this.disposed) return
    const channel = this.videoId ?? 'unknown'
    const w = 640
    const h = 360
    const tex = new BABYLON.DynamicTexture(this.uniqueEntityName('tpreview' as any), { width: w, height: h }, this.scene, false)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    const font = 'bold 18px "Source Code Pro", monospace'

    ctx.fillStyle = '#1a1a1e'
    ctx.fillRect(0, 0, w, h)

    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#9146ff'
    ctx.fillText('twitch / ' + channel, w / 2, h / 2 - 40)

    ctx.fillStyle = '#f5f5f0'
    ctx.fillText('twitch embedding is disabled', w / 2, h / 2)

    const cta = '\u25B6 open on twitch.tv'
    const tw = ctx.measureText(cta).width
    const padX = 14
    const padY = 10
    const bw = tw + padX * 2
    const bh = 20 + padY * 2
    const bx = w / 2 - bw / 2
    const by = h / 2 + 30
    ctx.fillStyle = 'rgba(145,70,255,0.85)'
    ctx.fillRect(bx, by, bw, bh)
    ctx.fillStyle = '#f5f5f0'
    ctx.fillText(cta, w / 2, by + bh / 2)

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

  onClick() {
    if (this.isTwitch) {
      window.open('https://twitch.tv/' + this.videoId, '_blank')
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
    if (this.player) {
      this.player.dispose()
      this.player = null
    }
    this.audio?.removeUserAudioReference(this)
  }

  play() {
    if (this.disposed) return
    if (this.playing) return
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
  scene: BABYLON.Scene
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

  constructor(feature: Youtube, scene: BABYLON.Scene, ratio: number) {
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
  static initiate(scene: BABYLON.Scene) {
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

    const serviceMultiplier = this.feature.isYoutube ? 100 : 1

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
    const cam = this.scene.activeCamera?.globalPosition
    const distance = cam ? this.feature.positionInGrid.subtract(cam).length() : 5.0
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
    if (this.feature.isTwitch) {
      return `https://player.twitch.tv/?channel=${this.feature.videoId}&parent=${location.hostname}&autoplay=true&muted=false`
    } else if (this.feature.isYoutube) {
      const loopParams = this.feature.loop ? `&loop=1&playlist=${this.feature.videoId}` : ''
      return ['https://www.youtube.com/embed/', this.feature.videoId, '?rel=0&enablejsapi=1&disablekb=1&autoplay=1&playsinline=1&controls=0&fs=0&modestbranding=1', loopParams].join('')
    }
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

  send(func: keyof typeof TWITCH_YOUTUBE_FUNCTION_LOOKUP, args: any = []) {
    if (this.iframe) {
      if (this.feature.isTwitch) {
        if (!TWITCH_YOUTUBE_FUNCTION_LOOKUP[func]) return
        this.iframe.contentWindow?.postMessage(
          {
            namespace: 'twitch-embed-player-proxy',
            eventName: TWITCH_YOUTUBE_FUNCTION_LOOKUP[func],
            params: args[0],
          },
          '*',
        )
      } else if (this.feature.isYoutube) {
        if (!TWITCH_YOUTUBE_FUNCTION_LOOKUP[func]) return
        const message = JSON.stringify({
          event: 'command',
          func,
          args,
        })

        this.iframe.contentWindow?.postMessage(message, '*')
      }
    }
  }

  pause() {
    if (this.feature.isYoutube) {
      this.send('pauseVideo')
    } else if (this.feature.isTwitch) {
      this.send('setMuted', [true])
    }
  }

  unpause() {
    if (this.feature.isYoutube) {
      this.send('playVideo')
    } else {
      this.send('setMuted', [false])
    }
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
