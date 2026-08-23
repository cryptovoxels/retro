export const XRAY_MASK = 0x10000000

const meshes: BABYLON.AbstractMesh[] = []

let rtt: BABYLON.RenderTargetTexture | null = null
let xrayCam: BABYLON.FreeCamera | null = null
let quad: BABYLON.Mesh | null = null

export function registerXray(mesh: BABYLON.AbstractMesh) {
  if (meshes.includes(mesh)) return
  meshes.push(mesh)
  if (rtt) rtt.renderList = meshes
}

export function unregisterXray(mesh: BABYLON.AbstractMesh) {
  const i = meshes.indexOf(mesh)
  if (i < 0) return
  meshes.splice(i, 1)
  if (rtt) rtt.renderList = meshes
}

export function startXray(scene: BABYLON.Scene) {
  if (rtt) return

  scene.setRenderingAutoClearDepthStencil(2, false, false, false)
  scene.setRenderingAutoClearDepthStencil(3, false, false, false)

  xrayCam = new BABYLON.FreeCamera('xrayCam', BABYLON.Vector3.Zero(), scene)
  xrayCam.layerMask = XRAY_MASK
  xrayCam.minZ = 0.1
  xrayCam.maxZ = 10000
  xrayCam.fov = 1

  rtt = new BABYLON.RenderTargetTexture('xrayMask', { ratio: 0.25 }, scene, false)
  rtt.clearColor = new BABYLON.Color4(0, 0, 0, 1)
  rtt.activeCamera = xrayCam
  rtt.renderList = meshes
  rtt.refreshRate = 1
  scene.customRenderTargets.push(rtt)

  if (!BABYLON.Effect.ShadersStore['xrayVertexShader']) {
    BABYLON.Effect.ShadersStore['xrayVertexShader'] = `
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`
  }

  if (!BABYLON.Effect.ShadersStore['xrayFragmentShader']) {
    BABYLON.Effect.ShadersStore['xrayFragmentShader'] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D maskSampler;
uniform vec2 texelSize;
void main() {
  float c = texture2D(maskSampler, vUV).r;
  if (c > 0.5) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    return;
  }
  float n = texture2D(maskSampler, vUV + vec2(0.0, texelSize.y)).r;
  float s = texture2D(maskSampler, vUV - vec2(0.0, texelSize.y)).r;
  float e = texture2D(maskSampler, vUV + vec2(texelSize.x, 0.0)).r;
  float w = texture2D(maskSampler, vUV - vec2(texelSize.x, 0.0)).r;
  if (n > 0.5 || s > 0.5 || e > 0.5 || w > 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  discard;
}
`
  }

  const mat = new BABYLON.ShaderMaterial(
    'xray',
    scene,
    { vertex: 'xray', fragment: 'xray' },
    {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'texelSize'],
      samplers: ['maskSampler'],
    },
  )
  mat.setTexture('maskSampler', rtt)
  mat.backFaceCulling = false
  mat.disableDepthWrite = true
  mat.depthFunction = BABYLON.Engine.ALWAYS
  mat.onBind = () => {
    const size = rtt!.getSize()
    mat.setVector2('texelSize', new BABYLON.Vector2(1 / size.width, 1 / size.height))
  }

  quad = BABYLON.MeshBuilder.CreatePlane('xrayQuad', { size: 2 }, scene)
  quad.material = mat
  quad.renderingGroupId = 2
  quad.isPickable = false
  quad.alwaysSelectAsActiveMesh = true
  quad.infiniteDistance = true

  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera
    if (!cam || !xrayCam) return
    xrayCam.position.copyFrom(cam.globalPosition)
    const rotCam = cam as BABYLON.FreeCamera
    if (rotCam.rotationQuaternion) {
      xrayCam.rotationQuaternion = rotCam.rotationQuaternion
    } else {
      xrayCam.rotation.copyFrom(rotCam.rotation)
    }
    xrayCam.fov = cam.fov
    xrayCam.minZ = cam.minZ
    xrayCam.maxZ = cam.maxZ
    if (quad) quad.parent = cam
  })
}
