// Horizon makes sure that the ground terrain and the skybox has a gradient fog blending them together
export default class Horizon {
  private mesh: BABYLON.Mesh
  private material: BABYLON.GradientMaterial

  constructor(scene: BABYLON.Scene) {
    const material = new BABYLON.GradientMaterial('skybox/horizon', scene)
    material.fogEnabled = true

    material.offset = 0.5 // used to move the color along the Y axis
    material.scale = 25 // used to scale the color on the Y axis, the higher this number is the lower the horizon will be
    material.smoothness = 1 //  speed of the color change along Y axis (0-10)

    material.topColorAlpha = 0
    material.backFaceCulling = false
    material.disableLighting = true

    material.freeze()
    material.blockDirtyMechanism = true
    this.material = material

    // infiniteDistance — no scene parent needed
    const mesh = BABYLON.MeshBuilder.CreateSphere('skybox/horizon', { segments: 16, diameter: 1 }, scene)

    const updateHorizonScale = (drawDistance: number) => {
      // just needs to be a tad smaller than the skybox so it can 'draw' in-front off it
      mesh.scaling.setAll(drawDistance * 1.8)
    }

    updateHorizonScale(window.draw.distance)
    window.draw.addEventListener('distance-changed', (e) => updateHorizonScale(e.detail), { passive: true })

    mesh.infiniteDistance = true
    mesh.isPickable = false
    mesh.alphaIndex = 2 // render behind all other alpha blended meshes except for global and local skyboxes
    mesh.material = material
    this.mesh = mesh
  }

  update(horizonAlphaMode: number, fogColor: BABYLON.Color3) {
    if (this.material.alphaMode === horizonAlphaMode && this.material.topColor.equals(fogColor)) {
      return
    }
    this.material.unfreeze()
    if (horizonAlphaMode === BABYLON.Engine.ALPHA_DISABLE) {
      this.material.topColorAlpha = 1.0
    } else {
      this.material.topColorAlpha = 0.0
    }
    this.material.alphaMode = horizonAlphaMode
    this.material.topColor = fogColor
    this.material.bottomColor = fogColor
    this.material.bottomColorAlpha = 1.0
    this.material.freeze()
  }

  getMesh(): BABYLON.Mesh {
    return this.mesh
  }

  setVisible(visible: boolean) {
    this.mesh.setEnabled(visible)
  }
}
