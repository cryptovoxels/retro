import FPSStats from './utils/fps-stats'
import { throttle } from 'lodash'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'
import { WorldStream } from './world-stream'
import { Renderer } from './render/renderer'
import { isOculusQuest } from '../common/helpers/detector'

export type LOOP_STATE = 'running' | 'paused'
export default class MainLoop extends TypedEventTarget<Record<LOOP_STATE, void>> {
  paused = false
  running = false
  filter = isOculusQuest() ? 'none' : 'blur(25px) saturate(0%) brightness(1.4)'

  renderer?: Renderer
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
    if (new URLSearchParams(location.search).get('render') === 'ng') this.renderer = new Renderer(scene)
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

        if (this.renderer && this.scene) {
          this.renderer.render()
          this.renderer.sync(this.scene, { budget: 5 })
        } else this.scene?.render()
        this.mapScene?.render()

        FPSStats.begin()
      } catch (err) {
        this.logFrameError(err)
      }
    })

    this.dispatchEvent(createEvent('running', undefined))
  }
}
