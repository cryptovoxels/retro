import { isBatterySaver } from '../../common/helpers/detector'
import { loadSample } from '../utils/helpers'
import { SpatialAudio } from './spatial-audio'

export class FlySound {
  destination: AudioNode
  audioContext: AudioContext
  buffer: AudioBuffer | null = null
  source: AudioBufferSourceNode | null = null
  gain: GainNode

  constructor(destination: AudioNode) {
    this.destination = destination
    this.audioContext = destination.context as AudioContext
    this.gain = this.audioContext.createGain()
    this.gain.gain.value = 0.4
    this.gain.connect(destination)
    if (isBatterySaver()) return
    loadSample(this.audioContext, process.env.SOUNDS_URL + '/avatar/fly.wav').then((buffer) => {
      if (buffer) this.buffer = buffer
    })
  }

  start() {
    if (!this.buffer || this.source) return
    this.source = this.audioContext.createBufferSource()
    this.source.buffer = this.buffer
    this.source.loop = true
    this.source.connect(this.gain)
    this.source.start()
  }

  stop() {
    if (!this.source) return
    try {
      this.source.stop()
    } catch {}
    this.source.disconnect()
    this.source = null
  }
}

export class RemoteFlySound {
  scene: BABYLON.Scene
  effectsOut: GainNode
  audioContext: AudioContext
  buffer: AudioBuffer | null
  source: AudioBufferSourceNode | null = null
  gain: GainNode
  spatial: SpatialAudio | null = null

  constructor(scene: BABYLON.Scene, effectsOut: GainNode, buffer: AudioBuffer | null) {
    this.scene = scene
    this.effectsOut = effectsOut
    this.audioContext = effectsOut.context as AudioContext
    this.buffer = buffer
    this.gain = this.audioContext.createGain()
    this.gain.gain.value = 0.4
  }

  start(absolutePosition: BABYLON.Vector3) {
    if (!this.buffer) return
    if (!this.spatial) {
      this.spatial = new SpatialAudio('avatar/fly', this.scene, this.gain, absolutePosition.clone())
      this.spatial.rolloffFactor = 2
      this.spatial.output.connect(this.effectsOut)
    } else {
      this.spatial.setPosition(absolutePosition)
    }
    if (this.source) return
    this.source = this.audioContext.createBufferSource()
    this.source.buffer = this.buffer
    this.source.loop = true
    this.source.connect(this.gain)
    this.source.start()
  }

  setPosition(absolutePosition: BABYLON.Vector3) {
    this.spatial?.setPosition(absolutePosition)
  }

  get playing() {
    return !!this.source
  }

  stop() {
    if (this.source) {
      try {
        this.source.stop()
      } catch {}
      this.source.disconnect()
      this.source = null
    }
    this.spatial?.dispose()
    this.spatial = null
  }

  dispose() {
    this.stop()
  }
}
