const emojiSize = 0.2

const gravity = -0.001
const drag = 0.98

const maxSpeed = 0.1 // meters per frame
const minSpeed = 0.01 // meters per frame

const positionRadius = 0.3 // how wide circle around the position to randomly spawn particles (horisontally, like a hula hoop)
const maxLifetime = 2 * 60 // lifetime in frames

export const emote = (emoji: string, position: BABYLON.Vector3, scene: BABYLON.Scene, nicerLooking = true) => {
  if (!scene || scene.isDisposed) return

  const system = new BABYLON.SolidParticleSystem('avatar/emote-' + Date.now(), scene)

  const particleCount = BABYLON.Scalar.RandomRange(1, 25)

  const plane = BABYLON.MeshBuilder.CreatePlane('avatar/emote-plane-' + Date.now(), { width: emojiSize, height: emojiSize }, scene)
  system.addShape(plane, particleCount)
  plane.dispose()
  const mesh = system.buildMesh()

  system.billboard = true
  system.isAlwaysVisible = true
  system.computeParticleColor = false
  system.computeParticleVertex = false

  const textureSize = emojiSize * (nicerLooking ? 512 : 256)

  const texture = createTexture(scene, emoji, textureSize)
  mesh.material = createMaterial(scene, texture)

  system.updateParticle = updateParticle
  system.particles.forEach((p) => {
    initParticle(position, p)
  })

  // check if all particles are dead, and dispose of the system if so
  const observable = scene.onAfterRenderObservable.add(() => {
    system.setParticles()
    let isFinished = true
    for (let p = 0; p < system.nbParticles; p++) {
      if (system.particles[p].isVisible) {
        isFinished = false
        break
      }
    }
    if (isFinished) {
      scene.onAfterRenderObservable.remove(observable)
      system.dispose()
      mesh.material?.dispose(true, true)
    }
  })
}

function initParticle(startPosition: BABYLON.Vector3, particle: BABYLON.SolidParticle) {
  const scale = BABYLON.Scalar.RandomRange(0.5, 1)
  particle.scale.x *= scale
  particle.scale.y *= scale
  particle.scale.z *= scale

  const velocity = BABYLON.Scalar.RandomRange(minSpeed, maxSpeed)
  const angle = Math.random() * Math.PI * 2
  particle.velocity = new BABYLON.Vector3(Math.cos(angle), 3, Math.sin(angle)).normalize().scale(velocity)

  const posAngle = Math.random() * Math.PI * 2
  particle.position.x = startPosition.x + Math.sin(posAngle) * positionRadius
  particle.position.y = startPosition.y
  particle.position.z = startPosition.z + Math.cos(posAngle) * positionRadius

  particle.props = { lifetime: BABYLON.Scalar.RandomRange(0.1 * maxLifetime, maxLifetime), time: Date.now() }
}

function updateParticle(particle: BABYLON.SolidParticle): BABYLON.SolidParticle {
  if (particle.props.lifetime < 1) {
    particle.isVisible = false
    return particle
  }

  const now = Date.now()
  let frameTime = now - particle.props.time
  particle.props.time = now

  const idealFrameTime = 16.666666667

  // here we disconnect the frame time from physics simulation by simulating the number of ideal frames that have passed
  // which will avoid emotes hanging in the air longer when there is a rendering lag spike
  while (frameTime > 0.0) {
    const deltaTime = Math.min(frameTime, idealFrameTime)

    particle.velocity.x *= drag
    particle.velocity.y *= drag
    particle.velocity.z *= drag

    // scale is a function an ease-in-function of lifetime, so that it gets smaller the less lifetime it has left
    const scale = 1 - Math.pow(1 - particle.props.lifetime / maxLifetime, 5)
    particle.scale.x = scale
    particle.scale.y = scale
    particle.scale.z = scale

    particle.velocity.y += gravity

    particle.position.addInPlace(particle.velocity) // update particle new position
    const direction = Math.sign((particle.idx % 2) - 0.5) //rotation direction +/- 1 depends on particle index in particles array
    // rotation sign and new value
    particle.rotation.z += 0.01 * direction

    particle.props.lifetime -= deltaTime / idealFrameTime

    frameTime -= deltaTime
  }
  return particle
}

function createMaterial(scene: BABYLON.Scene, texture: BABYLON.DynamicTexture) {
  const mat = new BABYLON.StandardMaterial('avatar/emote-material-' + Date.now(), scene)
  mat.ambientColor = new BABYLON.Color3(1, 1, 1)
  mat.specularColor = new BABYLON.Color3(0, 0, 0)
  mat.emissiveTexture = texture
  mat.diffuseTexture = texture
  mat.blockDirtyMechanism = true

  return mat
}

function createTexture(scene: BABYLON.Scene, emoji: string, textureSize: number): BABYLON.DynamicTexture {
  const dynamicTexture = new BABYLON.DynamicTexture(
    'avatar/emoji-' + Date.now(),
    {
      width: textureSize,
      height: textureSize,
    },
    scene,
    false,
  )
  const ctx = dynamicTexture.getContext()
  const size = 12
  const font_type = 'sans-serif'
  ctx.font = size + 'px ' + font_type
  const textWidth = ctx.measureText(emoji).width
  const ratio = textWidth / size
  const font_size = Math.floor(textureSize / (ratio * 1)) //size of multiplier (1) can be adjusted, increase for smaller text
  const font = font_size + 'px ' + font_type
  dynamicTexture.drawText(emoji, null, null, font, '#000000', 'transparent', true)
  dynamicTexture.hasAlpha = true
  return dynamicTexture
}
