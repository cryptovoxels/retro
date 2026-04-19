import * as ct from 'color-temperature'

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
  red.diffuse.set(1, 1, 1) // = blackbody(2700)
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

export const blackbody = (temperature: number) => {
  const rgb = ct.colorTemperature2rgb(temperature)
  return BABYLON.Color3.FromInts(rgb.red, rgb.green, rgb.blue)
}

let costumerVoidShaderRegistered = false

/** Full-canvas sky for costumer (replaces scratchpad-style Wobble). */
export function registerCostumerVoidBackground(): void {
  if (costumerVoidShaderRegistered) {
    return
  }
  costumerVoidShaderRegistered = true

  BABYLON.Effect.ShadersStore['CostumerVoidFragmentShader'] = `
precision highp float;
uniform float iTime;
in vec2 vUV;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    v += a * noise(p);
    p *= 2.1;
    a *= 0.52;
  }
  return v;
}

void main(void) {
  vec2 uv = vUV;
  float t = iTime * 0.05;

  float gy = uv.y;
  vec3 skyLo = vec3(0.97, 0.98, 0.995);
  vec3 skyMid = vec3(0.93, 0.95, 0.99);
  vec3 skyHi = vec3(0.87, 0.91, 0.98);
  float band = smoothstep(0.0, 0.55, gy);
  float band2 = smoothstep(0.45, 1.0, gy);
  vec3 base = mix(skyLo, skyMid, band);
  base = mix(base, skyHi, band2 * 0.85);

  float horizonGlow = exp(-pow((gy - 0.38) * 10.0, 2.0)) * 0.07;
  base += vec3(0.75, 0.88, 1.0) * horizonGlow;

  vec2 c1 = uv * vec2(1.85, 0.48) + vec2(t * 0.035, t * 0.011);
  float n1 = fbm(c1 + vec2(2.0, 8.0));
  float n1b = fbm(c1 * 1.28 + vec2(-40.0, 2.0));
  float clouds1 = smoothstep(0.42, 0.82, n1 * 0.55 + n1b * 0.5);
  clouds1 *= smoothstep(0.2, 0.46, gy) * (1.0 - smoothstep(0.84, 1.0, gy));

  vec3 pink = vec3(1.0, 0.94, 0.97);
  vec3 mint = vec3(0.9, 0.97, 0.98);
  vec3 lilac = vec3(0.93, 0.9, 1.0);
  vec3 ccol = mix(mix(pink, mint, n1), lilac, n1b * 0.45);
  vec3 col = base + ccol * clouds1 * 0.52;

  vec2 c2 = uv * vec2(2.35, 0.62) + vec2(-t * 0.022, t * 0.016);
  float n2 = fbm(c2 * 1.18 + 90.0);
  float clouds2 = smoothstep(0.52, 0.88, n2) * smoothstep(0.3, 0.56, gy) * 0.2;
  col += mix(mint * 0.55, lilac * 0.48, n2) * clouds2;

  gl_FragColor = vec4(col, 1.0);
}
`
}

export function setupScene(canvas: HTMLCanvasElement, engine: BABYLON.Engine, onClick?: (mesh: BABYLON.AbstractMesh | undefined) => void): BABYLON.Scene {
  const scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 0)

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
  const camera = new BABYLON.ArcRotateCamera('Camera', -1.57, 1.4, 2.8, new BABYLON.Vector3(0, 1, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 0.5
  camera.upperRadiusLimit = 8
  camera.wheelPrecision = 30
  camera.panningInertia = 0
  camera.panningSensibility = 350
  camera.inertialRadiusOffset = 0
  camera.minZ = 0.003

  createRingLight(scene, camera)

  scene.fogEnabled = true
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2
  scene.fogColor = new BABYLON.Color3(1, 1, 1)
  scene.fogStart = 22
  scene.fogEnd = 50

  const hl = new BABYLON.HighlightLayer('selected', scene, { isStroke: true })
  hl.innerGlow = false
  hl.outerGlow = true

  const size = 0.2
  hl.blurHorizontalSize = size
  hl.blurVerticalSize = size

  addCostumerGround(scene)

  return scene
}

/** Infinite-ish studio floor; same tile density idea as scratchpad (128 plane, 1024 repeats). */
function addCostumerGround(scene: BABYLON.Scene): void {
  if (scene.getMeshByName('costumer/ground')) {
    return
  }

  const planeSize = 64
  const ground = BABYLON.MeshBuilder.CreateGround('costumer/ground', { width: planeSize, height: planeSize, subdivisions: 2 }, scene)
  ground.position.y = 0
  ground.isPickable = false

  const tex = new BABYLON.Texture('/textures/grid.png', scene)
  // const tileRepeats = Math.round(1024 * (planeSize / 128))
  tex.uScale = 256
  tex.vScale = 256
  tex.uOffset = 0.5
  tex.vOffset = 0.5

  const mat = new BABYLON.StandardMaterial('costumer/ground-mat', scene)
  mat.disableLighting = true
  mat.diffuseTexture = tex
  mat.emissiveColor = new BABYLON.Color3(0.9, 0.9, 0.9)
  mat.diffuseColor.set(1, 1, 1)
  mat.specularColor.set(0, 0, 0)
  mat.zOffset = -1

  ground.material = mat
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

    el.disabled = true
    // el.classList.add('pending')

    await Promise.resolve(f(e))

    el.disabled = false
    // el.classList.remove('pending')
  }
}
