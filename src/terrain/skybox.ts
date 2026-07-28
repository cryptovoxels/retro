export default class Skybox {
  private readonly _mesh: BABYLON.Mesh
  private material: BABYLON.SkyMaterial

  constructor(scene: BABYLON.Scene) {
    const material = new BABYLON.SkyMaterial('skybox/sky-material', scene)
    material.backFaceCulling = false // leave
    material.useSunPosition = true
    material.fogEnabled = false // we set out fog kinda thick so we can't enable it for the sky
    material.turbidity = 1 // smearing of the sun local to the sun itself
    material.rayleigh = 2 // smearing of the sun across the sky in general
    material.mieCoefficient = 0.03 // smearing that obscures the sun's shape
    material.dithering = true // needed to overcome precision issues introduced by shader pipeline
    material.freeze()
    this.material = material

    const mesh = BABYLON.MeshBuilder.CreateSphere('skybox', { segments: 16, diameter: 1 }, scene)

    const updateScale = (drawDistance: number) => {
      mesh.scaling.setAll(drawDistance * 1.96)
    }

    updateScale(window.draw.distance)
    window.draw.addEventListener('distance-changed', (e) => updateScale(e.detail))

    mesh.material = material
    mesh.infiniteDistance = true
    mesh.isPickable = false
    mesh.alphaIndex = 0 // render behind all other alpha blended meshes

    this._mesh = mesh
  }

  get mesh(): BABYLON.Mesh {
    return this._mesh
  }

  update(sunPosition: BABYLON.Vector3, luminance: number) {
    if (this.material.sunPosition.equals(sunPosition) && this.material.luminance === luminance) {
      return
    }
    this.material.unfreeze()
    this.material.sunPosition = sunPosition
    this.material.luminance = luminance
    this.material.freeze()
  }
}
