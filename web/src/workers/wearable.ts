import { createWearableScene } from '../helpers/scenes'
import { loadWearableVox } from '../helpers/wearable-helpers'

// we have to use require here to ensure the proper loading of modules, otherwise there will be a "BABYLON undefined error"
require('./babylon')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { VoxImporter } = require('../../../common/vox-import/vox-import')

let activeMesh: BABYLON.Mesh | undefined

self.addEventListener('message', (ev) => {
  if (ev.origin && !ev.origin.includes('voxels')) {
    return
  }

  const canvas = ev.data.canvas
  if (canvas) {
    dispose()
    createScene(canvas)
  }

  const hash = ev.data.hash
  if (hash && workerScene && abortController) {
    abortController.abort('ABORT: wearable hash swap')
    abortController = new AbortController()
    activeMesh?.dispose(false, true)
    loadWearableVox(importer, process.env.ASSET_PATH + `/w/${hash}/vox`, workerScene, abortController).then((mesh) => {
      activeMesh = mesh
    })
  }

  const url = ev.data.url
  if (url && workerScene && abortController) {
    abortController.abort('ABORT: wearable url swap')
    abortController = new AbortController()
    activeMesh?.dispose(false, true)
    loadWearableVox(importer, url, workerScene, abortController).then((mesh) => {
      activeMesh = mesh
    })
  }

  if (ev.data.dispose) {
    dispose()
    self.close()
  }
})

let workerEngine: BABYLON.Engine | null = null
let workerScene: BABYLON.Scene | null = null
let importer: typeof VoxImporter | undefined
let abortController: AbortController | undefined

const createScene = (canvas: BABYLON.Nullable<HTMLCanvasElement | OffscreenCanvas | WebGLRenderingContext | WebGL2RenderingContext>) => {
  const { engine, scene, background } = createWearableScene(canvas)
  workerScene = scene
  workerEngine = engine
  abortController = new AbortController()
  importer = new VoxImporter()
  importer.initialize(scene)
  workerEngine.runRenderLoop(() => {
    background?.render()
    workerScene?.render()
  })
}

const dispose = () => {
  abortController?.abort('ABORT: disposing wearable worker')
  importer = undefined
  workerScene?.dispose()
  workerEngine?.dispose()
  abortController = undefined
}
