import { wantsAudio } from '../../common/helpers/detector'
import type Persona from '../persona'
import { FootstepSounds } from './footstep-sounds'
import { FlySound } from './fly-sound'
import { soundFx, SoundName } from './soundfx'
import { SpatialAudio } from './spatial-audio'

export interface AudioSettings {
  parcelAudioVolume: number
  soundEffectsVolume: number
}

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
  babylonAudioEngine: BABYLON.IAudioEngine | null
  scene: BABYLON.Scene
  audioContext: AudioContext

  footstepSounds: FootstepSounds
  flySound: FlySound
  soundFx: Record<SoundName, BABYLON.Sound>

  avatarOut: GainNode

  // used by both web audio and audio tags (for echo cancellation)
  parcelAudioBus: BABYLON.SoundTrack
  soundEffectsBus: BABYLON.SoundTrack

  soundLastPlayedAt = 0 // unix timestamp

  // going live mutes parcel audio so it stays out of your broadcast
  broadcasting = false
  private preBroadcastVolumes: { parcel: number } | null = null

  constructor(scene: BABYLON.Scene) {
    if (!wantsAudio()) {
      throw new Error('Trying to create audio when not wanted')
    }

    this.babylonAudioEngine = BABYLON.Engine.audioEngine
    if (!this.babylonAudioEngine?.audioContext || !this.masterOut) {
      throw new Error('No audio engine')
    }
    this.scene = scene
    this.audioContext = this.babylonAudioEngine.audioContext
    // create audio busses
    this.parcelAudioBus = createSoundtrack(this.scene)
    this.soundEffectsBus = createSoundtrack(this.scene)

    // avatar audio
    this.avatarOut = this.audioContext.createGain()
    this.avatarOut.gain.value = 1
    this.footstepSounds = new FootstepSounds(this.avatarOut, this.scene, this.soundEffectsOut)
    this.flySound = new FlySound(this.avatarOut)

    // connect it up
    this.avatarOut.connect(this.soundEffectsOut)

    // load settings
    this.loadSettingsFromLocalStorage()

    this.soundFx = Object.entries(soundFx).reduce(
      (acc, [sound, options]) => {
        acc[sound as SoundName] = this.createSound({ name: sound, ...options })
        return acc
      },
      {} as Record<SoundName, BABYLON.Sound>,
    )
  }

  get persona(): Persona {
    return this.connector?.persona
  }

  get masterOut(): GainNode {
    return this.babylonAudioEngine!.masterGain
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

  get connector() {
    return window.connector
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
    this.parcelAudioBus.setVolume(defaultValueOfType('number', settings.parcelAudioVolume, 1))
    this.soundEffectsBus.setVolume(defaultValueOfType('number', settings.soundEffectsVolume, 1))
    const stored = window.localStorage.getItem('audioSettings')
    const prev = stored ? tryParseJson(stored) : {}
    window.localStorage.setItem('audioSettings', JSON.stringify({ ...prev, ...settings }))
  }

  getSettings(): AudioSettings {
    return {
      parcelAudioVolume: this.parcelOut.gain.value,
      soundEffectsVolume: this.soundEffectsOut.gain.value,
    }
  }

  setBroadcasting(b: boolean) {
    if (this.broadcasting === b) return
    this.broadcasting = b
    if (b) {
      this.preBroadcastVolumes = { parcel: this.parcelOut.gain.value }
      this.parcelAudioBus.setVolume(0)
    } else if (this.preBroadcastVolumes) {
      this.parcelAudioBus.setVolume(this.preBroadcastVolumes.parcel)
      this.preBroadcastVolumes = null
    }
  }

  async start(signal: AbortSignal) {
    await requestAudio(this.audioContext, signal)
    // make the spatial audio smooth and silky (JANK BE GONE!)
    this.scene.audioPositioningRefreshRate = 50
  }
}

function tryParseJson(json: string) {
  try {
    return JSON.parse(json)
  } catch (ex) {
    return null
  }
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
