import { wantsGateway } from '../../common/helpers/detector'
import { createEvent, TypedEventTarget } from '../utils/EventEmitter'
import { TimeOfDay } from '../utils/time-of-day'
import { StateObservable } from '../utils/state-observable'

const AMBIENT = 0.3
const GATEWAY_AMBIENT = 0.45

export abstract class Environment extends TypedEventTarget<{
  'fog-updated': void
  'parcel-collider-added': BABYLON.AbstractMesh
  'parcel-collider-removed': BABYLON.AbstractMesh
}> {
  public ambientLight?: BABYLON.HemisphericLight

  protected constructor(
    public parent: BABYLON.TransformNode,
    protected readonly scene: BABYLON.Scene,
  ) {
    super()
    this._timeOfDay = window.config.isNight ? TimeOfDay.Night : TimeOfDay.Day
  }

  public abstract get groundStateObservable(): StateObservable<'loaded' | 'unloaded'>

  private _timeOfDay: TimeOfDay

  public get timeOfDay() {
    return this._timeOfDay
  }

  public set timeOfDay(time: TimeOfDay) {
    if (this._timeOfDay === time) return
    this._timeOfDay = time
    this.update()
  }

  get graphic() {
    return window.graphic
  }

  get isUnderwater() {
    return false
  }

  get isNight() {
    return this._timeOfDay === TimeOfDay.Night
  }

  get brightness() {
    return 1.0 // default, used in spaces
  }

  get ambient() {
    return wantsGateway() ? GATEWAY_AMBIENT : AMBIENT
  }

  get fogDensity() {
    if (wantsGateway()) return 0
    return Math.max(3 / window.draw.distance - 0.006, 0)
  }

  get sunPosition() {
    return new BABYLON.Vector3(0, 1, 0)
  }

  get fogColor() {
    return new BABYLON.Color3(0.95, 0.95, 0.95)
  }

  get clearColor() {
    return new BABYLON.Color4(0, 0, 0, 0)
  }

  public abstract invalidateGroundLoaded(): void

  async load() {
    window.environment = this
    this.scene.clearColor = this.clearColor
    this.updateFog(this.scene)

    this.ambientLight = new BABYLON.HemisphericLight('sun', this.sunPosition, this.scene)
    this.ambientLight.intensity = this.brightness
    this.ambientLight.groundColor = new BABYLON.Color3(this.ambient, this.ambient, this.ambient)

    window.draw.addEventListener('distance-changed', () => {
      this.updateFog(this.scene)
    })

    window.graphic.addEventListener('settingsChanged', () => {
      this.updateFog(this.scene)
    })
  }

  updateFog(scene: BABYLON.Scene) {
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2
    scene.fogDensity = this.fogDensity
    scene.fogColor = this.fogColor
    this.dispatchEvent(createEvent('fog-updated', undefined))
  }

  abstract update(): void

  setShaderParameters(mat: BABYLON.ShaderMaterial, brightnessCorrection = 1.0) {
    mat.setFloat('brightness', this.brightness * brightnessCorrection)
    this.setShaderEnvironmentGlobals(mat)
  }

  /** Updates all props that come from the environment */
  updateShaderProperties(mat: BABYLON.ShaderMaterial) {
    this.setShaderEnvironmentGlobals(mat)
    mat.markDirty()
  }

  abstract parcelMeshesAdded(meshes: BABYLON.Mesh[]): void

  abstract parcelMeshesRemoved(meshes: BABYLON.Mesh[]): void

  private setShaderEnvironmentGlobals(mat: BABYLON.ShaderMaterial) {
    mat.setFloat('ambient', this.ambient)
    mat.setVector3('lightDirection', this.sunPosition)
    mat.setFloat('fogDensity', this.fogDensity)
    mat.setColor3('fogColor', this.fogColor)
  }
}
