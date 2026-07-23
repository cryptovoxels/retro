import { Terrain } from '../terrain/terrain'
import Skybox from '../terrain/skybox'
import Horizon from '../terrain/horizon'
import UnderwaterSkybox from '../terrain/underwater-skybox'
import { StateObservable } from '../utils/state-observable'
import { Environment } from './environment'
import { TimeOfDay } from '../utils/time-of-day'
import { DAY_BRIGHTNESS, DAY_FOG_COLOR, DAY_SUN_POSITION, NIGHT_BRIGHTNESS, NIGHT_FOG_COLOR, NIGHT_SUN_POSITION, UNDERWATER_CLEAR_COLOR, UNDERWATER_TINT, UNDERWATER_FOG_DENSITY } from './world-environment-constants'
import { createEvent } from '../utils/EventEmitter'
import { GraphicLevels } from '../graphic/graphic-engine'
import { cameraPosition } from '../utils/camera'
import { OCEAN_HEIGHT_OFFSET } from '../constants'

export class WorldEnvironment extends Environment {
  terrain?: Terrain
  horizon?: Horizon
  skybox?: Skybox
  private underwaterSkybox?: UnderwaterSkybox
  private _invalidateGroundLoaded: (() => void) | undefined
  private _isNight: boolean | null = null
  private _isUnderwater: boolean | null = null
  private _groundStateObservable: StateObservable<'loaded' | 'unloaded'> | undefined

  constructor(parent: BABYLON.TransformNode, scene: BABYLON.Scene) {
    super(parent, scene)
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

    return this.hasWaterAtPosition(cameraPos)
  }

  private isAboveWaterSurface(position: BABYLON.Vector3): boolean {
    return position.y >= OCEAN_HEIGHT_OFFSET
  }

  private hasWaterAtPosition(position: BABYLON.Vector3): boolean {
    return this.terrain?.hasWaterMeshAt(position.x, position.z) || false
  }

  get sunPosition() {
    return this.timeOfDay === TimeOfDay.Night ? NIGHT_SUN_POSITION : DAY_SUN_POSITION
  }

  get fogColor() {
    if (this.isUnderwater) {
      return UNDERWATER_TINT
    }
    return this.isNight ? NIGHT_FOG_COLOR : DAY_FOG_COLOR
  }

  get clearColor() {
    if (this.isUnderwater) {
      return UNDERWATER_CLEAR_COLOR
    }
    return super.clearColor
  }

  get fogDensity() {
    if (this.isUnderwater) {
      return UNDERWATER_FOG_DENSITY
    }
    if (window.graphic.level === GraphicLevels.Custom && !window.graphic.customFog) {
      return 0
    }
    return super.fogDensity
  }

  get horizonAlphaMode() {
    return BABYLON.Engine.ALPHA_COMBINE
  }

  get brightness() {
    return this.isNight ? NIGHT_BRIGHTNESS : DAY_BRIGHTNESS
  }

  async load() {
    await super.load()

    this.skybox = new Skybox(this.scene)

    const terrain = new Terrain(this.scene, this.parent, [this.skybox])
    this.terrain = terrain
    this._groundStateObservable = terrain.islandsStateObservable
    this._invalidateGroundLoaded = () => terrain.invalidateIslandsLoaded()

    this.horizon = new Horizon(this.scene)
    this.underwaterSkybox = new UnderwaterSkybox(this.scene, UNDERWATER_TINT)

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
    this.horizon?.update(this.horizonAlphaMode, this.fogColor)
    this.horizon?.setVisible(!this.isUnderwater)
    this.underwaterSkybox?.setVisible(this.isUnderwater)
    this.terrain?.update()
  }

  private onEnvironmentStateChanged(): void {
    if (!this.scene) {
      return
    }

    this.updateFog(this.scene)
    this.scene.clearColor = this.clearColor

    // Update ambient light intensity when day/night changes
    if (this.ambientLight) {
      this.ambientLight.intensity = this.brightness
    }
  }

  parcelMeshesAdded(meshes: BABYLON.Mesh[]) {
    const validMeshes = meshes.filter((m) => m)

    validMeshes.forEach((parcelMesh) => {
      this.terrain?.addReflectionMesh(parcelMesh)
      if (parcelMesh.checkCollisions) {
        this.dispatchEvent(createEvent('parcel-collider-added', parcelMesh))
      }
    })
  }

  parcelMeshesRemoved(meshes: BABYLON.Mesh[]) {
    const validMeshes = meshes.filter((m) => m)

    validMeshes.forEach((parcelMesh) => {
      this.terrain?.removeReflectionMesh(parcelMesh)
      if (parcelMesh.checkCollisions) {
        this.dispatchEvent(createEvent('parcel-collider-removed', parcelMesh))
      }
    })
  }
}
