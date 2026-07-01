import { isBatterySaver } from '../../common/helpers/detector'
import { VoxelSize } from '../../common/voxels/mesher'
import { loadSample } from '../utils/helpers'
import { SpatialAudio } from './spatial-audio'

const WALK_DELAY = 490
const RUN_DELAY = 300

export class FootstepSounds {
  destination: AudioNode
  scene: BABYLON.Scene | null
  effectsOut: GainNode | null
  footStepsSupported: boolean
  lastStepAt: number = Date.now()
  audioContext: AudioContext
  stepTimeout?: any
  footstepsSprite: AudioBuffer
  _stepLoop: () => void

  constructor(destination: AudioNode, scene?: BABYLON.Scene, effectsOut?: GainNode) {
    this.destination = destination
    this.scene = scene ?? null
    this.effectsOut = effectsOut ?? null
    this.audioContext = this.destination.context as AudioContext

    this.footstepsSprite = null!

    this._stepLoop = () => {
      // Will be overridden by setStepLoop when walking/running starts
    }
    // weird hack for Edge v12 (ask Marcus)
    // see https://github.com/cryptovoxels/cryptovoxels/pull/230
    this.footStepsSupported = !!this.audioContext.createMediaStreamDestination
    if (isBatterySaver()) {
      return
    }
    loadSample(this.audioContext, process.env.SOUNDS_URL + '/avatar/footsteps.wav').then((buffer) => {
      if (buffer) {
        this.footstepsSprite = buffer
      }
    })
  }

  walk() {
    this.setStepLoop(false)
  }

  running() {
    this.setStepLoop(true)
  }

  noStep() {
    clearTimeout(this.stepTimeout)
  }

  playSpatialStep(absolutePosition: BABYLON.Vector3, isRunning: boolean) {
    if (!this.footStepsSupported || !this.footstepsSprite || !this.scene || !this.effectsOut) return
    this.playStep(isRunning, absolutePosition)
  }

  hitGround(fallenHeight: any) {
    if (!this.footStepsSupported || !this.footstepsSprite) return

    // sets a max height to 3 to cap the noise it fall will make
    fallenHeight = Math.min(fallenHeight, 3)

    // don't make sound if fallen height is less than one block
    if (fallenHeight < VoxelSize) return

    // debounce footsteps
    if (Date.now() - this.lastStepAt < RUN_DELAY) return
    this.lastStepAt = Date.now()

    const offset1 = Math.floor(Math.random() * 3)
    const offset2 = Math.floor(Math.random() * 2)

    const step1 = this.audioContext.createBufferSource()
    step1.buffer = this.footstepsSprite
    step1.start(this.audioContext.currentTime, offset1 * 0.5, 0.5)
    step1.playbackRate.value = Math.random() * 0.1 + 0.9

    const filter = this.audioContext.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 400 + fallenHeight * 500

    const level = this.audioContext.createGain()
    const clampedFall = Math.min(fallenHeight, 10)
    level.gain.value = 0.2 + (clampedFall / 10) * (clampedFall / 10) * 2
    step1.connect(level)

    const step2 = this.audioContext.createBufferSource()
    step2.buffer = this.footstepsSprite
    step2.start(this.audioContext.currentTime + Math.random() * 0.01 + 0.01, offset2 * 0.5 + 1.5, 0.5)
    step2.playbackRate.value = Math.random() * 0.1 + 0.9
    step2.connect(level)

    level.connect(filter).connect(this.destination)
  }

  private setStepLoop(isRunning: boolean) {
    clearTimeout(this.stepTimeout)
    this._stepLoop = () => {
      this.playStep(isRunning)
      clearTimeout(this.stepTimeout)
      this.stepTimeout = setTimeout(this._stepLoop, isRunning ? RUN_DELAY : WALK_DELAY)
    }
    this._stepLoop()
  }

  private playStep(isRunning: boolean, absolutePosition?: BABYLON.Vector3) {
    if (!this.footStepsSupported || !this.footstepsSprite) return

    // debounce local footsteps only
    if (!absolutePosition) {
      if (Date.now() - this.lastStepAt < RUN_DELAY) return
      this.lastStepAt = Date.now()
    }

    const offset1 = Math.floor(Math.random() * 4)
    const offset2 = Math.floor(Math.random() * 4)

    const step1 = this.audioContext.createBufferSource()
    step1.buffer = this.footstepsSprite
    step1.start(this.audioContext.currentTime, offset1 * 0.5, 0.5)
    step1.playbackRate.value = Math.random() * 0.1 + 0.9

    const filter = this.audioContext.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 300 + Math.random() * 200

    const level = this.audioContext.createGain()
    level.gain.value = 0.15
    step1.connect(level)

    if (!isRunning) {
      const step2 = this.audioContext.createBufferSource()
      const level2 = this.audioContext.createGain()
      level2.gain.value = 0.4 + Math.random() * 0.1

      step2.buffer = this.footstepsSprite
      step2.start(this.audioContext.currentTime + Math.random() * 0.01, offset2 * 0.5, 0.5)
      step2.playbackRate.value = Math.random() * 0.3 + 0.8
      step2.connect(level2).connect(level)
    }

    if (Math.random() > 0.7) {
      const step3 = this.audioContext.createBufferSource()
      step3.buffer = this.footstepsSprite
      step3.start(this.audioContext.currentTime + Math.random() * 0.05 + 0.02, 2, 0.5)
      step3.playbackRate.value = Math.random() * 0.3 + 0.8
      step3.connect(level)
    }

    if (absolutePosition && this.scene && this.effectsOut) {
      level.connect(filter)
      const spatial = new SpatialAudio('avatar/footstep', this.scene, level, absolutePosition.clone())
      spatial.rolloffFactor = 2
      spatial.output.connect(this.effectsOut)
      setTimeout(() => spatial.dispose(), 600)
    } else {
      level.connect(filter).connect(this.destination)
    }
  }
}
