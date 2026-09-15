import { HorizonMaterial } from '../shaders/horizon'

// Horizon fills the gap between ground fog color and the skybox
export default class Horizon {
  private mesh: BABYLON.Mesh
  private material: BABYLON.GradientMaterial

  constructor(scene: BABYLON.Scene) {
    const material = new HorizonMaterial('skybox/horizon', scene)
    material.fogEnabled = true

    material.offset = 0.5
    material.scale = 25
    material.smoothness = 1

    material.topColorAlpha = 1
    material.bottomColorAlpha = 1
    material.alphaMode = BABYLON.Engine.ALPHA_DISABLE
    material.backFaceCulling = false
    material.disableLighting = true

    material.freeze()
    material.blockDirtyMechanism = true
    this.material = material

    const mesh = BABYLON.MeshBuilder.CreateSphere('skybox/horizon', { segments: 16, diameter: 1 }, scene)

    const updateHorizonScale = (drawDistance: number) => {
      mesh.scaling.setAll(drawDistance * 1.8)
    }

    updateHorizonScale(window.draw.distance)
    window.draw.addEventListener('distance-changed', (e) => updateHorizonScale(e.detail), { passive: true })

    mesh.infiniteDistance = true
    mesh.isPickable = false
    mesh.material = material
    this.mesh = mesh
  }

  update(fogColor: BABYLON.Color3) {
    if (this.material.topColor.equals(fogColor)) {
      return
    }
    this.material.unfreeze()
    this.material.topColor = fogColor
    this.material.bottomColor = fogColor
    this.material.freeze()
  }

  getMesh(): BABYLON.Mesh {
    return this.mesh
  }

  setVisible(visible: boolean) {
    this.mesh.setEnabled(visible)
  }
}
