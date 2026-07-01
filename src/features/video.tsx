import { duckRadio, unduckRadio } from '../../web/src/radio/global'
import { isBatterySaver, isChrome } from '../../common/helpers/detector'
import { ProxyAssetOpensea } from '../../common/messages/api-opensea'
import { VideoRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import Panel from '../../web/src/components/panel'
import { AudioBus } from '../audio/audio-engine'
import { SpatialAudio } from '../audio/spatial-audio'
import { Advanced, Animation, BlendMode, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar, UrlSourceVideos } from '../ui/features'
import { isURL, tidyFloat } from '../utils/helpers'
import { opensea, readOpenseaUrl } from '../utils/proxy'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D } from './feature'
import { audioFadeInAndPlay, audioFadeOutAndStop, AudioFeature, AUTOPLAY_FADE_TIME } from './utils/audio'

const DEFAULT_VOLUME = 0.7
const MAX_VOLUME = 1

export default class Video extends Feature2D<VideoRecord> implements AudioFeature {
  static metadata: FeatureMetadata = {
    title: 'Video',
    subtitle: 'short video files',
    type: 'video',
    image: '/icons/video.png',
  }
  static template: FeatureTemplate = {
    type: 'video',
    scale: [2, 1, 0],
    url: '',
  }
  playing = false
  videoTexture: BABYLON.VideoTexture | null = null
  hasBeenGeneratedAtLeastOnce = false // First generate has been called? Feature has loaded but it having a mesh is not guaranteed
  autoStopTimeout: NodeJS.Timeout | null = null
  spatialAudio: SpatialAudio | null = null
  asset: ProxyAssetOpensea | null = null
  // save the previous URL so we can do some state check in getVideoDuration (and avoid querying for duration every generate)
  prevUrl: string | undefined = this.url

  private _duration = 0

  get duration(): number {
    return !this._duration || isNaN(this._duration) ? 0 : Math.abs(this._duration)
  }

  get audio() {
    return window._audio
  }

  get previewUrl() {
    const previewUrl = this.description.previewUrl
    if (previewUrl) {
      return `${process.env.IMG_URL}/img?url=${encodeURIComponent(previewUrl)}&mode=color&stretch=true`
    } else {
      return '/images/play-video.png'
    }
  }

  get isOpenseaNFT() {
    return !!this.url?.match(/(https?:\/\/(.+?\.)?opensea\.io(\/[a-z0-9\-._~:/?#[\]@!$&'()*+,;=]*)?)/gi) && !this.url?.match(/storage.opensea/gi)
  }

  get nftInfo() {
    if (!this.url) {
      return null
    }
    return readOpenseaUrl(this.url)
  }

  get hasAnimation() {
    return this.asset && !!this.asset.animation_url
  }

  get autoplay() {
    return !!this.description.autoplay
  }

  get hasAudio() {
    return this.volume > 0
  }

  get loop() {
    return !!this.description.loop
  }

  get endAt(): number {
    const x = this.description.endAt
    return !x || isNaN(x) ? 0 : Math.abs(x)
  }

  get startAt(): number {
    const x = this.description.startAt
    return !x || isNaN(x) ? 0 : Math.abs(x)
  }

  get rolloffFactor() {
    if (typeof this.description.rolloffFactor === 'number') {
      return this.description.rolloffFactor
    } else {
      return this.autoplay ? 1 : 1.2
    }
  }

  get volume() {
    if (typeof this.description.volume === 'number') {
      return Math.max(0, Math.min(this.description.volume, MAX_VOLUME))
    } else {
      return DEFAULT_VOLUME
    }
  }

  toString() {
    return this.url || super.toString()
  }

  shouldBeInteractive(): boolean {
    return !!this.url && isURL(this.url)
  }

  whatIsThis() {
    return <label>Display a video in-world. HLS is no longer supported.</label>
  }

  async displayPreview() {
    if (this.disposed) {
      console.debug('Video displayPreview: disposed')
      return
    }
    if (!this.mesh) {
      throw new Error('Video displayPreview: No mesh to display new texture')
    }
    try {
      const material = this.mesh.material as BABYLON.StandardMaterial
      const texture = new BABYLON.Texture(this.previewUrl, this.scene, false, true, BABYLON.Texture.BILINEAR_SAMPLINGMODE, () => {
        material.diffuseTexture = texture
      })
      texture.hasAlpha = false
      material.diffuseTexture = texture
    } catch (e) {
      console.error('Video displayPreview', e)
    }
  }

  // Warning! Hacky solution.
  // Used w/ FeatureEditor.openedEditor to allow feature -> editor communication

  afterSetCommon = () => {
    if (this.spatialAudio) {
      this.spatialAudio.setPosition(this.absolutePosition)
      this.spatialAudio.volume = this.volume
    }
  }

  afterGenerate() {
    this.addAnimation()
  }

  // These attributes update when the URL changes, via ui.tsx => UrlSourceVideos
  updateDurationOnUI() {
    this.setEditorState({ duration: this.duration })
  }

  generate() {
    if (this.videoTexture) {
      this.videoTexture.video.pause()
      this.playing = false
      this.videoTexture.dispose()
      this.videoTexture = null
    }

    if (this.spatialAudio) {
      this.spatialAudio.dispose()
      this.spatialAudio = null
    }

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.alpha = 0.999

    // move the zOffset so that videos are behind the loader which is 4
    material.zOffset = -3
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 1, 1)

    if (this.blendMode === 'Multiply') {
      material.alphaMode = BABYLON.Engine.ALPHA_MULTIPLY
    } else if (this.blendMode === 'Screen') {
      material.alphaMode = BABYLON.Engine.ALPHA_SCREENMODE
    } else {
      material.alphaMode = BABYLON.Engine.ALPHA_COMBINE
      // since this image has no transparency, turn off unnecessary alpha blending
      // https://doc.babylonjs.com/how_to/how_to_use_blend_modes#how-to-use-blend-modes
      material.alpha = 1
    }
    material.blockDirtyMechanism = true

    const plane = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    plane.material = material
    this.mesh = plane
    this.mesh.onAfterWorldMatrixUpdateObservable.add(this.updateAfterWorldOffsetChange)

    this.setCommon()
    this.displayPreview().catch(console.error)

    if (this.deprecatedSince('5.30.1')) {
      this.description.autoplay = false
    }

    if (this.deprecatedSince('5.48.6') && this.isOpenseaNFT) {
      this.getAssetVideo().then((url) => {
        this.description.assetUrl = this.url
        this.description.url = url
      })
    }

    if (this.deprecatedSince('5.49.1')) {
      this.description.loop = true
    }

    // Grab the video duration on Generate, Video should then be playable or play.
    // If we have no duration, the video should still play, but the `endAt` property should just be nerfed.
    this.getVideoDuration().then(() => {
      this.updateDurationOnUI()
      if (this.url) {
        this.addEvents()
      }

      /// onEnter is called onFeature creation now (if the user is inside the parcel), therefore
      /// this.hasBeenGeneratedAtLeastOnce catches the case where the feature is being edited for example;
      /// (so enabling autoplay in featureEditor should start playing the video)
      if (!this.playing && this.hasBeenGeneratedAtLeastOnce && this.isInCurrentParcel) {
        this.onEnter()
      }
    })

    this.hasBeenGeneratedAtLeastOnce = true
    this.afterGenerate()
    return Promise.resolve()
  }

  updateAfterWorldOffsetChange = () => {
    if (this.spatialAudio) {
      this.spatialAudio.setPosition(this.absolutePosition)
    }
  }

  getVideoDuration = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!this.url) {
        // no url, no duration
        this._duration = 0
        resolve()
        return
      }
      if (this._duration && this.url.toLowerCase() == this.prevUrl?.toLowerCase()) {
        // request for duration but url hasn't changed; resolve.
        resolve()
        return
      }
      this.prevUrl = this.url
      // We grab the video duration by creating a video element, loading its metadata and grab the duration from that
      // A negative impact (although insignificant) is that we now technically load the video data twice.
      const video = document.createElement('video')
      video.src = this.url
      const removeVideoElement = () => {
        // We delete the video element to avoid clogging up the HTML.
        video?.remove()
      }

      const onAbort = () => {
        removeVideoElement()
        reject()
      }

      video.addEventListener(
        'error',
        () => {
          this._duration = 0

          resolve()
          removeVideoElement()
          this.abortController.signal.removeEventListener('abort', onAbort)
        },
        { signal: this.abortController.signal },
      )
      video.addEventListener(
        'loadedmetadata',
        () => {
          this._duration = tidyFloat(video.duration?.toFixed(1), 0)

          resolve()
          removeVideoElement()
          this.abortController.signal.removeEventListener('abort', onAbort)
        },
        { signal: this.abortController.signal },
      )
      this.abortController.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  onEnter = () => {
    if (!this.autoplay || window.config.isOrbit) {
      return
    }
    if (isBatterySaver()) {
      console.log('Battery saver mode, skipping video autoplay')
      return
    }
    audioFadeInAndPlay(this)
  }

  onExit = () => {
    audioFadeOutAndStop(this)
  }

  onClick() {
    console.log('onclick')
    if (this.playing) {
      this.pause()
    } else {
      this.play().catch(console.error)
    }
  }

  stop() {
    if (this.videoTexture) {
      this.videoTexture.video.pause()
      this.playing = false
      unduckRadio(this)
      if (!this.loop) this.displayPreview().catch(console.error)
    }
    this.setCurrentVideoTime(this.startAt)
  }

  pause() {
    if (this.videoTexture) {
      this.videoTexture.video.pause()
      this.playing = false
      unduckRadio(this)
    }
  }

  setCurrentVideoTime(time: number) {
    if (this.videoTexture) {
      this.videoTexture.video.currentTime = time
    }
  }

  async play() {
    if (this.disposed) {
      throw new Error('Video Play: Video has been disposed')
    }

    if (!this.mesh) {
      throw new Error('Video Play: No mesh found')
    }
    if (this.videoTexture) {
      this.videoTexture.video.play().catch(console.error)

      if (this.autoplay) {
        this.fadeIn(AUTOPLAY_FADE_TIME)
      }
      this.playing = true
      this.hasAudio && duckRadio(this)
      return
    }

    const u = this.videoUrl()
    if (!u) {
      throw new Error('No URL for video, aborting the video.play() action')
    }

    const video = document.createElement('video')

    if (this.autoplay && isChrome()) {
      // Necessary or chrome won't play the video
      // We then unmute the video using a fake user Interaction 'fakeclick'
      video.muted = true
    }

    video.src = u

    let started = false
    const mediaSource = BABYLON.Engine.audioEngine?.audioContext?.createMediaElementSource(video)

    if (mediaSource && this.hasAudio && this.audio) {
      this.spatialAudio = this.audio.createSpatialAudio({
        name: 'feature/video/sound',
        outputBus: AudioBus.Parcel,
        audioNode: mediaSource,
        absolutePosition: this.absolutePosition,
      })
      this.spatialAudio.rolloffFactor = this.rolloffFactor
      this.afterSetCommon()
    } else {
      video.muted = true
    }

    // Duration is 0; Therefore just ignore the `endAt` feature and run the video as usual
    if (!this.duration || !this.endAt) {
      video.addEventListener(
        'ended',
        () => {
          this.stop()
          if (this.loop) this.play().catch(console.error)
        },
        { signal: this.abortController.signal },
      )
    } else {
      // Duration is not zero:
      video.addEventListener(
        'timeupdate',
        () => {
          // If we have an "endAt" option set by the user, use it;
          if (video.currentTime >= Math.min(this.endAt, this.duration)) {
            this.stop()
            if (this.loop && this.startAt < this.endAt) {
              this.play().catch(console.error)
            }
          }
        },
        { signal: this.abortController.signal },
      )
    }

    // this automatically calls video.play()
    this.videoTexture = new BABYLON.VideoTexture(this.uniqueEntityName('texture'), video, this.scene, true)
    this.playing = true
    this.videoTexture.anisotropicFilteringLevel = 2
    // Defaults to True. loop initiates in the 'ended' eventListener
    video.loop = false
    this.setCurrentVideoTime(this.startAt)

    const material = this.mesh.material as BABYLON.StandardMaterial
    const mesh = this.mesh

    // A fake user interaction used to unmute the video if it was muted to allow autoplay
    video.addEventListener(
      'fakeclick',
      () => {
        if (this.disposed) return
        video.muted = false
        video.play()
      },
      { signal: this.abortController.signal },
    )

    // don't switch the texture until playing
    video.addEventListener(
      'playing',
      () => {
        if (this.disposed) return

        // dispose of loader with this one weird trick :/
        if (this.mesh != mesh) {
          this.mesh?.dispose()
          this.mesh = mesh
        }

        material.diffuseTexture = this.videoTexture

        if (this.autoplay && !started) {
          this.fadeIn(AUTOPLAY_FADE_TIME, true)
        }

        if (this.autoplay && this.hasAudio && video.muted) {
          // If the video has autoplay and is muted we dispatch a fake user interaction to unmute it
          // This is because browsers hate autoplay and try to mute all autoplays
          const fakeClick = new Event('fakeclick')
          video.dispatchEvent(fakeClick)
        }
        started = true
      },
      { signal: this.abortController.signal },
    )
    // pause soundtrack
    this.hasAudio && duckRadio(this)
  }

  fadeIn(timeConstant: number, fromZero = false) {
    if (this.spatialAudio) {
      this.spatialAudio.fadeIn(timeConstant, fromZero)
    }
  }

  fadeOut(timeConstant: number) {
    if (this.spatialAudio) {
      this.spatialAudio.fadeOut(timeConstant)
    }
  }

  async getAssetVideo() {
    if (!this.url) {
      return null
    }
    const nftInfo = this.nftInfo
    if (!nftInfo) {
      return null
    }

    if (this.hasAnimation && this.asset?.token_id === nftInfo.token && this.asset?.asset_contract.address === nftInfo.contract) {
      return this.asset?.animation_url
    } else {
      const data = await opensea(nftInfo.contract, nftInfo.token, nftInfo.chain, this.parcel.owner, false).catch((err) => {
        console.warn(`Video: couldn't fetch NFT for parcel ${this.parcel.id}`, err, nftInfo)
      })
      if (data) {
        this.asset = data
        if (this.hasAnimation && this.asset) {
          return this.asset.animation_url
        }
      }

      return null
    }
  }

  videoUrl(): string {
    // handle dropbox URLs, see this info https://www.dropboxforum.com/t5/Create-upload-and-share/Shared-Link-quot-scl-quot-to-quot-s-quot/td-p/689070
    if (this.url?.startsWith('https://www.dropbox.com/s/')) {
      // old link format
      return this.url?.replace('https://www.dropbox.com/s/', 'https://dl.dropboxusercontent.com/s/').replace(/\?.+/, '')
    }
    if (this.url?.startsWith('https://www.dropbox.com/scl/')) {
      // newer link old format
      return this.url?.replace('https://www.dropbox.com/scl/', 'https://dl.dropboxusercontent.com/scl/')
    }
    return this.url ?? ''
  }

  dispose() {
    unduckRadio(this)

    this._dispose()

    if (this.spatialAudio) {
      this.spatialAudio.dispose()
    }

    if (this.videoTexture) {
      this.videoTexture.dispose()
    }
  }
}

class Editor extends FeatureEditor<Video> {
  constructor(props: FeatureEditorProps<Video>) {
    super(props)

    // Warning! Hacky solution.
    // Used w/ setEditorState to allow feature -> editor communication
    FeatureEditor.openedEditor = this

    this.state = {
      id: props.feature.description.id,
      url: props.feature.description.url,
      assetUrl: props.feature.description.assetUrl,
      blendMode: props.feature.blendMode,
      previewUrl: props.feature.description.previewUrl,
      autoplay: !!props.feature.description.autoplay,
      loop: props.feature.description.loop,
      startAt: props.feature.startAt,
      endAt: props.feature.endAt,
      rolloffFactor: props.feature.rolloffFactor,
      volume: props.feature.volume, // use the prop for default values

      // editor states (non-feature description)
      duration: props.feature.duration,
    }
  }

  componentDidUpdate() {
    this.merge({
      previewUrl: this.state.previewUrl,
      autoplay: this.state.autoplay,
      loop: this.state.loop,
      startAt: this.state.startAt,
      endAt: this.state.endAt,
      rolloffFactor: this.state.rolloffFactor,
      volume: this.state.volume,
    })
  }

  onBlendModeChange = (e: string) => {
    this.setState({ blendMode: e })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Video Feature</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={this.props.feature} scene={this.props.scene} />
          <EditorProps>
            {/* keys are provided so that the getState in the component is reset after gizmo is used */}
            <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
            <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
            <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />

            <UrlSourceVideos feature={this.props.feature} />

            <div className="f">
              <label>Preview Image URL (optional)</label>
              <input type="text" value={this.state.previewUrl} onInput={(e) => this.setState({ previewUrl: e.currentTarget.value })} />
              <small>This image will show before the user plays the video.</small>
            </div>

            <Advanced>
              <FeatureID feature={this.props.feature} />

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

              <div class="f">
                <p>{this.state.duration ? 'The current video is ' + this.state.duration + 's long' : ''}</p>
                <div style="display: flex;">
                  <div style="margin-right: 4px;">
                    <label>Start At (optional)</label>
                    <input type="number" step="0.1" min="0" value={this.state.startAt} onChange={(e) => this.setState({ startAt: parseFloat(e.currentTarget.value) })} />
                  </div>
                  <div>
                    <label>End At (optional)</label>
                    <input type="number" step="0.1" min="0" value={this.state.endAt} onChange={(e) => this.setState({ endAt: parseFloat(e.currentTarget.value) })} />
                  </div>
                </div>
                <small>Start and Stop the playback at a specific points (in seconds).</small>
                {this.state.startAt > this.state.endAt && <Panel type="warning">StartAt is lower than EndAt</Panel>}
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

              <Animation feature={this.props.feature} />
              <BlendMode feature={this.props.feature} handleStateChange={this.onBlendModeChange} />

              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Video.Editor = Editor
