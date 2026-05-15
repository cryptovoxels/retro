import { isBatterySaver, isMobile, isTablet, wantsAudio } from '../../common/helpers/detector'
import type Grid from '../grid'
import type Persona from '../persona'
import { ExploreDetector } from './explore-detector'
import { FootstepSounds } from './footstep-sounds'
import { soundFx, SoundName } from './soundfx'
import { ambientTracks, mainTracks, TrackInfo } from './soundtracks'
import { SpatialAudio } from './spatial-audio'
import { TrackPlayer } from './track-player'

export interface AudioSettings {
  parcelAudioVolume: number
  musicVolume: number
  soundEffectsVolume: number
}

// music will pause if user is idle for more than this time in ms
const IDLE_TIME = 60e3

function requestAudio(audioContext: AudioContext, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (audioContext.state !== 'suspended') {
      resolve()
      return
    }

    // make it work!
    window.addEventListener('pointerdown', () => audioContext.resume(), { signal, passive: true })
    window.addEventListener('keydown', () => audioContext.resume(), { signal, passive: true })

    // babylon should get the audio context fired up for us soon, let's just wait!
    audioContext.addEventListener(
      'statechange',
      () => {
        if (audioContext.state === 'running') {
          resolve()
        }
      },
      { signal, passive: true },
    )
  })
}

function defaultValueOfType<T>(type: 'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function', value: unknown, defaultValue: T) {
  if (typeof value === type) {
    return value as T
  } else {
    return defaultValue
  }
}

enum PlayState {
  Exploring = 'Exploring', // explore threshold and conditions met (blast the big music)
  Ambient = 'Ambient', // not currently exploring or player is inside a parcel (ambient music)
  Paused = 'Paused', // in world audio has been triggered in a parcel, or we have just spawned (no music or ambience)
  Idle = 'Idle', // user has not moved for more than IDLE_TIME
  Lost = 'Lost', // user has gone out of bounds in a space
  Underwater = 'Underwater',
}

export enum AudioBus {
  Parcel = 'Parcel',
}

export interface SoundParams {
  name: string
  url?: string
  buffer?: ArrayBuffer
  readyToPlayCallback?: () => void
  options?: BABYLON.ISoundOptions
  outputBus?: AudioBus
}

interface SpatialAudioParams {
  name: string
  audioNode: AudioNode
  outputBus?: AudioBus
  rolloffFactor?: number
  absolutePosition: BABYLON.Vector3
}

function createSoundtrack(scene: BABYLON.Scene) {
  // make sure babylon already has all the soundtrack stuff setup before we try and create busses
  BABYLON.Sound._SceneComponentInitialization(scene)

  const soundTrack = new BABYLON.SoundTrack(scene, {}) as any
  soundTrack._initializeSoundTrackAudioGraph()
  return soundTrack as BABYLON.SoundTrack
}

export class AudioEngine {
  engine: BABYLON.Engine = undefined!
  grid: Grid
  babylonAudioEngine: BABYLON.IAudioEngine | null
  scene: BABYLON.Scene
  audioContext: AudioContext
  hasExplored = false
  lastMoveAt?: number

  inParcel = true
  suburb: string | null = null

  playState: PlayState = PlayState.Paused
  userAudioReferences: Set<object> = new Set()

  trackPlayers: Map<TrackInfo, TrackPlayer> = new Map()
  currentTrack: TrackInfo | null = null

  footstepSounds: FootstepSounds
  soundFx: Record<SoundName, BABYLON.Sound>

  exploreDetectorHigh: ExploreDetector
  exploreDetectorLow: ExploreDetector
  trackFilter: BiquadFilterNode
  trackOut: GainNode
  avatarOut: GainNode
  trackLimiter: DynamicsCompressorNode

  // used by both web audio and audio tags (for echo cancellation)

  parcelAudioBus: BABYLON.SoundTrack
  soundEffectsBus: BABYLON.SoundTrack

  soundLastPlayedAt = 0 // unix timestamp

  constructor(scene: BABYLON.Scene, grid: Grid) {
    if (!wantsAudio()) {
      throw new Error('Trying to create audio when not wanted')
    }

    this.babylonAudioEngine = BABYLON.Engine.audioEngine
    if (!this.babylonAudioEngine?.audioContext || !this.masterOut) {
      throw new Error('No audio engine')
    }
    this.scene = scene
    this.grid = grid
    this.audioContext = this.babylonAudioEngine.audioContext
    // create audio busses
    this.parcelAudioBus = createSoundtrack(this.scene)
    this.soundEffectsBus = createSoundtrack(this.scene)

    this.exploreDetectorHigh = new ExploreDetector(5 * 60, 2 * 60)
    this.exploreDetectorLow = new ExploreDetector(2 * 60, 30)

    // avatar audio
    this.avatarOut = this.audioContext.createGain()
    this.avatarOut.gain.value = 1
    this.footstepSounds = new FootstepSounds(this.avatarOut)

    // soundtrack mixer
    this.trackOut = this.audioContext.createGain()
    this.trackOut.gain.value = 1

    // inside we filter down the soundscapes
    this.trackFilter = this.audioContext.createBiquadFilter()
    this.trackFilter.type = 'highshelf'
    this.trackFilter.frequency.value = 1500
    this.trackFilter.gain.value = 0

    // let's put the track through a soft limiter to try and avoid clipping when the user pumps up the jam
    this.trackLimiter = createLimiter(this.audioContext)

    // connect it up
    this.trackOut.connect(this.trackFilter)
    this.avatarOut.connect(this.soundEffectsOut)

    this.trackFilter.connect(this.trackLimiter)
    if (!this.masterOut) {
      throw new Error('No master out')
    }
    this.trackLimiter.connect(this.masterOut)

    // load settings
    this.loadSettingsFromLocalStorage()

    this.soundFx = {} as Record<SoundName, BABYLON.Sound>

    if (isBatterySaver()) {
      this.soundFx = Object.entries(soundFx).reduce(
        (acc, [sound, options]) => {
          acc[sound as SoundName] = this.createSound({ name: sound, ...options })
          return acc
        },
        {} as Record<SoundName, BABYLON.Sound>,
      )
    }
  }

  get persona(): Persona {
    return this.connector?.persona
  }

  get isUnderwater(): boolean {
    return window.environment?.isUnderwater || false
  }

  get camera() {
    return this.scene.activeCamera
  }

  get masterOut(): GainNode | null {
    return this.babylonAudioEngine?.masterGain ?? null
  }

  get parcelOut(): GainNode {
    return this.parcelAudioBus['_outputAudioNode']
  }

  get soundEffectsOut(): GainNode {
    return this.soundEffectsBus['_outputAudioNode']
  }

  get running() {
    return this.audioContext.state !== 'suspended'
  }

  async ready() {
    while (this.audioContext.state !== 'running') {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  get connector() {
    return window.connector
  }

  // mobile and tablet have glitchy music playback
  get platformSupportsMusic() {
    return !isTablet() && !isMobile()
  }

  addToParcelBus(sound: BABYLON.Sound) {
    this.parcelAudioBus.addSound(sound)
  }

  addToEffectsBus(sound: BABYLON.Sound) {
    this.soundEffectsBus.addSound(sound)
  }

  createSound(params: SoundParams) {
    const sound = new BABYLON.Sound(params.name, params.url || params.buffer, this.scene, params.readyToPlayCallback, params.options)

    // default babylon doesn't copy the soundtrack when using `clone` so we manually patch to make the soundtrack/bus stick once cloned
    sound.clone = cloneWithSoundTrack

    if (params.outputBus === AudioBus.Parcel) {
      this.addToParcelBus(sound)
    } else {
      // AudioBus.Effects, also default
      this.addToEffectsBus(sound)
    }
    return sound
  }

  playSound(soundName: SoundName, limitPlaybackRate = false, worldPosition?: BABYLON.Vector3) {
    // allow a new sound every 250 - 500ms if limitPlaybackRate is set
    const nextPlayAllowedAt = this.soundLastPlayedAt + 250 + Math.random() * 250
    const sound = this.soundFx[soundName]

    if (!sound || (limitPlaybackRate && Date.now() < nextPlayAllowedAt)) return

    if (worldPosition) {
      sound.setPosition(this.connector.controls.worldToAbsolutePosition(worldPosition))
    }

    // Add some jitter to stop sound waves being summed and sounding crappy
    const playbackRate = Math.random() * 0.01 + 1
    sound.setPlaybackRate(playbackRate)

    sound.play()
    this.soundLastPlayedAt = Date.now()
  }

  stopSound(soundName: SoundName) {
    this.soundFx[soundName]?.stop()
  }

  createSpatialAudio(params: SpatialAudioParams) {
    const spatialAudio = new SpatialAudio(params.name, this.scene, params.audioNode, params.absolutePosition)

    if (params.rolloffFactor != null) {
      spatialAudio.rolloffFactor = params.rolloffFactor
    }
    if (params.outputBus === AudioBus.Parcel) {
      spatialAudio.output.connect(this.parcelOut)
    } else {
      // AudioBus.Effects, also default
      spatialAudio.output.connect(this.soundEffectsOut)
    }
    return spatialAudio
  }

  loadSettingsFromLocalStorage() {
    const stored = window.localStorage.getItem('audioSettings')
    const persistedSettings = stored ? tryParseJson(stored) : null
    if (persistedSettings) {
      this.setSettings(persistedSettings)
    }
  }

  setSettings(settings: AudioSettings) {
    this.trackOut.gain.value = defaultValueOfType('number', settings.musicVolume, 1)
    this.parcelAudioBus.setVolume(defaultValueOfType('number', settings.parcelAudioVolume, 1))
    this.soundEffectsBus.setVolume(defaultValueOfType('number', settings.soundEffectsVolume, 1))

    this.refreshTrack()
    window.localStorage.setItem('audioSettings', JSON.stringify(settings))
  }

  getSettings(): AudioSettings {
    return {
      musicVolume: this.trackOut.gain.value,
      parcelAudioVolume: this.parcelOut.gain.value,
      soundEffectsVolume: this.soundEffectsOut.gain.value,
    }
  }

  isLoading() {
    // ewwww gross
    return !!document.querySelector('.loading-spinner')
  }

  fadeOutTracks(time: number, options?: { exclude?: TrackPlayer }) {
    this.trackPlayers.forEach((player) => {
      if (player !== options?.exclude) {
        player.fadeOut(time)
      }
    })
  }

  refreshTrack() {
    if (this.playState === PlayState.Idle) {
      // fade out slowly if user is inactive (no need for weird background tab sound)
      this.fadeOutTracks(10)
      this.currentTrack = null
    } else if (this.playState === PlayState.Paused) {
      // fade out quickly if user generated audio is available
      this.fadeOutTracks(1)
      this.currentTrack = null
    } else if (this.playState === PlayState.Exploring) {
      // play main track
      const { mainTrackForSuburb } = getTracksForSuburb(this.suburb)
      this.playNextTrack(mainTrackForSuburb)
    } else if (this.playState === PlayState.Ambient) {
      // play ambient version of suburb track
      const { ambientTrackForSuburb } = getTracksForSuburb(this.suburb)
      this.playNextTrack(ambientTrackForSuburb)
    } else if (this.playState === PlayState.Lost) {
      this.playNextTrack(mainTracks.get('Void'))
    } else if (this.playState === PlayState.Underwater) {
      this.playNextTrack(mainTracks.get('Ocean'))
    }
  }

  playNextTrack(nextTrack: TrackInfo | undefined) {
    if (this.currentTrack === nextTrack) return

    if (!nextTrack) {
      // user has probably turned off ambient music
      this.fadeOutTracks(1)
      this.currentTrack = null
    } else if (this.playState === PlayState.Exploring && includesValue(mainTracks, this.currentTrack)) {
      // stay on current track if next track is also a main track
      return
    } else if (this.trackPlayers.has(nextTrack)) {
      // track is already playing, let's just fade it back in
      const nextPlayer = this.trackPlayers.get(nextTrack)
      this.fadeOutTracks(7, { exclude: nextPlayer })
      nextPlayer?.fadeIn(10)
      this.currentTrack = nextTrack
    } else {
      // time to load a new track and start it playing
      const nextPlayer = new TrackPlayer(
        nextTrack,
        this.trackOut,
        () => {
          // on ready: cross fade to new track
          this.fadeOutTracks(5, { exclude: nextPlayer })
          nextPlayer.fadeIn(10)
        },
        () => {
          // on fade out completed: remove track from set and dispose
          nextPlayer.dispose()
          this.trackPlayers.delete(nextTrack)
        },
      )
      this.trackPlayers.set(nextTrack, nextPlayer)
      this.currentTrack = nextTrack
    }
  }

  addUserAudioReference(userAudio: object) {
    // track when the user is playing in world sound
    this.userAudioReferences.add(userAudio)
    this.refreshPlayState()
  }

  removeUserAudioReference(userAudio: object) {
    this.userAudioReferences.delete(userAudio)
    this.refreshPlayState()
  }

  refreshSoundtrackFilter() {
    if (this.inParcel) {
      // going inside
      this.trackFilter.gain.setTargetAtTime(-10, this.audioContext.currentTime, 1)
    } else {
      // back outside
      this.trackFilter.gain.setTargetAtTime(0, this.audioContext.currentTime, 2)
    }
  }

  refreshPlayState() {
    let newState: PlayState

    if (window.config.isSpace) {
      // suppress music when in spaces unless they are out of bounds
      const isLost = !this.grid.currentOrNearestParcel()?.isNearby
      newState = isLost ? PlayState.Lost : PlayState.Paused
    } else if (this.isUnderwater) {
      newState = PlayState.Underwater
    } else if (this.lastMoveAt && Date.now() - this.lastMoveAt > IDLE_TIME) {
      // user has been idle for more than 1 minute, pause the music, go back to spawned state (user will need to explore before music starts again)
      newState = PlayState.Idle
      this.resetExploring()
    } else if (this.userAudioReferences.size > 0) {
      // if there is user audio playing (boombox, audio feature, video etc), pause the soundtrack
      newState = PlayState.Paused
    } else {
      // this will be the default once the initial exploreDetectorLow has been met
      // soundtrack will keep playing ambient
      newState = PlayState.Ambient
    }

    if (newState !== this.playState) {
      this.playState = newState

      // we refresh the track if the playState has changed for immediate update
      this.refreshTrack()
    }
  }

  resetExploring() {
    this.hasExplored = false
    this.exploreDetectorHigh.reset()
    this.exploreDetectorLow.reset()
  }

  async start(signal: AbortSignal) {
    await requestAudio(this.audioContext, signal)
    // make the spatial audio smooth and silky (JANK BE GONE!)
    this.scene.audioPositioningRefreshRate = 50
    const lastPosition = BABYLON.Vector3.Zero()
    // tracks
    if (!this.platformSupportsMusic) return
    const musicInterval = window.setInterval(() => {
      if (this.isLoading()) {
        console.debug('AudioManager: waiting for scene to load before updating audio state')
        return // wait until loading finishes before updating audio state
      }

      const nearestParcel = this.grid.currentOrNearestParcel()
      if (nearestParcel) {
        // this hack is required because parcels in some towers have a suburb from the mainland :/
        this.suburb = nearestParcel.island === 'Origin City' ? nearestParcel.suburb : nearestParcel.island
      }

      // detect player exploration
      const inParcel = nearestParcel && this.camera && nearestParcel.contains(this.camera.position)
      const isMoving = lastPosition && !lastPosition.equals(this.persona.position)
      const exploring = !inParcel && isMoving
      this.exploreDetectorHigh.addFrame(exploring)
      this.exploreDetectorLow.addFrame(exploring)
      lastPosition.copyFrom(this.persona.position)

      // keep track of if the player has done any moving outside of parcels yet
      // we'll keep the music paused until they do
      if (this.exploreDetectorLow.isTriggered() && !this.hasExplored) {
        this.hasExplored = true
      }

      // player location
      if (this.inParcel !== inParcel) {
        this.inParcel = !!inParcel
        this.refreshSoundtrackFilter()
        this.refreshTrack()
      }

      if (isMoving) {
        this.lastMoveAt = Date.now()
      }

      this.refreshPlayState()
    }, 250)
    // check the suburb every 30 seconds (but we also call refreshTrack immediately from refreshPlayState)
    const refreshInterval = setInterval(this.refreshTrack.bind(this), 30000)

    signal.addEventListener('abort', () => clearInterval(musicInterval), { once: true, passive: true })
    signal.addEventListener('abort', () => clearInterval(refreshInterval), { once: true, passive: true })
  }
}

function tryParseJson(json: string) {
  try {
    return JSON.parse(json)
  } catch (ex) {
    return null
  }
}

function includesValue<T>(map: Map<string, T>, testValue: T) {
  for (const value of map.values()) {
    if (value === testValue) {
      return true
    }
  }
  return false
}

function createLimiter(audioContext: AudioContext) {
  const limiter = audioContext.createDynamicsCompressor()
  limiter.threshold.value = 0
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.005
  limiter.release.value = 0.05
  return limiter
}

function cloneWithSoundTrack(this: BABYLON.Sound): BABYLON.Nullable<BABYLON.Sound> {
  const result = BABYLON.Sound.prototype.clone.call(this)
  const scene = this['_scene'] as BABYLON.Scene
  const soundtrack = scene.soundTracks?.find((s) => s.id === this.soundTrackId)
  if (result) {
    soundtrack?.addSound(result)
    result.clone = cloneWithSoundTrack
  }
  return result
}

function getTracksForSuburb(suburb: string | null) {
  if (!suburb) {
    return { mainTrackForSuburb: mainTracks.get('default'), ambientTrackForSuburb: ambientTracks.get('default') }
  }

  const mainTrackForSuburb = mainTracks.get(suburb) || mainTracks.get('default')

  // use ambient track if available, otherwise fallback to just playing the main audio always
  let ambientTrackForSuburb = ambientTracks.get(suburb) || mainTracks.get(suburb)

  // only use the default ambient track if we are also using the default music
  if (mainTrackForSuburb === mainTracks.get('default')) {
    ambientTrackForSuburb = ambientTracks.get('default') || mainTrackForSuburb
  }

  return { mainTrackForSuburb, ambientTrackForSuburb }
}
