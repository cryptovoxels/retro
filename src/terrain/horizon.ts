import { Color3, Mesh, SceneContext } from '@babylonjs/lite'

function stubHorizonMaterial() {
  let topColor: Color3 = [0, 0, 0]
  return {
    fogEnabled: true,
    offset: 0.5,
    scale: 25,
    smoothness: 1,
    topColorAlpha: 0,
    backFaceCulling: false,
    disableLighting: true,
    alphaMode: 0,
    topColor: {
      equals: (c: Color3) => topColor[0] === c[0] && topColor[1] === c[1] && topColor[2] === c[2],
    },
    bottomColor: topColor,
    bottomColorAlpha: 1,
    unfreeze: () => {},
    freeze: () => {},
    blockDirtyMechanism: true,
    _setTopColor: (c: Color3) => {
      topColor = c
    },
  }
}

function stubHorizonMesh() {
  return {
    scaling: { setAll: (_: number) => {} },
    infiniteDistance: false,
    isPickable: false,
    alphaIndex: 2,
    material: null,
    isVisible: true,
    setEnabled: (_: boolean) => {},
  } as Mesh
}

// Horizon blends ground terrain and skybox fog at the rim
export default class Horizon {
  private mesh: Mesh
  private material: ReturnType<typeof stubHorizonMaterial>

  constructor(_scene: SceneContext) {
    // todo(lite): HorizonMaterial + horizon sphere mesh
    this.material = stubHorizonMaterial()
    const mesh = stubHorizonMesh()
    mesh.material = this.material as any

    const updateHorizonScale = (drawDistance: number) => {
      mesh.scaling.setAll(drawDistance * 1.8)
    }

    updateHorizonScale(window.draw.distance)
    window.draw.addEventListener('distance-changed', (e) => updateHorizonScale(e.detail), { passive: true })

    this.mesh = mesh
  }

  update(horizonAlphaMode: number, fogColor: Color3) {
    if (this.material.alphaMode === horizonAlphaMode && this.material.topColor.equals(fogColor)) {
      return
    }
    this.material.unfreeze()
    this.material.topColorAlpha = horizonAlphaMode === 0 ? 1.0 : 0.0
    this.material.alphaMode = horizonAlphaMode
    this.material._setTopColor(fogColor)
    this.material.bottomColor = fogColor
    this.material.bottomColorAlpha = 1.0
    this.material.freeze()
  }

  getMesh(): Mesh {
    return this.mesh
  }

  setVisible(visible: boolean) {
    this.mesh.setEnabled(visible)
  }
}
