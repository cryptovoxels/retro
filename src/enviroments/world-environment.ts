import { Terrain } from '../terrain/terrain'
import Skybox from '../terrain/skybox'
import Horizon from '../terrain/horizon'
import { StateObservable } from '../utils/state-observable'
import { Environment } from './environment'
import { TimeOfDay } from '../utils/time-of-day'
import { DAY_BRIGHTNESS, DAY_FOG_COLOR, DAY_SUN_POSITION, NIGHT_BRIGHTNESS, NIGHT_FOG_COLOR, NIGHT_SUN_POSITION } from './world-environment-constants'
import { createEvent } from '../utils/EventEmitter'
import { cameraPosition } from '../utils/camera'
import { OCEAN_HEIGHT_OFFSET } from '../constants'
import { hideGatewayBackdrop } from '../gateway'
import { Color3, Color4, Mesh, SceneContext, Vec2, Vec3 } from '@babylonjs/lite'

export class WorldEnvironment extends Environment {
  terrain?: Terrain
  horizon?: Horizon
  skybox?: Skybox
  private _invalidateGroundLoaded: (() => void) | undefined
  private _isNight: boolean | null = null
  private _isUnderwater: boolean | null = null
  private _groundStateObservable: StateObservable<'loaded' | 'unloaded'> | undefined

  constructor(scene: SceneContext) {
    super(scene)
  }

  public override get groundStateObservable(): StateObservable<'loaded' | 'unloaded'> {
    if (!this._groundStateObservable) {
      throw new Error('getGroundStateObservable() called before WorldEnvironment.load()')
    }
    return this._groundStateObservable
  }

  get grid() {
    return window.grid
  }

  get isUnderwater() {
    if (!this.scene?.activeCamera) {
      return false
    }

    const cameraPos = cameraPosition(this.scene)

    if (this.isAboveWaterSurface(cameraPos)) {
      return false
    }

    if (this.terrain?.getIsland(({ x: cameraPos.x, y: cameraPos.z } as Vec2))) {
      return false
    }

    return this.hasWaterAtPosition(cameraPos)
  }

  private isAboveWaterSurface(position: Vec3): boolean {
    return position.y >= OCEAN_HEIGHT_OFFSET + 0.3
  }

  private hasWaterAtPosition(position: Vec3): boolean {
    return this.terrain?.hasWaterMeshAt(position.x, position.z) || false
  }

  get sunPosition() {
    return this.timeOfDay === TimeOfDay.Night ? NIGHT_SUN_POSITION : DAY_SUN_POSITION
  }

  get fogColor() {
    if (this.isUnderwater) {
      return ([0.2, 0.2, 0.2] as Color3)
    }
    return this.isNight ? NIGHT_FOG_COLOR : DAY_FOG_COLOR
  }

  get fogDensity() {
    if (this.isUnderwater) {
      return 0.12
    }
    return super.fogDensity
  }

  get clearColor() {
    if (this.isUnderwater) {
      return ([0.03, 0.03, 0.03, 1] as Color4)
    }
    return super.clearColor
  }

  get horizonAlphaMode() {
    return (undefined as any /* todo(lite): BABYLON.Engine.ALPHA_COMBINE */)
  }

  get brightness() {
    return this.isNight ? NIGHT_BRIGHTNESS : DAY_BRIGHTNESS
  }

  async load() {
    await super.load()

    this.skybox = new Skybox(this.scene)

    const terrain = new Terrain(this.scene, [this.skybox])
    this.terrain = terrain
    this._groundStateObservable = terrain.islandsStateObservable
    this._invalidateGroundLoaded = () => terrain.invalidateIslandsLoaded()

    this.horizon = new Horizon(this.scene)

    await terrain.load()
  }

  public override invalidateGroundLoaded() {
    if (!this._invalidateGroundLoaded) {
      throw new Error('invalidateGroundLoaded() called before WorldEnvironment.load()!')
    }

    this._invalidateGroundLoaded()
  }

  override update() {
    this.updateEnvironmentState()
    this.updateSceneElements()
  }

  private updateEnvironmentState(): void {
    const isNight = this.isNight
    const isUnderwater = this.isUnderwater
    const hasChanged = this.isNight !== this._isNight || isUnderwater !== this._isUnderwater

    this._isNight = isNight
    this._isUnderwater = isUnderwater

    if (hasChanged) {
      this.onEnvironmentStateChanged()
    }
  }

  private updateSceneElements(): void {
    const skyboxBrightness = this.brightness

    this.skybox?.update(this.sunPosition, skyboxBrightness)
    if (this.skybox) this.skybox.mesh.isVisible = !this.isUnderwater
    this.horizon?.update(this.horizonAlphaMode, this.fogColor)
    this.horizon?.setVisible(!this.isUnderwater)
    hideGatewayBackdrop(this.skybox, this.horizon)
    this.terrain?.update()
  }

  private onEnvironmentStateChanged(): void {
    if (!this.scene) {
      return
    }

    this.updateFog(this.scene)
    this.scene.clearColor = this.clearColor
    ;(window as any).engine?.setUnderwater?.(this.isUnderwater)

    // Update ambient light intensity when day/night changes
    if (this.ambientLight) {
      this.ambientLight.intensity = this.brightness
    }
  }

  parcelMeshesAdded(meshes: Mesh[]) {
    const validMeshes = meshes.filter((m) => m)

    validMeshes.forEach((parcelMesh) => {
      this.terrain?.addReflectionMesh(parcelMesh)
      // opaque voxel meshes are the floor pick targets (was collider mesh)
      if (parcelMesh.name.startsWith('voxel-field/opaque')) {
        this.dispatchEvent(createEvent('parcel-collider-added', parcelMesh))
      }
    })
  }

  parcelMeshesRemoved(meshes: Mesh[]) {
    const validMeshes = meshes.filter((m) => m)

    validMeshes.forEach((parcelMesh) => {
      this.terrain?.removeReflectionMesh(parcelMesh)
      if (parcelMesh.name.startsWith('voxel-field/opaque')) {
        this.dispatchEvent(createEvent('parcel-collider-removed', parcelMesh))
      }
    })
  }
}
