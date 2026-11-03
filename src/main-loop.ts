import FPSStats from './utils/fps-stats'
import { throttle } from 'lodash'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'
import { WorldStream } from './world-stream'

export type LOOP_STATE = 'running' | 'paused'
export default class MainLoop extends TypedEventTarget<Record<LOOP_STATE, void>> {
  paused = false
  running = false
  filter = 'blur(25px) saturate(0%) brightness(1.4)'

  scene?: BABYLON.Scene
  mapScene?: BABYLON.Scene

  constructor(
    private engine: BABYLON.Engine,
    readonly stream: WorldStream,
  ) {
    super()
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
    this.running = false
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

  // an exception escaping the render callback stops Babylon from queueing the next frame: the world freezes
  private logFrameError = throttle((err: unknown) => console.error('render loop error', err), 5000, { leading: true, trailing: false })

  start() {
    this.running = true
    this.engine.runRenderLoop(() => {
      try {
        FPSStats.end()

        this.scene?.render()
        this.mapScene?.render()

        FPSStats.begin()
      } catch (err) {
        this.logFrameError(err)
      }
    })

    this.dispatchEvent(createEvent('running', undefined))
  }
}
