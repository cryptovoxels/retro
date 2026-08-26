import { Mesh, SceneContext, Vec3 } from '@babylonjs/lite'

function stubMesh() {
  return {
    scaling: { setAll: (_: number) => {} },
    material: null,
    infiniteDistance: false,
    isPickable: false,
    alphaIndex: 0,
    isVisible: true,
  } as Mesh
}

function stubMaterial() {
  let sunPosition: Vec3 = [0, 1, 0]
  let luminance = 1
  return {
    sunPosition: {
      equals: (v: Vec3) => sunPosition[0] === v[0] && sunPosition[1] === v[1] && sunPosition[2] === v[2],
    },
    get luminance() {
      return luminance
    },
    set luminance(v: number) {
      luminance = v
    },
    unfreeze: () => {},
    freeze: () => {},
    _setSun: (v: Vec3) => {
      sunPosition = v
    },
  }
}

export default class Skybox {
  private readonly _mesh: Mesh
  private material: ReturnType<typeof stubMaterial>

  constructor(_scene: SceneContext) {
    // todo(lite): SkyMaterial + sky sphere mesh
    this.material = stubMaterial()
    const mesh = stubMesh()
    mesh.material = this.material as any

    const updateScale = (drawDistance: number) => {
      mesh.scaling.setAll(drawDistance * 1.96)
    }

    updateScale(window.draw.distance)
    window.draw.addEventListener('distance-changed', (e) => updateScale(e.detail))

    this._mesh = mesh
  }

  get mesh(): Mesh {
    return this._mesh
  }

  update(sunPosition: Vec3, luminance: number) {
    if (this.material.sunPosition.equals(sunPosition) && this.material.luminance === luminance) {
      return
    }
    this.material.unfreeze()
    this.material._setSun(sunPosition)
    this.material.luminance = luminance
    this.material.freeze()
  }
}
