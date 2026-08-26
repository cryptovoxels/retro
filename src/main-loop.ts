import FPSStats from './utils/fps-stats'
import { throttle } from 'lodash'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'
import { FeaturePump } from './pump/feature-pump'
import { cameraPosition } from './utils/camera'
import { EngineContext, SceneContext, onBeforeRender, startEngine, stopEngine } from '@babylonjs/lite'

export type LOOP_STATE = 'running' | 'paused'
export default class MainLoop extends TypedEventTarget<Record<LOOP_STATE, void>> {
  paused = false
  filter = 'blur(25px) saturate(0%) brightness(1.4)'

  scene?: SceneContext
  mapScene?: SceneContext

  constructor(
    private engine: EngineContext,
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

  setScene(scene: SceneContext) {
    this.scene = scene
  }

  unsetMapScene() {
    this.mapScene = undefined
  }

  setMapScene(scene: SceneContext) {
    this.mapScene = scene
  }

  pause() {
    stopEngine(this.engine)
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
    if (!this.scene) return

    onBeforeRender(this.scene, () => {
      FPSStats.end()

      const camera = this.scene!.activeCamera as any
      if (camera?.getForwardRay) {
        const forwardRay = camera.getForwardRay()
        this._pump.setCameraPosition(cameraPosition(this.scene!), forwardRay.direction)
      }

      this._pump.pump()
      FPSStats.begin()
    })

    if (this.mapScene) {
      onBeforeRender(this.mapScene, () => {})
    }

    void startEngine(this.engine)
    this.dispatchEvent(createEvent('running', undefined))
  }
}
