import { isSafari } from '../../common/helpers/detector'
import { createWearableScene } from './helpers/scenes'
import voxImport from '../../common/vox-import/sync-vox-import'

import { loadWearableVox } from './helpers/wearable-helpers'

export class WearableViewer {
  private readonly canvas: HTMLCanvasElement
  private scene?: BABYLON.Scene

  private activeMesh?: BABYLON.Mesh

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  resizeHandler = () => this.scene?.getEngine().resize()

  dispose() {
    window.removeEventListener('resize', this.resizeHandler.bind(this))
    this.scene?.dispose()
    this.scene?.getEngine().dispose()
  }

  async loadURL(url: string) {
    if (!this.canvas) {
      alert('No canvas')
      return
    }

    const { scene } = createWearableScene(this.canvas)
    this.scene = scene

    window.addEventListener('resize', this.resizeHandler.bind(this), { passive: true })

    this.scene?.getEngine().runRenderLoop(() => this.scene?.render())
    this.activeMesh?.dispose(false, true)
    this.activeMesh = await voxImport(url, this.scene)
  }
}
