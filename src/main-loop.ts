import FPSStats from './utils/fps-stats'
import { throttle } from 'lodash'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'
import { FeaturePump } from './pump/feature-pump'
import { cameraPosition } from './utils/camera'

export type LOOP_STATE = 'running' | 'paused'
export default class MainLoop extends TypedEventTarget<Record<LOOP_STATE, void>> {
  paused = false
  filter = 'blur(25px) saturate(0%) brightness(1.4)'

  scene?: BABYLON.Scene
  mapScene?: BABYLON.Scene

  constructor(
    private engine: BABYLON.Engine,
    private _pump: FeaturePump,
  ) {
    super()
  }

  get pump() {
    return this._pump
  }

  private get canvas() {
    return document.querySelector('canvas#renderCanvas') as unknown as HTMLCanvasElement
  }

  setScene(scene: BABYLON.Scene) {
    this.scene = scene
  }

  unsetMapScene() {
    this.mapScene = undefined
  }

  setMapScene(scene: BABYLON.Scene) {
    this.mapScene = scene
  }

  pause() {
    this.engine.stopRenderLoop()
    this.paused = true

    this.canvas.style.filter = this.filter
    this.dispatchEvent(createEvent('paused', undefined))
  }

  resume() {
    if (!this.paused) {
      return
    }

    this.paused = false

    this.canvas.style.filter = ''

    this.start()
  }

  start() {
    this.engine.runRenderLoop(() => {
      FPSStats.end()

      if (this.scene?.activeCamera) {
        const camera = this.scene.activeCamera
        const forwardRay = camera.getForwardRay()
        this._pump.setCameraPosition(cameraPosition(this.scene), forwardRay.direction)
      }

      this.scene?.render()
      this.mapScene?.render()

      this._pump.pump()
      FPSStats.begin()
    })

    this.dispatchEvent(createEvent('running', undefined))
  }
}
