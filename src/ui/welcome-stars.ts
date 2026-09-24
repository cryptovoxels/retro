import type Persona from '../persona'

const STAR_COUNT = 12
const RING_RADIUS = 1.0
const RING_TILT = 0.18
const SPIN = 0.9 // rad/s
const LABEL_LIFT = 0.45 // above the eye line

function starTexture(scene: BABYLON.Scene) {
  const texture = new BABYLON.DynamicTexture('welcome/star', { width: 64, height: 64 }, scene, true)
  texture.hasAlpha = true
  const ctx = texture.getContext() as CanvasRenderingContext2D
  ctx.clearRect(0, 0, 64, 64)
  ctx.fillStyle = '#ffe07a'
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 30 : 12
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fill()
  texture.update()
  return texture
}

/** A ring of stars circling the local player at eye height, with their chosen name floating above. */
export function welcomeStars(scene: BABYLON.Scene, persona: Persona) {
  const root = new BABYLON.TransformNode('welcome', scene)
  root.rotation.x = RING_TILT

  const material = new BABYLON.StandardMaterial('welcome/star', scene)
  material.diffuseTexture = starTexture(scene)
  material.useAlphaFromDiffuseTexture = true
  material.emissiveColor = new BABYLON.Color3(1, 0.85, 0.4)
  material.disableLighting = true
  material.backFaceCulling = false
  material.freeze()

  const star = BABYLON.MeshBuilder.CreatePlane('welcome/stars', { size: 0.16 }, scene)
  star.material = material
  star.parent = root
  star.isPickable = false
  const matrices = new Float32Array(STAR_COUNT * 16)
  const m = BABYLON.Matrix.Identity()
  for (let i = 0; i < STAR_COUNT; i++) {
    const a = (i / STAR_COUNT) * Math.PI * 2
    // face outward so the orbiting camera always sees a few head-on
    BABYLON.Matrix.RotationYawPitchRollToRef(a, 0, 0, m)
    m.setTranslationFromFloats(Math.sin(a) * RING_RADIUS, (i % 2) * 0.12 - 0.06, Math.cos(a) * RING_RADIUS)
    m.copyToArray(matrices, i * 16)
  }
  star.thinInstanceSetBuffer('matrix', matrices, 16, true)

  const labelTexture = new BABYLON.DynamicTexture('welcome/label', { width: 512, height: 128 }, scene, true)
  labelTexture.hasAlpha = true
  const labelMaterial = new BABYLON.StandardMaterial('welcome/label', scene)
  labelMaterial.diffuseTexture = labelTexture
  labelMaterial.useAlphaFromDiffuseTexture = true
  labelMaterial.emissiveColor = BABYLON.Color3.White()
  labelMaterial.disableLighting = true
  labelMaterial.backFaceCulling = false
  const label = BABYLON.MeshBuilder.CreatePlane('welcome/name', { width: 0.9, height: 0.225 }, scene)
  label.material = labelMaterial
  label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL
  label.isPickable = false

  const setName = (name: string) => {
    const ctx = labelTexture.getContext() as CanvasRenderingContext2D
    ctx.clearRect(0, 0, 512, 128)
    if (!name) {
      labelTexture.update()
      return
    }
    ctx.textAlign = 'center'
    let size = 56
    ctx.font = `bold ${size}px 'helvetica neue', sans-serif`
    while (ctx.measureText(name).width > 464 && size > 24) {
      size -= 4
      ctx.font = `bold ${size}px 'helvetica neue', sans-serif`
    }
    // same dark pill as the avatar nametag so it reads as their name
    const width = ctx.measureText(name).width + 48
    ctx.fillStyle = 'rgba(34, 34, 34, 0.8)'
    ctx.fillRect(256 - width / 2, 24, width, 80)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.fillText(name, 256, 84)
    labelTexture.update()
  }
  setName('')

  const observer = scene.onBeforeRenderObservable.add(() => {
    root.position.copyFrom(persona.position)
    root.rotation.y += (scene.getEngine().getDeltaTime() / 1000) * SPIN
    label.position.copyFromFloats(persona.position.x, persona.position.y + LABEL_LIFT, persona.position.z)
  })

  return {
    setName,
    dispose() {
      scene.onBeforeRenderObservable.remove(observer)
      label.dispose(false, true)
      star.dispose(false, true)
      root.dispose()
    },
  }
}
