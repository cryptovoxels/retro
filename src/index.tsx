/*
 * When embedded in Opensea (or other sandboxed iframes) - we need to stub
 * a bunch of stuff that causes a SecurityException
 */

import { initializeTextureAnimation } from './textures/animation'

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
import Polytext from './features/polytext'
import { type AudioEngine } from './audio/audio-engine'
import { loadingDone, onLoadPromise } from './utils/loading-done'
import { isBatterySaver, isDebug, isInspect, isIOS, isMobile, wantsXR } from '../common/helpers/detector'
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
import LutFactor from './graphic/lut-factor'
import { ColorGrader } from './graphic/color-grading'
import { FOV } from './graphic/field-of-view'
import { Minimap, MinimapSettings } from './minimap'
import { MetaMaskInpageProvider } from '@metamask/providers'
import { currentBuildDate, currentVersion } from '../common/version'
import { CameraSettings } from './controls/user-control-settings'
import L from '../vendor/library/leaflet'
import { createGPUMemoryHUD } from './utils/memory-overlay'

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
    // leaflet
    L: typeof L

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

    engine: BABYLON.Engine
    scene: BABYLON.Scene
    config: SceneConfig
    graphic: GraphicEngine
    draw: DrawDistance
    fov: FOV
    cameraSettings: CameraSettings
    environment: Environment | undefined

    nameMesh: BABYLON.Mesh
    skyMat: BABYLON.GradientMaterial

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
  BABYLON.DebugLayer.InspectorURL = '/vendor/babylon.inspector.bundle.js'

  // Initialise user singleton
  window.user = new User()

  if (isMobile()) {
    document.ondblclick = function (e) {
      e.preventDefault()
    }
  }

  const canvas = document.createElement('canvas')
  canvas.id = 'renderCanvas'
  canvas.style.cssText = 'width: 100%; height: 100%; display: block; touch-action: none;'

  // The one canvas lives forever. The web router (web/src/parcel.tsx Client)
  // reparents it into whatever view is on screen and parks it back here when no
  // world is visible, so the WebGL context never dies between navigations.
  const holder = document.createElement('div')
  holder.id = 'world-holder'
  holder.style.cssText = 'position: fixed; left: -99999px; width: 1px; height: 1px; overflow: hidden;'
  holder.appendChild(canvas)
  document.body.appendChild(holder)

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (document.body.classList.contains('in-world')) e.preventDefault()
    },
    { passive: false },
  )

  try {
    var r = await fetch(process.env.ASSET_PATH + '/acknowtt.json')
    var font = await r.json()
    Polytext.Load()
    Polytext.setWorkerData(font)
  } catch (e) {
    console.log('Sandboxed iframe, no assets')
  }

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
  BABYLON.SceneLoader.ShowLoadingScreen = false

  // Tried by randomly exploring around origin
  BABYLON.Engine.CollisionsEpsilon = 0.001

  /**
   * First we create the main babylon engine that is global for every scene we are using
   */
  const engine = new BABYLON.Engine(
    canvas,
    false,
    {
      disableWebGL2Support: isIOS(),
      antialias: !isMobile(),
      stencil: true,
      preserveDrawingBuffer: true, // needed for screenshots (womps)
      doNotHandleContextLost: true, // we handle context lost ourselves *see below*
    },
    false,
  )
  // reload page on context lost, rather than trying to recover (which requires lots of extra memory)
  engine.onContextLostObservable.add(() => {
    console.log('context lost')
    window.confirm('WebGL context lost. Reload page?') && window.location.reload()
  })
  window.engine = engine

  // make sure the FOV changes correctly if the window gets resized
  window.addEventListener(
    'resize',
    () => {
      engine.resize()
    },
    { passive: true },
  )
  // try and reduce memory consumption by not using indexedDB
  engine.enableOfflineSupport = false

  // override enterFullscreen to use body element instead of canvas
  engine.enterFullscreen = (requestPointerLock: boolean) => {
    if (!engine.isFullscreen) {
      engine['_pointerLockRequested'] = requestPointerLock
      BABYLON.Engine._RequestFullscreen(document.body)
    }
  }

  const sceneConfig = sceneConfigFromURL()
  window.config = sceneConfig

  // the graphics engine keeps track of graphic settings and post-processing fx
  const graphic = new GraphicEngine(engine)
  window.graphic = graphic

  // keeps track of how far we should render
  const draw = new DrawDistance(graphic, sceneConfig.isSpace)
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

  // handling of the loading screen (spinning logo)
  const assetsManager = new BABYLON.AssetsManager(scene)
  assetsManager.useDefaultLoadingScreen = false
  assetsManager.load()

  // Setup player controls and the main camera and initialise the world matrix position
  const controls = CreateControls(scene, canvas)

  // start has to be called after controls (camera) are added to the scene and will
  // load the current graphic settings from the localstore
  loadingDone('ALLES')
  graphic.start()

  initializeTextureAnimation(scene)

  new DragDrop(scene)

  // not related to a parcel or space
  const { environment, regions } = await createEnvironment(scene, controls.worldOffset)
  // Give the Controls a chance to observe things in the Environment
  controls.attachEnvironment(environment)

  if (xr) {
    xr.attachEnvironment(environment)
  }

  const lutFactor = new LutFactor()
  const color = new ColorGrader(scene, lutFactor)
  regions.addEventListener('color-grading-entered', color.colorGradingEntered.bind(color))
  regions.addEventListener('color-grading-exited', color.colorGradingExited.bind(color))

  // @ts-expect-error for debug
  window._lutFactor = lutFactor
  // @ts-expect-error global for dev, makes it easy to adjust at runtime
  window._color = color

  graphic.postProcesses = new PostProcesses(scene, color, graphic)

  // now we can set up and create all those things that loads stuff, like the connector, the pump (tm) and parcel loaders, audio etc
  const { grid, connector } = await createWorld(scene, canvas, controls, environment)
  // and here we start all the main stuff, start the renderloop, the pump, web-workers and mess with some random
  // fixes for browsers

  let map: Minimap | null = null
  let mapSettings: MinimapSettings | null = null
  let mapScene: BABYLON.Scene | null = null

  // minimap is never shown on mobile (enabled getter returns false) but the constructor
  // still allocates a Scene, camera, meshes and PostProcess -- skip it entirely
  if (!isMobile()) {
    map = new Minimap(engine, connector)
    mapSettings = map.getSettings()

    if (!window.config.isBot) {
      if (mapSettings.enabled && !window.config.isOrbit && !window.config.isSpace) {
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
    main.start()
  }

  voxels.robots = new Robots(scene)
  voxels.robots.start()

  extendTabIndexOnClick()

  // <Client> renders this in its own tree, so the UI mounts with the canvas and
  // unmounts when you leave the world (instead of living on <body> forever).
  const ui: BootResult = {
    UI: UserInterface,
    props: { scene, parent: controls.worldOffset, canvas, grid, connector, environment, enabled: !wantsXR(), minimapSettings: mapSettings ?? new MinimapSettings() },
  }

  if (wantsXR()) return ui

  isInspect() && toggleBabylonInspector(scene).then(/** ignore promise */)
  // also toggle the inspector on Shift + CTRL + Meta + I
  window.addEventListener('keydown', (ev) => {
    if (ev.shiftKey && ev.ctrlKey && ev.metaKey && ev.code === 'KeyI') {
      toggleBabylonInspector(scene)
    }
  })

  return ui

  async function toggleBabylonInspector(scene: BABYLON.Scene | null) {
    // show babylonjs built in scene explorer, we need to wait until the loading spinner is gone
    // due to the inspector adds dom element that confuses things
    // https://doc.babylonjs.com/features/playground_debuglayer

    scene?.executeWhenReady(() => {
      if (scene?.debugLayer.isVisible()) {
        scene?.debugLayer.hide()
        return
      }

      // await onLoadPromise

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
