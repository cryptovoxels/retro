import { SceneContext, Vec3 } from '@babylonjs/lite'
/**
 * Note that spatial audio is positioned using absolute coordinates, and need to be updated when the world-offset is
 * changed
 */
export class SpatialAudio {
  audioNode: AudioNode
  output: GainNode
  soundPanner: PannerNode

  constructor(name: string, scene: SceneContext, audioNode: AudioNode, absolutePosition: Vec3) {
    this.audioNode = audioNode
    this.soundPanner = this.audioContext!.createPanner()
    this.soundPanner.channelCount = 2
    this.output = this.audioContext!.createGain()
    this.audioNode.connect(this.soundPanner)
    this.soundPanner.connect(this.output)
    this.soundPanner.panningModel = 'HRTF'
    this.soundPanner.distanceModel = 'exponential'
    this.soundPanner.rolloffFactor = 1
    this.soundPanner.maxDistance = 100
    this.soundPanner.refDistance = 1

    // setPosition is deprecated but it is what Babylon spatial sound uses
    this.soundPanner.setPosition(absolutePosition.x, absolutePosition.y, absolutePosition.z)
  }

  _volume = 1

  get volume() {
    return this._volume
  }

  set volume(value) {
    this._volume = value
    this.output.gain.value = value
  }

  get audioContext() {
    return (undefined as any /* todo(lite): BABYLON.Engine.audioEngine?.audioContext */)
  }

  get rolloffFactor() {
    return this.soundPanner.rolloffFactor
  }

  set rolloffFactor(value: number) {
    this.soundPanner.rolloffFactor = value
  }

  setPosition(absolutePosition: Vec3, timeConstant = 0.1) {
    if (this.soundPanner && this.audioContext) {
      this.soundPanner.positionX.setTargetAtTime(absolutePosition.x, this.audioContext.currentTime, timeConstant)
      this.soundPanner.positionY.setTargetAtTime(absolutePosition.y, this.audioContext.currentTime, timeConstant)
      this.soundPanner.positionZ.setTargetAtTime(absolutePosition.z, this.audioContext.currentTime, timeConstant)
    }
  }

  fadeIn(timeConstant: number, fromZero: boolean) {
    if (fromZero) {
      this.output.gain.setValueAtTime(0.0000001, this.audioContext!.currentTime)
    }
    this.output.gain.setTargetAtTime(this.volume, this.audioContext!.currentTime, timeConstant)
  }

  fadeOut(timeConstant: number) {
    this.output.gain.setTargetAtTime(0, this.audioContext!.currentTime, timeConstant)
  }

  dispose() {
    if (this.soundPanner) {
      this.audioNode.disconnect(this.soundPanner)
      this.soundPanner.disconnect()
      this.output.disconnect()
      this.soundPanner = null!
      this.audioNode = null!
      this.output = null!
    }
  }
}
