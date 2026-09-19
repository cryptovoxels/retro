import { isMobile } from '../../../common/helpers/detector'

export const createWearableScene = (canvasOrContext: BABYLON.Nullable<HTMLCanvasElement | OffscreenCanvas | WebGLRenderingContext | WebGL2RenderingContext>) => {
  const engine = new BABYLON.Engine(canvasOrContext)
  const scene = new BABYLON.Scene(engine)
  scene.clearColor.set(1, 0, 0.6, 1)

  const background = new BABYLON.Scene(engine)
  background.createDefaultCamera()

  const camera = new BABYLON.ArcRotateCamera('wearable-camera', Math.PI / 2, Math.PI / 3, 1, new BABYLON.Vector3(0, 0, 0), scene)
  camera.lowerRadiusLimit = camera.upperRadiusLimit = camera.radius
  camera.minZ = 0.01
  camera.useAutoRotationBehavior = true
  if (camera.autoRotationBehavior) {
    camera.autoRotationBehavior.idleRotationSpeed = 0.75
  }
  camera.attachControl(canvasOrContext, true)

  createRingLight(scene, camera)

  scene.setActiveCameraByName('wearable-camera')

  return { engine, scene, background }
}

export const resizeWatcher = (window: Window, engine: BABYLON.Engine) => {
  window.addEventListener('resize', () => engine?.resize(), { passive: true })
}

export function setupGizmos(scene: BABYLON.Scene, onDragEnd: () => void) {
  const gizmoManager = new BABYLON.GizmoManager(scene, 3.5)
  gizmoManager.positionGizmoEnabled = true
  gizmoManager.rotationGizmoEnabled = true
  gizmoManager.scaleGizmoEnabled = false
  gizmoManager.boundingBoxGizmoEnabled = true
  gizmoManager.usePointerToAttachGizmos = false

  // Handle all the drag events gizmos support
  if (!gizmoManager.gizmos.positionGizmo || !gizmoManager.gizmos.rotationGizmo) {
    throw new Error('gizmos not found')
  }
  gizmoManager.gizmos.positionGizmo.xGizmo.dragBehavior.onDragEndObservable.add(onDragEnd)
  gizmoManager.gizmos.positionGizmo.yGizmo.dragBehavior.onDragEndObservable.add(onDragEnd)
  gizmoManager.gizmos.positionGizmo.zGizmo.dragBehavior.onDragEndObservable.add(onDragEnd)
  gizmoManager.gizmos.positionGizmo.scaleRatio = 0.8

  gizmoManager.gizmos.rotationGizmo.xGizmo.dragBehavior.onDragEndObservable.add(onDragEnd)
  gizmoManager.gizmos.rotationGizmo.yGizmo.dragBehavior.onDragEndObservable.add(onDragEnd)
  gizmoManager.gizmos.rotationGizmo.zGizmo.dragBehavior.onDragEndObservable.add(onDragEnd)
  gizmoManager.gizmos.rotationGizmo.scaleRatio = 0.6
  gizmoManager.gizmos.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false

  if (gizmoManager.gizmos.boundingBoxGizmo) {
    gizmoManager.gizmos.boundingBoxGizmo.scaleRatio = 0.8
    gizmoManager.gizmos.boundingBoxGizmo.scaleBoxSize = 0.03
    gizmoManager.gizmos.boundingBoxGizmo.rotationSphereSize = 0
    gizmoManager.gizmos.boundingBoxGizmo.onScaleBoxDragEndObservable.add(onDragEnd)
  }

  const positionGizmo = document.getElementById('gizmo-position')
  if (!positionGizmo) {
    throw new Error('positionGizmo not found')
  }

  positionGizmo.addEventListener('click', () => {
    gizmoManager.positionGizmoEnabled = true
    gizmoManager.rotationGizmoEnabled = false
    gizmoManager.boundingBoxGizmoEnabled = false
  })

  const rotationGizmo = document.getElementById('gizmo-rotation')

  if (!rotationGizmo) {
    throw new Error('rotationGizmo not found')
  }

  rotationGizmo.addEventListener('click', () => {
    gizmoManager.positionGizmoEnabled = false
    gizmoManager.rotationGizmoEnabled = true
    gizmoManager.boundingBoxGizmoEnabled = false
  })

  const scaleGizmo = document.getElementById('gizmo-scale')

  if (!scaleGizmo) {
    throw new Error('scaleGizmo not found')
  }

  scaleGizmo.addEventListener('click', () => {
    gizmoManager.positionGizmoEnabled = false
    gizmoManager.rotationGizmoEnabled = false
    gizmoManager.boundingBoxGizmoEnabled = true
  })

  gizmoManager.positionGizmoEnabled = true
  gizmoManager.rotationGizmoEnabled = false
  gizmoManager.boundingBoxGizmoEnabled = false

  return gizmoManager
}

export function createRingLight(scene: BABYLON.Scene, camera: BABYLON.Camera) {
  const ring = new BABYLON.TransformNode('ring', scene)
  ring.setParent(camera)
  ring.position.z = -5

  const red = new BABYLON.PointLight('redLight', new BABYLON.Vector3(0, 10, 0), scene)
  red.diffuse = blackbody(2700)
  red.specular = blackbody(3500)
  red.parent = ring

  const green = new BABYLON.PointLight('greenLight', new BABYLON.Vector3(8.66, -5, 0), scene)
  green.diffuse = blackbody(2500)
  green.specular.set(0, 0, 0)
  green.intensity = 0.2
  green.parent = ring

  const blue = new BABYLON.PointLight('blueLight', new BABYLON.Vector3(-8.66, -5, 0), scene)
  blue.diffuse = blackbody(3000)
  blue.specular.set(0, 0, 0)
  blue.intensity = 0.2
  blue.parent = ring

  // Animate the ring
  const anim = new BABYLON.Animation('lightRing', 'rotation.z', 30, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE)

  const keys = [
    { frame: 0, value: 0 },
    { frame: 300, value: 2 * Math.PI },
  ]

  anim.setKeys(keys)
  ring.animations = [anim]

  scene.beginAnimation(ring, 0, 300, true)
}

export const blackbody = (kelvin: number) => {
  const t = kelvin / 100
  let r = 255
  let g = 255
  let b = 255
  if (t > 66) {
    r = 329.698727446 * (t - 60) ** -0.1332047592
    g = 288.1221695283 * (t - 60) ** -0.0755148492
  } else {
    g = 99.4708025861 * Math.log(t) - 161.1195681661
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  }
  const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return BABYLON.Color3.FromInts(byte(r), byte(g), byte(b))
}

export function setupScene(canvas: HTMLCanvasElement, engine: BABYLON.Engine, onClick?: (mesh: BABYLON.AbstractMesh | undefined) => void): BABYLON.Scene {
  BABYLON.Effect.ShadersStore['WobbleFragmentShader'] = `
    precision highp float;

    uniform float iTime;
    in vec2 vUV;
    
    void main() { 
      vec2 uv = vUV;
      uv.x += sin(iTime) * uv.y;
      uv.y += cos(iTime) * uv.x;

      float d = length(uv) * 0.25;

      gl_FragColor = vec4(uv.x, uv.y, 0.5, 1.0); 
    }
   `

  const scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color4(1, 1, 1, 1)

  if (onClick) {
    const pointerDown = new BABYLON.Vector2()
    let pointerMoved = false

    scene.onPointerObservable.add(
      (evt) => {
        switch (evt.type) {
          case BABYLON.PointerEventTypes.POINTERDOWN:
            pointerMoved = false
            pointerDown.set(evt.event.clientX, evt.event.clientY)
            break

          case BABYLON.PointerEventTypes.POINTERUP:
            if (pointerMoved || evt.event.button != 0) {
              return
            }

            onClick((evt.pickInfo?.hit && evt.pickInfo.pickedMesh) || undefined)
            break

          case BABYLON.PointerEventTypes.POINTERMOVE:
            if (pointerMoved) {
              break
            }

            const i = pointerDown.subtract(new BABYLON.Vector2(evt.event.clientX, evt.event.clientY)).length()

            // more than 8 pixels
            if (i > 8) {
              pointerMoved = true
            }

            break
        }
      },
      BABYLON.PointerEventTypes.POINTERDOWN + BABYLON.PointerEventTypes.POINTERUP + BABYLON.PointerEventTypes.POINTERMOVE,
    )
  }

  // Camera
  const camera = new BABYLON.ArcRotateCamera('Camera', -1.57, 1.4, 2.4, new BABYLON.Vector3(0, 1, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 0.5
  camera.upperRadiusLimit = 8
  camera.wheelPrecision = 30
  camera.panningInertia = 0
  camera.panningSensibility = 350
  camera.inertialRadiusOffset = 0
  camera.minZ = 0.003

  createRingLight(scene, camera)

  const hl = new BABYLON.HighlightLayer('selected', scene, { isStroke: true })
  hl.innerGlow = false
  hl.outerGlow = true

  const size = 0.2
  hl.blurHorizontalSize = size
  hl.blurVerticalSize = size

  return scene
}

export const pending = (f: (e: Event) => Promise<void>) => {
  // Returns a function that disables the clicked element until the async function f returns

  return async (e: Event) => {
    const el = e.target as HTMLButtonElement

    if (el.nodeName == 'A' && el.getAttribute('href') == '#') {
      e.preventDefault()
    }
    if (el.nodeName === 'BUTTON') {
      e.preventDefault() // required for firefox, buttons seem to navigate by default
    }

    const costumer = document.querySelector<HTMLDivElement>('div.costumer')
    if (!costumer) {
      console.warn('No costumer div found')
    } else {
      costumer.style.pointerEvents = 'not-allowed'
    }

    el.disabled = true
    el.classList.add('pending')

    await Promise.resolve(f(e))

    el.disabled = false
    el.classList.remove('pending')

    if (costumer) costumer.style.pointerEvents = 'auto'
  }
}
