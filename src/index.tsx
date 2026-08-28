/*
 * When embedded in Opensea (or other sandboxed iframes) - we need to stub
 * a bunch of stuff that causes a SecurityException
 */

import { createEngine, EngineContext, Mesh, enableStandardVertexColors, registerScene, resizeEngine, SceneContext } from '@babylonjs/lite'

try {
  const testKey = '__test__'
  window.localStorage.setItem(testKey, '1')
  window.localStorage.removeItem(testKey)
} catch {
  console.log('[voxels] Stubbing localStorage')

  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    },
    configurable: true,
  })
}

// Continue loading...
import { toggleFPSStats } from './utils/fps-stats'

import { CreateControls, xr } from './controls/create'

import type Grid from './grid'
import { FeaturePump } from './pump/feature-pump'
import UserInterface, { UserInterfaceProps } from './user-interface'
import Connector from './connector'

// Robots (NPCs)
import Robots from './robots/robots'

// Features
import { type AudioEngine } from './audio/audio-engine'
import { isBatterySaver, isDebug, isInspect, isIOS, isMobile, wantsGateway, wantsXR } from '../common/helpers/detector'
import { DragDrop } from './tools/drag-drop'

// Patching animation with features from later babylon.js version
import './vendor/animation-patch'
import { GraphicEngine } from './graphic/graphic-engine'
import { extendTabIndexOnClick } from '../common/helpers/ui-helpers'
import { User } from './user'
import Persona from './persona'
import { Appstate } from '../web/src/state'
import { refreshMobileCanvasAfterReturn, viewportChangeHandler } from './controls/mobile/controls'
import { DrawDistance } from './graphic/draw-distance'
import MainLoop from './main-loop'
import { createScene } from './init/scene'
import { createEnvironment } from './init/environment'
import { createWorld } from './init/world'
import { sceneConfigFromURL, SceneConfig } from './scene-config'
import type { Environment } from './enviroments/environment'
import { PostProcesses } from './graphic/post-processes'
import { ColorGrader } from './graphic/color-grading'
import { FOV } from './graphic/field-of-view'
import { Minimap, MinimapSettings } from './minimap'
import { MetaMaskInpageProvider } from '@metamask/providers'
import { currentBuildDate, currentVersion } from '../common/version'
import { CameraSettings } from './controls/user-control-settings'
import { createGPUMemoryHUD } from './utils/memory-overlay'
import { initializeTextureAnimation } from './textures/animation'

if (process.env.NODE_ENV === 'development') {
  require('preact/debug')
}

console.log(`Voxels engine | v${currentVersion} | ${currentBuildDate}`)

type Voxels = {
  robots?: Robots
}

// Register of the singletons we still have bound to window
declare global {
  interface Window {
    // CV objects
    main: MainLoop | undefined
    connector: Connector
    user: User
    persona: Persona
    // marking as possibly undefined as there were instances where grid was being used before it was added to window
    grid: Grid | undefined
    ui?: UserInterface
    app: Appstate

    voxels: Voxels

    engine: EngineContext
    scene: SceneContext
    config: SceneConfig
    graphic: GraphicEngine
    draw: DrawDistance
    fov: FOV
    cameraSettings: CameraSettings
    environment: Environment | undefined

    nameMesh: Mesh
    skyMat: any

    // Settings that that might not be set - typed with | undefined to ensure that these are handled
    _audio: AudioEngine | undefined

    // Debug helpers
    toggleNightMode?: () => void

    // Provided by scripts
    Chart: any // For graphs
    moment: any // for timeseries graphs
    twttr: any
    opensea: any
    openseaTypes: any

    ethereum: MetaMaskInpageProvider
  }
}

export type BootResult = { UI: typeof UserInterface; props: UserInterfaceProps }

let bootPromise: Promise<BootResult> | null = null

// Lazy, run-once engine boot. Called by the web bundle the first time a world
// view is shown. Importing this module must have no side effects. Resolves with
// the UI component + its props so <Client> can render it in its own tree.
export function bootEngine(): Promise<BootResult> {
  if (!bootPromise) bootPromise = main()
  return bootPromise
}

async function main() {
  const voxels = (window.voxels = {} as Voxels)

  // if the inspector breaks, try downloading the correct version into `/dist/vendor` like this:
  // `wget https://unpkg.com/babylonjs-inspector@6.11.2/babylon.inspector.bundle.js`
  // todo(lite): BABYLON.DebugLayer.InspectorURL = '/vendor/babylon.inspector.bundle.js'

  // Initialise user singleton
  window.user = new User()

  if (isMobile()) {
    document.ondblclick = function (e) {
      e.preventDefault()
    }
  }

  const canvas = document.createElement('canvas')
  canvas.id = 'renderCanvas'
  canvas.style.cssText = 'width: 100%; height: 100%; display: none; touch-action: none; image-rendering: pixelated;'
  document.body.appendChild(canvas)

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (document.querySelector('.client')?.contains(canvas)) e.preventDefault()
    },
    { passive: false },
  )

  if (isDebug()) {
    toggleFPSStats()
  }

  if (isMobile()) {
    canvas.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault()
      },
      { passive: false },
    )
  }

  if (isMobile() && window.visualViewport) {
    window.visualViewport.addEventListener('resize', viewportChangeHandler)
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') refreshMobileCanvasAfterReturn()
      },
      { passive: true },
    )
    window.addEventListener('pageshow', refreshMobileCanvasAfterReturn, { passive: true })
  }

  // Don't use babylon spinner
  // todo(lite): BABYLON.SceneLoader.ShowLoadingScreen = false

  // Tried by randomly exploring around origin
  // todo(lite): BABYLON.Engine.CollisionsEpsilon = 0.001

  /**
   * First we create the main babylon engine that is global for every scene we are using
   */
  const engine = await createEngine(canvas)
  ;(engine as any).resize = () => resizeEngine(engine)
  // todo(lite): engine.onContextLostObservable - reload on device lost
  window.engine = engine

  // make sure the FOV changes correctly if the window gets resized
  window.addEventListener(
    'resize',
    () => {
      resizeEngine(engine)
    },
    { passive: true },
  )
  // todo(lite): engine.enableOfflineSupport = false
  // todo(lite): engine.enterFullscreen override

  const sceneConfig = sceneConfigFromURL()
  window.config = sceneConfig

  // the graphics engine keeps track of graphic settings and post-processing fx
  const graphic = new GraphicEngine(engine)
  window.graphic = graphic

  // keeps track of how far we should render
  const draw = new DrawDistance(graphic)
  window.draw = draw

  // keeps track of FOV settings
  const fov = new FOV()
  window.fov = fov

  const cameraSettings = new CameraSettings()
  window.cameraSettings = cameraSettings
  window.environment = undefined

  // Create a main scene and stuff it with some scene globals
  const scene = createScene(engine)
  window.scene = scene
  // task runner, that attempts to run tasks without affecting framerate

  // if (isBatterySaver()) {
  //   createGPUMemoryHUD(scene)
  // }

  const pump = new FeaturePump(scene)
  // @ts-expect-error expose pump for debugging
  window.pump = pump

  const main = new MainLoop(engine, pump)
  window.main = main
  main.setScene(scene)

  // todo(lite): BABYLON.AssetsManager preload

  const { initPhysics } = await import('./physics/world')
  await initPhysics()

  // Setup player controls and the main camera and initialise the world matrix position
  const controls = CreateControls(scene, canvas)

  // start has to be called after controls (camera) are added to the scene and will
  // load the current graphic settings from the localstore
  graphic.start()

  initializeTextureAnimation(scene)

  new DragDrop(scene)

  const color = new ColorGrader(scene)
  window._color = color

  graphic.postProcesses = new PostProcesses(scene, color, graphic)
  if (!wantsGateway()) graphic.postProcesses.cover()
  ;(engine as any).setBlur = (on: boolean) => graphic.postProcesses?.setBlur(on)
  ;(engine as any).setUnderwater = (on: boolean) => graphic.postProcesses?.setUnderwater(on)

  // not related to a parcel or space
  const { environment } = await createEnvironment(scene)
  // Give the Controls a chance to observe things in the Environment
  controls.attachEnvironment(environment)

  if (xr) {
    xr.attachEnvironment(environment)
  }

  // now we can set up and create all those things that loads stuff, like the connector, the pump (tm) and parcel loaders, audio etc
  const { grid, connector } = await createWorld(scene, canvas, controls, environment)
  // and here we start all the main stuff, start the renderloop, the pump, web-workers and mess with some random
  // fixes for browsers

  let map: Minimap | null = null
  let mapSettings: MinimapSettings | null = null
  let mapScene: SceneContext | null = null

  // minimap is never shown on mobile (enabled getter returns false) but the constructor
  // still allocates a Scene, camera, meshes and PostProcess -- skip it entirely
  // todo(lite): minimap needs Scene/camera stub
  if (!isMobile() && false) {
    map = new Minimap(engine, connector)
    mapSettings = map.getSettings()

    if (!window.config.isBot) {
      if (mapSettings.enabled) {
        mapScene = map.start(scene)
        main.setMapScene(mapScene)
      }
    }

    mapSettings.addEventListener('changed', (state) => {
      if (state.detail.enabled && !state.detail.hide) {
        mapScene = map!.start(scene)
        main.setMapScene(mapScene)
      } else {
        map!.stop()
        if (mapScene) {
          main.unsetMapScene()
          mapScene.dispose()
          mapScene = null
        }
      }
    })
  }

  if (!window.config.isBot) {
    enableStandardVertexColors()
    await registerScene(scene)
    main.start()
  }

  voxels.robots = new Robots(scene)
  voxels.robots.start()

  extendTabIndexOnClick()

  // <Client> renders this in its own tree, so the UI mounts with the canvas and
  // unmounts when you leave the world (instead of living on <body> forever).
  const ui: BootResult = {
    UI: UserInterface,
    props: { scene, canvas, grid, connector, environment, enabled: !wantsXR() && !wantsGateway(), minimapSettings: mapSettings ?? new MinimapSettings() },
  }

  if (wantsXR()) return ui

  // isInspect() && toggleBabylonInspector(scene).then(/** ignore promise */)
  // // also toggle the inspector on Shift + CTRL + Meta + I
  // window.addEventListener('keydown', (ev) => {
  //   if (ev.shiftKey && ev.ctrlKey && ev.metaKey && ev.code === 'KeyI') {
  //     toggleBabylonInspector(scene)
  //   }
  // })

  return ui

  async function toggleBabylonInspector(scene: SceneContext | null) {
    // show babylonjs built in scene explorer
    // https://doc.babylonjs.com/features/playground_debuglayer

    scene?.executeWhenReady(() => {
      if (scene?.debugLayer.isVisible()) {
        scene?.debugLayer.hide()
        return
      }

      scene?.debugLayer.show({
        overlay: false,
        enablePopup: true,
        globalRoot: document.getElementsByTagName('body')[0],
        showExplorer: true,
        showInspector: true,
        embedMode: true,
        handleResize: false,
        // initialTab: BABYLON.DebugLayerTab.Statistics,
      })
    })
  }
}
