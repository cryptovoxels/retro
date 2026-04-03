import { StateObservable } from '../utils/state-observable'
import { Environment } from './environment'
import type { Scene } from '../scene'
import { createEvent } from '../utils/EventEmitter'

export class ScratchpadEnvironment extends Environment<Scene> {
  skybox?: BABYLON.Mesh
  ground?: BABYLON.Mesh
  groundMaterial: BABYLON.StandardMaterial | undefined
  groundTexture: BABYLON.Texture | undefined

  constructor(parent: BABYLON.TransformNode, scene: Scene) {
    console.debug('Creating SpacesEnvironment')
    super(parent, scene)
  }

  private _groundStateObservable = new StateObservable<'loaded' | 'unloaded'>('unloaded')

  public override get groundStateObservable(): StateObservable<'loaded' | 'unloaded'> {
    return this._groundStateObservable
  }

  override get fogDensity() {
    return 0.001
  }

  override get brightness() {
    return 0.3
  }

  override async load() {
    await super.load()

    const m = new BABYLON.GradientMaterial('skybox', this.scene)
    m.topColor = new BABYLON.Color3(0.2, 0.2, 0.2)
    m.bottomColor = new BABYLON.Color3(0, 0, 0)
    m.scale = 0.04
    // m.offset = -0.1
    m.backFaceCulling = false
    m.disableLighting = true

    this.ambientLight?.dispose()

    const l = new BABYLON.SpotLight('skybox/light', new BABYLON.Vector3(0, 64, 0), new BABYLON.Vector3(0,-1, 0), Math.PI / 2, 32, this.scene)
    // l.diffuse.set(1, 0, 1)
    // l.intensity = 1000
    // l.diffuse = new BABYLON.Color3(1, 0, 0)

    this.skybox = BABYLON.MeshBuilder.CreateSphere('skybox', { segments: 16, diameter: 128 }, this.scene)
    this.skybox.infiniteDistance = true
    this.skybox.applyFog = false
    this.skybox.material = m

    this.ground = BABYLON.MeshBuilder.CreatePlane('space/ground', { size: 128 }, this.scene)
    this.ground.parent = this.parent
    this.ground.rotate(BABYLON.Axis.X, Math.PI / 2)
    this.ground.position.y = 0.75
    this.ground.checkCollisions = true

    this.groundStateObservable.setState('loaded')

    const t = new BABYLON.Texture('/textures/grid.png', this.scene)
    t.uScale = 1024
    t.vScale = 1024
    t.uOffset = 0.5
    t.vOffset = 0.5

    this.groundMaterial = new BABYLON.StandardMaterial('space/ground', this.scene)
    this.groundMaterial.diffuseTexture = t
    this.groundMaterial.specularColor.set(0,0,0)
    this.groundMaterial.zOffset = 1

    if (this.ground) {
      this.ground.material = this.groundMaterial
    }
  }

  override update() {
    /** noop **/
  }

  public override invalidateGroundLoaded() {
    // No-op for Spaces - ground loading is not applicable in space environment
  }

  parcelMeshesAdded(meshes: BABYLON.Mesh[]) {
    meshes.forEach((parcelMesh) => {
      if (!parcelMesh || !parcelMesh.checkCollisions) return
      this.dispatchEvent(createEvent('parcel-collider-added', parcelMesh))
    })
  }

  parcelMeshesRemoved(meshes: BABYLON.Mesh[]) {
    meshes.forEach((parcelMesh) => {
      if (!parcelMesh || !parcelMesh.checkCollisions) return
      this.dispatchEvent(createEvent('parcel-collider-removed', parcelMesh))
    })
  }
}
