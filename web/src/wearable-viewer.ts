import { isSafari } from '../../common/helpers/detector'
import { createWearableScene } from './helpers/scenes'
import voxImport from '../../common/vox-import/sync-vox-import'

import { loadWearableVox } from './helpers/wearable-helpers'
import { matchRight } from 'fp-ts/lib/ReadonlyNonEmptyArray'

export class WearableViewer {
  private readonly canvas: HTMLCanvasElement
  private engine?: BABYLON.Engine
  private scene?: BABYLON.Scene

  private mesh?: BABYLON.Mesh

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  resizeHandler = () => this.scene?.getEngine().resize()

  dispose() {
    window.removeEventListener('resize', this.resizeHandler.bind(this))
    this.scene?.dispose()
    this.scene?.getEngine().dispose()
  }

  async loadURL(url: string) {
    if (!this.canvas) {
      alert('No canvas')
      return
    }

    this.engine = new BABYLON.Engine(this.canvas)
    this.scene = new BABYLON.Scene(this.engine)
    this.scene.clearColor.set(0.6, 0.6, 0.6, 1)
    window.addEventListener('resize', () => this.engine?.resize(), { passive: true })

    const camera = new BABYLON.ArcRotateCamera('wearable-camera', -Math.PI / 2, Math.PI / 3, 3, new BABYLON.Vector3(0, 0, 0), this.scene!)
    camera.useAutoRotationBehavior = true
    camera.attachControl(this.canvas, true)
    camera.upperBetaLimit = Math.PI * 0.4
    camera.lowerRadiusLimit = 2
    camera.upperRadiusLimit = 10
    camera.minZ = 0.01

    // Add fog
    this.scene!.fogEnabled = true
    this.scene!.fogMode = BABYLON.Scene.FOGMODE_EXP2
    this.scene!.fogColor = new BABYLON.Color3(0.6, 0.6, 0.6)
    this.scene!.fogStart = 22
    this.scene!.fogEnd = 50

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 32, height: 32 }, this.scene!)
    const m = new BABYLON.StandardMaterial('ground', this.scene!)
    m.diffuseColor = new BABYLON.Color3(0.7, 0.7, 0.7)
    m.specularColor.set(0.3, 0.3, 0.3)
    m.specularPower = 1000

    const t = new BABYLON.Texture('/textures/grid.png', this.scene!)
    t.uScale = 64
    t.vScale = 64
    m.diffuseTexture = t
    ground.material = m

    const light = new BABYLON.HemisphericLight('light1', new BABYLON.Vector3(0, 1, 0), this.scene!)
    light.intensity = 0.5

    const sun = new BABYLON.SpotLight('sun', new BABYLON.Vector3(-1, -1, 1), Math.PI / 2, 30, this.scene!)
    sun.intensity = 1.0
    // sun.direction = new BABYLON.Vector3(0, -1, 0)
    sun.position = new BABYLON.Vector3(1, 5, 1)
    sun.setDirectionToTarget(new BABYLON.Vector3(0, 0, 0))
    // sun.radius = 10
    // sun.angle = Math.PI / 2
    // sun.exponent = 30

    this.scene!.ambientColor = new BABYLON.Color3(1, 1, 1) // full white ambient

    this.engine.runRenderLoop(() => this.scene?.render())

    const mesh = await voxImport(url, this.scene!)
    mesh.scaling.set(1, 1, 1)
    mesh.rotation.set(0, Math.PI / 4, 0)

    const mat = new BABYLON.StandardMaterial('wearable', this.scene!)
    mat.diffuseColor = new BABYLON.Color3(1, 1, 1)
    mat.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.2)
    mat.specularColor.set(0.3, 0.3, 0.3)
    mat.specularPower = 1000
    mesh.material = mat

    const avatar = await BABYLON.SceneLoader.ImportMeshAsync(null, '/models/', 'avatar.glb', this.scene!)
    const avatarMesh = avatar.meshes[0] as BABYLON.Mesh
    avatarMesh.position.set(-1, 0, 1)
    avatarMesh.scaling.set(1, 1, 1)
    avatarMesh.rotation.set(0, 0, 0)
    avatarMesh.visibility = 0.5
    avatarMesh.material = mat
    // avatarMesh.attachToBone(mesh, avatarMesh)

    console.log(mesh)
    this.mesh = mesh
  }
}
