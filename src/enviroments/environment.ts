import { wantsGateway } from '../../common/helpers/detector'
import { createEvent, TypedEventTarget } from '../utils/EventEmitter'
import { TimeOfDay } from '../utils/time-of-day'
import { StateObservable } from '../utils/state-observable'
import { Color3, Color4, HemisphericLight, Mesh, SceneContext, ShaderMaterial, addToScene, createHemisphericLight, setFog } from '@babylonjs/lite'
import { vec3 } from 'wgpu-matrix'

const AMBIENT = 0.3
const GATEWAY_AMBIENT = 0.45

export abstract class Environment extends TypedEventTarget<{
  'fog-updated': void
  'parcel-collider-added': Mesh
  'parcel-collider-removed': Mesh
}> {
  public ambientLight?: HemisphericLight

  protected constructor(protected readonly scene: SceneContext) {
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

  get ambient(): number {
    return wantsGateway() ? GATEWAY_AMBIENT : AMBIENT
  }

  get fogDensity() {
    if (wantsGateway()) return 0
    return Math.max(3 / window.draw.distance - 0.006, 0)
  }

  get sunPosition() {
    return vec3.fromValues(0, 1, 0)
  }

  get fogColor() {
    return ([0.95, 0.95, 0.95] as Color3)
  }

  get clearColor() {
    return ([0, 0, 0, 0] as Color4)
  }

  public abstract invalidateGroundLoaded(): void

  async load() {
    window.environment = this
    this.scene.clearColor = this.clearColor
    this.updateFog(this.scene)

    this.ambientLight = createHemisphericLight(
      [this.sunPosition[0], this.sunPosition[1], this.sunPosition[2]],
      this.brightness,
    )
    this.ambientLight.groundColor = [this.ambient, this.ambient, this.ambient]
    addToScene(this.scene, this.ambientLight)

    window.draw.addEventListener('distance-changed', () => {
      this.updateFog(this.scene)
    })

    window.graphic.addEventListener('settingsChanged', () => {
      this.updateFog(this.scene)
    })
  }

  updateFog(scene: SceneContext) {
    const c = this.fogColor
    setFog(scene, {
      mode: 2,
      density: this.fogDensity,
      start: 0,
      end: 1000,
      color: [c[0], c[1], c[2]],
    })
    this.dispatchEvent(createEvent('fog-updated', undefined))
  }

  abstract update(): void

  setShaderParameters(mat: ShaderMaterial, brightnessCorrection = 1.0) {
    mat.setFloat('brightness', this.brightness * brightnessCorrection)
    this.setShaderEnvironmentGlobals(mat)
  }

  /** Updates all props that come from the environment */
  updateShaderProperties(mat: ShaderMaterial) {
    this.setShaderEnvironmentGlobals(mat)
    mat.markDirty()
  }

  abstract parcelMeshesAdded(meshes: Mesh[]): void

  abstract parcelMeshesRemoved(meshes: Mesh[]): void

  private setShaderEnvironmentGlobals(mat: ShaderMaterial) {
    mat.setFloat('ambient', this.ambient)
    mat.setVector3('lightDirection', this.sunPosition)
    mat.setFloat('fogDensity', this.fogDensity)
    mat.setColor3('fogColor', this.fogColor)
  }
}
