import { duckRadio, unduckRadio } from '../../web/src/radio/global'
import { BoomboxRecord } from '../../common/messages/feature'
import { voxImporter } from '../../common/vox-import/vox-import'
import { Position, Rotation, Behaviours, EditorProps } from '../../web/src/components/editor'
import { AudioBus } from '../audio/audio-engine'
import Avatar from '../avatar'
import { BoomboxBroadcast, BroadcastStatus, openBoomboxBroadcastUI } from '../ui/boombox-broadcast'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature3D } from './feature'

const BOOMBOX_SCALE = BABYLON.Vector3.One()

interface BoomBoxSharedState {
  avatarId: string | null
  broadcastId: string | null
}

export default class Boombox extends Feature3D<BoomboxRecord> {
  static metadata: FeatureMetadata = {
    title: 'Boombox',
    subtitle: 'live audio streaming',
    type: 'boombox',
    image: '/icons/boombox.png',
  }
  static template: FeatureTemplate = {
    type: 'boombox',
    scale: [1, 1, 1],
  }
  broadcastingAvatar: Avatar | null = null
  onAvatarChangeObservable: BABYLON.Observable<Avatar> = new BABYLON.Observable()
  status: BroadcastStatus = BroadcastStatus.offline
  particleSystem: BABYLON.ParticleSystem | null = null
  sound: BABYLON.Sound | null = null
  lastPlaybackUrl: string | null = null
  interval: NodeJS.Timeout | null = null
  sharedState: BoomBoxSharedState | undefined = undefined
  broadcastWindow: BoomboxBroadcast | null | undefined = undefined

  get canBroadcast() {
    if (this.description.authBroadcast) {
      return this.parcel.canEdit
    } else {
      return true
    }
  }

  get scale() {
    return BOOMBOX_SCALE
  }

  // fixme
  get audio() {
    return window._audio
  }

  get volume() {
    return 1
  }

  get rolloffFactor() {
    if (typeof this.description.rolloffFactor === 'number') {
      return this.description.rolloffFactor
    } else {
      return 1.2
    }
  }

  get audioContext(): AudioContext | null {
    return BABYLON.Engine.audioEngine?.audioContext ?? null
  }

  async generate() {
    this.mesh = await voxImporter().import(process.env.ASSET_PATH + '/models/pa_and_mic.vox', { signal: this.abortController.signal })
    this.mesh.isPickable = true
    this.mesh.onAfterWorldMatrixUpdateObservable.add(this.updateAfterWorldOffsetChange)
    this.mesh.name = this.uniqueEntityName('mesh')
    this.mesh.id = this.uniqueEntityName('mesh')
    this.setCommon()

    this.interval = setInterval(() => {
      // we manually refresh the broadcast stream every 1 second in case the avatar has not loaded at the start, or the avatar
      // leaves without ending broadcast (somehow??!)
      // basically, this makes sure we get a stream (eventually)
      this.refreshBroadcastStream()
    }, 1000)

    this.addEvents()
    return Promise.resolve()
  }

  onEnter = () => {
    this.fadeIn(2)
    this.refreshSoundtrackState()
  }

  onExit = () => {
    this.fadeOut(2)
    this.refreshSoundtrackState()
  }

  toString() {
    return '[boombox]'
  }

  whatIsThis() {
    return <label>Allows a user to generate an audio stream to everyone else in the parcel. Useful for speeches. </label>
  }

  fadeIn(timeConstant: number) {
    if (this.sound && this.audioContext) {
      const soundGain = this.sound['_soundGain'].gain as AudioParam
      soundGain.setTargetAtTime(this.volume, this.audioContext.currentTime, timeConstant)
    }
  }

  fadeOut(timeConstant: number) {
    if (this.sound && this.audioContext) {
      const soundGain = this.sound['_soundGain'].gain as AudioParam
      soundGain.setTargetAtTime(0, this.audioContext.currentTime, timeConstant)
    }
  }

  updateAfterWorldOffsetChange = () => {
    if (this.sound) {
      this.sound.setPosition(this.absolutePosition)
    }
  }

  dispose() {
    this._dispose()

    this.close() // also stops active broadcast

    this.interval && clearInterval(this.interval)

    if (this.sound) {
      this.sound.dispose()
      this.sound = null
    }

    unduckRadio(this)
  }

  receiveState(state: BoomBoxSharedState) {
    this.sharedState = state
    this.refreshBroadcastStream()
  }

  sendState(state: BoomBoxSharedState) {
    this.sharedState = state
    this.parcel.sendStatePatch({ [this.uuid]: this.sharedState })
  }

  close() {
    if (this.broadcastWindow) {
      this.broadcastWindow.close()
    }
  }

  afterSetCommon = () => {
    if (this.sound) {
      this.sound.setPosition(this.absolutePosition)
    }
  }

  refreshSoundtrackState() {
    // duck the radio while boombox audio is playing in parcel
    const playerInParcel = this.parcel === this.parcel.grid.currentOrNearestParcel()

    if ((this.sound && playerInParcel) || this.getBroadcasterOpen()) {
      duckRadio(this)
    } else {
      unduckRadio(this)
    }
  }

  updatePlaybackStream(url: string) {
    if (!this.audio) return

    if (this.sound) {
      this.sound.dispose()
      this.sound = null
      this.stopEmit()
    }

    if (url) {
      this.emitParticles('🔊')

      const options = {
        streaming: true,
        loop: false,
        autoplay: true,
        spatialSound: this.rolloffFactor > 0,
        skipCodecCheck: true,
        distanceModel: 'exponential',
        maxDistance: 32,
        rolloffFactor: this.rolloffFactor,
        refDistance: 3,
      }

      this.sound = this.audio.createSound({
        outputBus: AudioBus.Parcel,
        name: 'feature/boombox',
        url: getMediaSourceUrl(url),
        options,
      })

      // if we're outside the parcel, mute the audio - it will be faded in onEnter
      if (this.parcel !== this.parcel.grid.currentOrNearestParcel()) {
        const soundGain = this.sound['_soundGain'].gain as AudioParam
        soundGain.value = 0
      }

      this.afterSetCommon()
    }

    this.refreshSoundtrackState()
  }

  refreshBroadcastStream() {
    if (this.sharedState && this.audio?.running) {
      const avatarId = this.sharedState.avatarId
      const broadcastId = this.sharedState.broadcastId
      if (avatarId) {
        if (this.connector.persona.uuid === avatarId) {
          // it is me, I am broadcasting!
          return
        }

        this.broadcastingAvatar = this.connector.findAvatar(avatarId) ?? null
      } else {
        this.broadcastingAvatar = null
      }

      // only play the stream if the broadcast user is still in world
      const url = broadcastId && this.broadcastingAvatar && `https://broadcast.cryptovoxels.com/stream-${encodeURIComponent(broadcastId)}`
      if (!!url && url !== this.lastPlaybackUrl) {
        this.lastPlaybackUrl = url
        if (this.broadcastingAvatar) {
          // if someone else starts broadcasting, stop our one
          this.stopBroadcast()
        }
        this.updatePlaybackStream(url)
        if (this.broadcastingAvatar) {
          this.onAvatarChangeObservable.notifyObservers(this.broadcastingAvatar)
        }
      }
    }
  }

  stopBroadcast() {
    this.broadcastWindow?.stopBroadcast()
  }

  emitParticles(emoji: string) {
    if (!this.mesh) {
      console.warn('Boombox: no mesh for particles to emit')
      return
    }
    this.stopEmit()
    const particleSystem = (this.particleSystem = new BABYLON.ParticleSystem('feature/boombox/emit-' + Math.round(Math.random() * 1000), 200, this.scene))

    //Texture of each particle
    const t = new BABYLON.DynamicTexture('feature/boombox/emoji', { width: 64, height: 64 }, this.scene, true)
    const ctx = t.getContext()

    ctx.font = '32px sans-serif'
    ctx.fillText(emoji, 8, 32)
    t.update()

    particleSystem.particleTexture = t

    // Where the particles come from
    particleSystem.emitter = this.mesh
    particleSystem.minEmitBox = new BABYLON.Vector3(0, 0.3, 0) // Starting all from
    particleSystem.maxEmitBox = new BABYLON.Vector3(0, 0, 0) // To...

    // Colors of all particles
    particleSystem.color1 = new BABYLON.Color4(1, 1, 1, 1)
    particleSystem.color2 = new BABYLON.Color4(1, 1, 1, 1)
    particleSystem.colorDead = new BABYLON.Color4(1, 1, 1, 0)

    // Size of each particle (random between...
    particleSystem.minSize = 0.1
    particleSystem.maxSize = 0.5

    // Life time of each particle (random between...
    particleSystem.minLifeTime = 1
    particleSystem.maxLifeTime = 2

    // Emission rate
    particleSystem.emitRate = 30

    // Blend mode : BLENDMODE_ONEONE, or BLENDMODE_STANDARD
    particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD

    // Set the gravity of all particles
    particleSystem.gravity = new BABYLON.Vector3(0, 3, 0)

    // Direction of each particle after it has been emitted
    particleSystem.direction1 = new BABYLON.Vector3(-2, 0, -2)
    particleSystem.direction2 = new BABYLON.Vector3(2, 0, 2)

    // Angular speed, in radians
    particleSystem.minAngularSpeed = 0
    particleSystem.maxAngularSpeed = 0 // Math.PI;

    // Speed
    particleSystem.minEmitPower = 0.2
    particleSystem.maxEmitPower = 1
    particleSystem.updateSpeed = 0.005

    // Start the particle system
    particleSystem.start()

    // slow the rate after 1.5 seconds
    setTimeout(() => (particleSystem.emitRate = 5), 1500)
  }

  stopEmit() {
    if (this.particleSystem) {
      const particleSystem = this.particleSystem
      particleSystem.emitRate = 0
      setTimeout(() => particleSystem.dispose(), 5000)
      this.particleSystem = null
    }
  }

  getBroadcasterOpen() {
    return !!this.broadcastWindow
  }

  onClick() {
    this.openBroadcaster()
  }

  async openBroadcaster() {
    if (!this.getBroadcasterOpen()) {
      this.broadcastWindow = await openBoomboxBroadcastUI(this, () => {
        this.broadcastWindow = null
        this.refreshSoundtrackState()
      })
      this.refreshSoundtrackState()
    }
  }
}

class Editor extends FeatureEditor<Boombox> {
  constructor(props: FeatureEditorProps<Boombox>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      rolloffFactor: props.feature.rolloffFactor, // use the prop for default values
      authBroadcast: props.feature.description.authBroadcast,
    }
  }

  componentDidUpdate() {
    this.merge({
      rolloffFactor: this.state.rolloffFactor,
      authBroadcast: this.state.authBroadcast,
    })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Boombox</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={this.props.feature} scene={this.props.scene} />
          <EditorProps>
            {/* keys are provided so that the getState in the component is reset after gizmo is used */}
            <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
            <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />

            <div className="f">
              <label>Spatial Rolloff Factor</label>
              <input type="range" step="0.1" min="0" max="5" value={this.state.rolloffFactor} onInput={(e) => this.setState({ rolloffFactor: parseFloat(e.currentTarget.value) })} />
              <small>Choose how quickly the sound fades away as the player moves away from the emitter (higher values fade away faster)</small>
            </div>

            <div className="f">
              <label>Permissions</label>
              <label>
                <input type="checkbox" checked={this.state.authBroadcast} onChange={(e) => this.setState({ authBroadcast: e.currentTarget.checked })} />
                Only collaborators can broadcast
              </label>
            </div>
            <Advanced>
              <FeatureID feature={this.props.feature} />
              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Boombox.Editor = Editor

function isMediaSourceSupported() {
  return window.MediaSource && window.MediaSource.isTypeSupported('audio/mpeg')
}

function getMediaSourceUrl(url: string) {
  // we wrap the url with a media source as this gives us much lower latency in Chrome
  // without this, Chrome adds about a 5 second delay to boomboxes
  // if the browser doesn't support media source, fallback to just loading url directly
  // this is fine because most browsers other than Chrome have much better latency on raw audio elements
  if (!isMediaSourceSupported()) return url

  const mediaSource = new window.MediaSource()
  mediaSource.onsourceopen = () => {
    window.fetch(url).then((response) => {
      let done = false
      const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg')
      const reader = response.body?.getReader()

      const nextChunk = (result: ReadableStreamReadValueResult<Uint8Array> | ReadableStreamReadDoneResult<Uint8Array>) => {
        if (result.done) {
          done = true
          return
        }
        try {
          sourceBuffer.appendBuffer(result.value.buffer)
        } catch (ex) {}
      }

      sourceBuffer.addEventListener('updateend', function () {
        if (!done) reader?.read().then(nextChunk)
      })

      reader?.read().then(nextChunk)
    })
  }
  return URL.createObjectURL(mediaSource)
}
