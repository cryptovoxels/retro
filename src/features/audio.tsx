import { duckRadio, unduckRadio } from '../../web/src/radio/global'
import { isBatterySaver } from '../../common/helpers/detector'
import { ProxyAssetOpensea } from '../../common/messages/api-opensea'
import { AudioRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { AudioBus, SoundParams } from '../audio/audio-engine'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar, UrlSourceAudio } from '../ui/features'
import OpenLink from '../ui/open-link'
import { opensea, readOpenseaUrl } from '../utils/proxy'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D } from './feature'
import { audioFadeInAndPlay, audioFadeOutAndStop, AudioFeature, AUTOPLAY_FADE_TIME } from './utils/audio'

const DEFAULT_VOLUME = 0.7
const MAX_VOLUME = 1

const playText = '▶'
const loadingText = '⧗'
const pauseText = '❚❚'
const defaultStatus = `0:00 / ?:??`

export default class Audio extends Feature2D<AudioRecord> implements AudioFeature {
  static active: Audio | null = null
  static metadata: FeatureMetadata = {
    title: 'Audio',
    subtitle: 'mp3 playback',
    type: 'audio',
    image: '/icons/audio.png',
  }
  static template: FeatureTemplate = {
    type: 'audio',
    scale: [2, 0.5, 0],
    url: '',
  }
  image: HTMLImageElement | null = null
  playing = false
  loadTriggered = false
  sound: BABYLON.Sound | null = null
  texture: BABYLON.GUI.AdvancedDynamicTexture | null = null
  interval: NodeJS.Timeout | null = null
  playButton: BABYLON.GUI.TextBlock | null = null
  playStatus: BABYLON.GUI.TextBlock | null = null
  playProgress: BABYLON.GUI.Slider | null = null
  hasBeenGeneratedAtLeastOnce = false // First generate has been called? Feature has loaded but it having a mesh is not guaranteed
  autoStopTimeout: NodeJS.Timeout | null = null
  asset: ProxyAssetOpensea | null = null

  // fixme
  get audio() {
    return window._audio
  }

  get sprite() {
    return !!this.description.sprite
  }

  get autoplay() {
    return !!this.description.autoplay
  }

  get loop() {
    return !!this.description.loop
  }

  get streaming() {
    return !!this.description.streaming
  }

  get isOpenseaNFT() {
    return !!this.url?.match(/(https?:\/\/(.+?\.)?opensea\.io(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/gim)
  }

  get rolloffFactor() {
    if (typeof this.description.rolloffFactor === 'number') {
      return this.description.rolloffFactor
    } else {
      return this.autoplay ? 1 : 1.2
    }
  }

  /**
   * Get the desired volume of the sound
   */
  get volume() {
    if (typeof this.description.volume === 'number') {
      return Math.max(0, Math.min(this.description.volume, MAX_VOLUME))
    } else {
      return DEFAULT_VOLUME
    }
  }

  /**
   * Get the desired play offset of the sound. Null if the sound isn't yet loaded
   */
  get targetPlayOffset(): number | null {
    if (!this.sound) {
      return null
    }
    const buffer = this.sound.getAudioBuffer()
    if (buffer && this.playProgress) {
      const duration = buffer.duration
      return this.playProgress.value * duration
    }
    return null
  }

  get hasAnimation() {
    return this.asset && !!this.asset.animation_url
  }

  get nftInfo() {
    if (!this.url) {
      return null
    }
    return readOpenseaUrl(this.url)
  }

  toString() {
    return this.url || super.toString()
  }

  whatIsThis() {
    return <label>This allows you to play an mp3 or wav audio in-world.</label>
  }

  async load() {
    if (!this.audio) {
      console.warn("window._audio wasn't found")
      return
    }

    // prevent audio from being loaded multiple times
    if (this.loadTriggered) return
    this.loadTriggered = true

    const url = await this.audioUrl()
    if (!url) {
      return
    }

    this.setStatusLoading()

    const baseOptions = {
      loop: this.loop,
      spatialSound: this.rolloffFactor > 0,
      distanceModel: 'exponential',
      maxDistance: 32,
      rolloffFactor: this.rolloffFactor,
      refDistance: 3,
    }

    const baseParams = { outputBus: AudioBus.Parcel, name: 'feature/audio' }

    let params: SoundParams

    if (this.streaming) {
      params = Object.assign({}, baseParams, {
        url: url,
        options: Object.assign({}, baseOptions, {
          autoplay: this.playing,
          streaming: true,
          skipCodecCheck: true,
        }),
      })
    } else {
      params = Object.assign({}, baseParams, {
        buffer: await this.getAudioBuffer(url),
        options: Object.assign({}, baseOptions, { autoplay: false }),
        // all sorts of race conditions when editing sprites :O -- load gets called for every change
        readyToPlayCallback: () => {
          this.playing && this.playFrom(this.targetPlayOffset || 0, this.autoplay)
        },
      })
    }

    if (!this.audio) throw new Error('Audio engine removed during load')
    this.sound = this.audio.createSound(params)

    if (this.streaming) {
      // for some reason the onReady callback isn't working with streaming sources
      const audioElement = this.sound['_htmlAudioElement'] as HTMLAudioElement
      // setup initial volume for fade
      audioElement?.addEventListener('playing', () => {
        this.fadeIn(AUTOPLAY_FADE_TIME)
        this.onPlaying(0)
      })
    }

    this.afterSetCommon()
    this.sound.onEndedObservable.add(() => {
      !this.loop && this.stop()
    })
  }

  updatePlayStatus(text: string) {
    if (this.playStatus) {
      this.playStatus.text = text
    }
  }

  playFrom(offset: number, fadeIn: boolean) {
    if (!this.sound) {
      console.error(`No sound object for parcel: ${this.parcel.id}, feature: ` + this.uuid)
      return
    }
    this.sound.play(0, offset)
    // fade in autoplay stuff so we don't scare the user
    if (fadeIn) {
      this.fadeIn(AUTOPLAY_FADE_TIME)
    }
    this.onPlaying(offset)
  }

  onPlaying(offset: number) {
    duckRadio(this)

    if (this.interval) {
      clearInterval(this.interval)
    }

    let timeOffset = offset + (this.sound?.currentTime || 0)
    this.updateStatus(timeOffset)
    this.interval = setInterval(() => {
      this.updateStatus(timeOffset++)
    }, 1000)
  }

  afterSetCommon = () => {
    if (this.sound) {
      this.sound.setPosition(this.absolutePosition)
      this.sound.setVolume(this.volume)
    }
  }

  play() {
    if (!this.audio) return
    if (this.playing) return // prevent double trigger :O

    if (!this.audio.running) {
      // if the audio context isn't running yet, wait a second and try again
      setTimeout(() => this.play(), 1000)
      return
    }

    this.playing = true
    this.updateStatus()

    // only one standard audio feature to play at a time, but allow multiple sprites and autoplay features
    if (!this.autoplay && !this.sprite) {
      if (Audio.active && Audio.active !== this && Audio.active.playing) {
        Audio.active.stop()
      }
      Audio.active = this
    }

    if (this.sound) {
      // pause the soundtrack while audio is active
      duckRadio(this)
      this.playFrom(this.targetPlayOffset || 0, this.autoplay)
    } else {
      this.updatePlayStatus('Loading...')
      this.load().catch((err) => {
        console.warn(err.message)
        this.stop()
        this.updatePlayStatus('Failed')
      })
    }
  }

  fadeIn(timeConstant: number) {
    if (this.audio && this.sound) {
      const soundGain = this.sound['_soundGain'].gain as AudioParam
      soundGain.setValueAtTime(0.0000001, this.audio.audioContext.currentTime)
      soundGain.setTargetAtTime(this.volume, this.audio.audioContext.currentTime, timeConstant)
    }
  }

  fadeOut(timeConstant: number) {
    if (this.audio && this.sound) {
      const soundGain = this.sound['_soundGain'].gain as AudioParam
      soundGain.setTargetAtTime(0, this.audio.audioContext.currentTime, timeConstant)
    }
  }

  stop() {
    if (!this.playing) return
    this.playing = false

    console.log('stopping', this.uuid)
    if (this.sound) {
      this.sound.stop()
      unduckRadio(this)
    }

    if (this.interval) {
      clearInterval(this.interval)
    }

    this.updateStatus()
  }

  setStatusLoading() {
    if (this.disposed || !this.mesh) return
    if (!this.playButton || !this.playProgress) return
    this.playButton.text = loadingText
  }

  updateStatus(time?: number) {
    if (this.disposed || !this.mesh) return
    if (!this.playButton || !this.playProgress) return
    const f = (t: number) => {
      return [Math.floor(t / 60), ((t % 60) / 100).toFixed(2).slice(2)].join(':')
    }

    if (this.playing) {
      this.playButton.text = pauseText

      if (this.sound && !this.sprite) {
        if (this.streaming) {
          this.updatePlayStatus('Streaming...')
        } else if (this.sound.getAudioBuffer()) {
          const duration = this.sound.getAudioBuffer()?.duration
          if (!duration) {
            return
          }
          this.updatePlayStatus([f(time || 0), f(duration)].join(' / '))
          this.playProgress.value = (1 / duration) * (time || 0)
        }
      }
    } else {
      this.playButton.text = playText

      if (!this.sound?.isPaused && !this.sprite) {
        this.playProgress.value = 0
      }

      if (!this.sprite) {
        this.updatePlayStatus(defaultStatus)
      }
    }
  }

  onClick() {
    if (this.playing) {
      this.stop()
    } else {
      this.play()
    }
  }

  /**
   * Update a playing audio in response to changing the progress slider
   */
  setPlayProgress(value: number): void {
    if (this.playProgress) {
      this.playProgress.value = value
    }

    if (this.playing) {
      const offset = this.targetPlayOffset || 0
      this.sound?.stop()
      this.playFrom(offset, false)
    }
  }

  onDownload() {
    this.url && OpenLink(this.url)
  }

  async getAssetMp3() {
    if (!this.url) {
      return null
    }
    const nftInfo = this.nftInfo
    if (!nftInfo) {
      return null
    }

    if (this.hasAnimation && this.asset?.token_id === nftInfo.token && this.asset?.asset_contract.address === nftInfo.contract) {
      return this.asset.animation_url
    } else {
      const data = await opensea(nftInfo.contract, nftInfo.token, nftInfo.chain, this.parcel.owner, false).catch((err) => {
        console.warn(`Audio: couldn't fetch NFT for parcel ${this.parcel.id}`, err, nftInfo)
      })
      if (data) {
        this.asset = data
        if (this.hasAnimation) {
          return this.asset?.animation_url
        }
      }

      return null
    }
  }

  async audioUrl() {
    if (this.streaming) {
      return this.url
    } else if (this.isOpenseaNFT) {
      const url = await this.getAssetMp3()
      return url ? `${process.env.IMG_URL}/audio?url=${encodeURIComponent(url)}&mode=audio` : undefined
    } else if (this.url) {
      return `${process.env.IMG_URL}/audio?url=${encodeURIComponent(this.url)}&mode=audio`
    }
  }

  shouldBeInteractive() {
    return !!this.url
  }

  generate() {
    const plane = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)

    // Used by controls.ts to suppress the blocking of move events
    plane.metadata = { captureMoveEvents: true }

    this.mesh = plane
    this.mesh.onAfterWorldMatrixUpdateObservable.add(this.updateAfterWorldOffsetChange)

    // Gross hack for old scaled audio elements
    if (Math.round(this.scale.x / this.scale.y) === 2) {
      this.tidyScale[1] /= 2
      this.tidyPosition[1] += 0.25
    }

    this.setCommon()

    this.texture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(plane, this.sprite ? 128 : 512, 128)
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = this.texture
    material.zOffset = -5
    material.blockDirtyMechanism = true
    plane.material = material
    this.addControls()

    if (this.sprite) {
      // not awaited, load happens out of band
      this.load().catch((err) => {
        console.warn(err.message)
        this.stop()
        this.updatePlayStatus('Failed 😞')
      })
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

  updateAfterWorldOffsetChange = () => {
    if (this.sound) {
      this.sound.setPosition(this.absolutePosition)
    }
  }

  onEnter = () => {
    if (!this.autoplay || window.config.isOrbit) {
      return
    }
    audioFadeInAndPlay(this)
  }

  onExit = () => {
    audioFadeOutAndStop(this)
  }

  pause() {
    if (!this.playing) return
    this.playing = false

    if (this.sound) {
      this.sound.pause()
    }

    if (this.interval) {
      clearInterval(this.interval)
    }

    this.updateStatus()
  }

  addControls() {
    const r = new BABYLON.GUI.Rectangle('controls')
    r.cornerRadius = 64
    r.background = 'white'
    r.width = 1
    r.height = 0.95
    this.texture?.addControl(r)

    const b = new BABYLON.GUI.TextBlock('play', '▶')
    b.width = '92px'
    b.height = '92px'
    b.color = 'black'
    b.fontSize = 50
    b.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
    b.onPointerClickObservable.add(() => this.onClick())
    r.addControl(b)
    this.playButton = b

    if (!this.sprite) {
      const s = new BABYLON.GUI.TextBlock('play', defaultStatus)
      s.width = '160px'
      s.height = '92px'
      s.left = '80px'
      s.color = 'black'
      s.fontSize = 22
      s.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
      r.addControl(s)
      this.playStatus = s

      const p = new BABYLON.GUI.Slider('progress')
      p.width = '184px'
      p.height = '18px'
      p.left = '230px'
      p.background = '#555555'
      p.value = 0
      p.maximum = 1
      p.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
      // Allow fast-forward / rewind via slider on mouseup
      p.onPointerUpObservable.add((value, eventState) => this.setPlayProgress(eventState.currentTarget.value))
      this.playProgress = p

      if (!this.streaming) {
        r.addControl(p)
      }

      const e = new BABYLON.GUI.TextBlock('ellipsis', '⋮')
      e.width = '32px'
      e.height = '92px'
      e.color = 'black'
      e.fontSize = 50
      e.left = '-32px'
      e.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT
      e.onPointerUpObservable.add(() => this.onDownload())
      r.addControl(e)
    }
  }

  dispose() {
    this._dispose()

    this.interval && clearInterval(this.interval)

    if (this.sound) {
      this.sound.dispose()
    }

    unduckRadio(this)

    // needed for feature.regenerate
    this.sound = null
    this.loadTriggered = false
  }

  private getAudioBuffer(url: string) {
    return fetch(url).then((resp) => {
      if (!resp.ok) throw new Error(resp.statusText)
      if (resp.headers.get('x-error')) throw new Error(resp.headers.get('x-error') || 'Unknown error')
      if (!resp.headers.get('content-type')?.startsWith('audio/')) throw new Error('Not an audio file')
      return resp.arrayBuffer()
    })
  }
}

class Editor extends FeatureEditor<Audio> {
  constructor(props: FeatureEditorProps<Audio>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      url: props.feature.description.url,
      sprite: props.feature.description.sprite,
      streaming: props.feature.description.streaming,
      autoplay: props.feature.description.autoplay,
      loop: props.feature.description.loop,
      rolloffFactor: props.feature.rolloffFactor,
      volume: props.feature.volume, // use the prop for default values
    }
  }

  componentDidUpdate() {
    this.merge({
      sprite: this.state.sprite,
      streaming: this.state.streaming,
      autoplay: this.state.autoplay,
      loop: this.state.loop,
      rolloffFactor: this.state.rolloffFactor,
      volume: this.state.volume,
    })
  }

  setSprite(sprite: boolean) {
    this.setState({ sprite })

    const scale = this.props.feature.tidyScale

    if (sprite) {
      scale[0] = scale[1]
    } else {
      scale[0] = scale[1] * 4
    }

    this.props.feature.set({ scale })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Audio Feature</h2>
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

            <UrlSourceAudio feature={this.props.feature}>
              {this.state.streaming ? <small>Url Must be begin with 'https://' as streaming is enabled</small> : <small>MP3s up to 10 minutes long are supported. Opensea audio NFTs are accepted.</small>}
            </UrlSourceAudio>

            <Advanced>
              <FeatureID feature={this.props.feature} />

              <div className="f">
                <label>Sprite</label>
                <input checked={this.state.sprite} onInput={(e) => this.setSprite(e.currentTarget.checked)} type="checkbox" />
                <small>Displays a small button and preloads audio</small>
              </div>

              <div className="f">
                <label>Streaming</label>
                <input checked={this.state.streaming} onInput={(e) => this.setState({ streaming: e.currentTarget.checked })} type="checkbox" />
                <small>Load audio directly for streaming sources</small>
              </div>

              <div className="f">
                <label>Autoplay</label>
                <input checked={this.state.autoplay} onInput={(e) => this.setState({ autoplay: e.currentTarget.checked })} type="checkbox" />
                <small>Play when someone enters the parcel</small>
              </div>

              <div className="f">
                <label>Loop (repeat forever)</label>
                <input checked={this.state.loop} onInput={(e) => this.setState({ loop: e.currentTarget.checked })} type="checkbox" />
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
              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Audio.Editor = Editor
