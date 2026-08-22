import Config from '../../common/config'
import { MegavoxRecord, RideRecord, VoxModelRecord } from '../../common/messages/feature'
import { Options as VoxImportOptions, voxImporter } from '../../common/vox-import/vox-import'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import Panel from '../../web/src/components/panel'
import { rebindGizmos } from '../tools/gizmos'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, FeatureID, Hyperlink, Toolbar, UrlSourceVoxModels } from '../ui/features'
import { isURL } from '../utils/helpers'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import Feature, { Feature3D, FeatureEvent, FeatureTrigger, MeshExtended, transformVectors } from './feature'
import ActionGui from '../ui/gui/action-button-gui'

// used when "Scale To Grid" is enabled
const CUBESCALE_MULTIPLIER_X = 0.02
const CUBESCALE_MULTIPLIER_Y = 0.065
const CUBESCALE_SCALE_FACTOR = 1 / (0.02 * 32) / 2
const CUBESCALE_SCALE_FACTOR_RECIPROCAL = 1 / CUBESCALE_SCALE_FACTOR
const CUBESCALE_SCALE_FACTOR_VECTOR = new BABYLON.Vector3(CUBESCALE_SCALE_FACTOR, CUBESCALE_SCALE_FACTOR, CUBESCALE_SCALE_FACTOR)
const CUBESCALE_SCALE_FACTOR_RECIPROCAL_VECTOR = new BABYLON.Vector3(CUBESCALE_SCALE_FACTOR_RECIPROCAL, CUBESCALE_SCALE_FACTOR_RECIPROCAL, CUBESCALE_SCALE_FACTOR_RECIPROCAL)

const cubescaleOffset = (scale: [number, number, number]) => new BABYLON.Vector3(CUBESCALE_MULTIPLIER_X * scale[0], 0, CUBESCALE_MULTIPLIER_Y * scale[2])

export default class VoxModel<Description extends VoxModelRecord | MegavoxRecord | RideRecord = VoxModelRecord> extends Feature3D<Description> {
  static Editor: typeof Editor
  static isRenderable = true
  static metadata: FeatureMetadata = {
    title: 'Vox Model',
    subtitle: 'small .vox model',
    type: 'vox-model',
    image: '/icons/vox-model.png',
  }
  static template: FeatureTemplate = {
    type: 'vox-model',
    scale: [0.5, 0.5, 0.5],
    url: '',
    flipX: true,
  }

  private _importError: string | null = null

  // Must be public for the Editor
  public get importError() {
    return this._importError
  }

  private get cubescale() {
    return !!this.description.cubescale
  }

  public override toString() {
    return this.url || super.toString()
  }

  public override whatIsThis() {
    return (
      <label>
        A .vox 3d model. You can make them with magicavoxel. Maximum dimensions of 32<sup>3</sup>.
      </label>
    )
  }

  public override async generateInstance(root: VoxModel) {
    if (!root.mesh) {
      // No mesh, generate normal mesh
      await this.generate()
      return
    }

    //@todo: fix type mesh
    this.mesh = root.mesh.createInstance(this.uniqueEntityName('instance')) as unknown as MeshExtended
    this.afterGenerate()
  }

  protected override applyMeshTransformAdjustments() {
    if (!this.cubescale || !this.mesh) return
    this.mesh.scaling.multiplyInPlace(CUBESCALE_SCALE_FACTOR_VECTOR)
    this.mesh.position.addInPlace(cubescaleOffset(this.tidyScale))
  }

  protected override stripMeshAdjustments(tv: transformVectors): transformVectors {
    if (!this.cubescale) return tv
    tv.scaling.multiplyInPlace(CUBESCALE_SCALE_FACTOR_RECIPROCAL_VECTOR)
    tv.position.subtractInPlace(cubescaleOffset([tv.scaling.x, tv.scaling.y, tv.scaling.z]))
    return tv
  }

  public override afterSetCommon = () => {
    this.refreshCollidable()
  }

  generateDraft() {
    if (this.disposed) return
    if (!(this.mesh instanceof BABYLON.Mesh)) {
      this.mesh = BABYLON.MeshBuilder.CreateBox(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
      rebindGizmos(this)
    }
    this.mesh.material = Feature.getDraftMaterial(this.scene)
    this.setCommon()
  }

  private applyImportedMesh(imported: BABYLON.Mesh) {
    if (!(this.mesh instanceof BABYLON.Mesh)) {
      this.mesh = imported
    } else {
      BABYLON.VertexData.ExtractFromMesh(imported).applyToMesh(this.mesh)
      this.mesh.material = imported.material
      imported.material = null
      imported.dispose()
    }
    this.mesh.isPickable = true
    this.mesh.checkCollisions = false
    this.mesh.name = this.uniqueEntityName('mesh')
    this.mesh.id = this.mesh.name
    this.mesh.refreshBoundingInfo()
    this.afterGenerate()
  }

  public override async generate() {
    this.generateDraft()
    void this.loadContent()
  }

  private async loadContent() {
    let url: string

    if (this.url && isURL(this.url)) {
      url = Config.voxModelURL(this.url, this.parcel, this.type === 'ride' ? 'megavox' : this.type)
    } else {
      url = `${process.env.ASSET_PATH}/models/vox-five.vox`
    }
    let mesh: BABYLON.Mesh
    try {
      mesh = await voxImporter().import(url, this._voxImportParams())
      this._importError = null
      this.refreshErrorMessage()
    } catch (e) {
      this._importError = typeof e === 'string' ? e : ((e as Error | null)?.message ?? 'Unknown error')
      if (e instanceof Error && e.message === 'Aborted') {
        // ignore abort errors
        return
      } else {
        console.warn(e)
      }
      if (this.disposed || this.abortController.signal.aborted) return
      await this.onError()
      this.refreshErrorMessage()
      return
    }

    if (this.disposed || this.abortController.signal.aborted) {
      mesh.dispose()
      return
    }

    this.applyImportedMesh(mesh)
  }

  // todo - make 0 in v2 of voxel alignment
  // get nudge() {
  //   return 0
  // }

  public override onClick(e: FeatureEvent) {
    // console.log('onClick', e)
    // console.log('behaviours', this.behaviours)
    if (this.behaviours) {
      this.behaviours.dispatch(this.uuid, 'click', e)
    }
  }

  // Override this in subclasses (e.g., Megavox) to reuse VoxModel.generate()
  protected _voxImportParams(): VoxImportOptions {
    return { signal: this.abortController.signal }
  }

  private refreshErrorMessage() {
    this.setEditorState({ importError: this.importError })
  }

  private async onError() {
    if (this.disposed || this.abortController.signal.aborted) return

    // Only show error voxel models to users with editing rights
    if (!this.parcel.canEdit) {
      // Clean up existing mesh if any
      if (this.mesh) {
        this.mesh.dispose()
        this.mesh = undefined as any
      }
      return
    }

    try {
      const mesh = await voxImporter().import(`${process.env.ASSET_PATH}/models/vox-five-broken.vox`, { signal: this.abortController.signal })

      if (this.disposed || this.abortController.signal.aborted) {
        mesh.dispose()
        return
      }

      this.applyImportedMesh(mesh)
    } catch {
      // aborted or failed: leave draft
    }
  }

  private refreshCollidable() {
    if (this.mesh) {
      this.mesh.checkCollisions = this.withinBounds && !!this.description.collidable
    }
  }

  protected afterGenerate() {
    this.setCommon()
    this.addScriptTriggers()
    this.addEvents()
    this.addAnimation()
    this.refreshCollidable()
  }
}

class Editor extends FeatureEditor<VoxModel> {
  constructor(props: FeatureEditorProps<VoxModel>) {
    super(props)
    FeatureEditor.openedEditor = this

    this.state = {
      id: props.feature.description.id,
      url: props.feature.description.url,
      type: props.feature.description.type,
      link: props.feature.description.link,
      cubescale: props.feature.description.cubescale,
      collidable: props.feature.description.collidable,
      importError: props.feature.importError,
    }
  }

  get importError() {
    // This state is changed via this.setEditorState() in the VoxModel above.
    return this.state.importError
  }

  componentDidUpdate() {
    this.merge({
      link: this.state.link,
      cubescale: this.state.cubescale,
      collidable: this.state.collidable,
    })
  }

  render() {
    return (
      <section>
        <Toolbar feature={this.props.feature} scene={this.props.scene} />
        <EditorProps>
          {/* keys are provided so that the getState in the component is reset after gizmo is used */}
          <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
          <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
          <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />
          {!!this.importError && (
            <dd class="full">
              <Panel type="danger">{this.importError}</Panel>
            </dd>
          )}
          <UrlSourceVoxModels feature={this.props.feature} scene={this.props.scene} />

          <Advanced>
            <Animation feature={this.props.feature} />

            <FeatureID feature={this.props.feature} />

            <Hyperlink feature={this.props.feature} />

            {this.state.type === 'vox-model' && (
              <>
                <dt>scale to grid</dt>
                <dd>
                  <input type="checkbox" name="cubescale" onChange={(e) => this.setState({ cubescale: e.currentTarget.checked })} checked={this.state.cubescale} />
                </dd>
              </>
            )}

            <>
              <dt>Enable Collision</dt>
              <dd>
                <input type="checkbox" name="collidable" onChange={(e) => this.setState({ collidable: e.currentTarget.checked })} checked={this.state.collidable} />
              </dd>
            </>

            <Behaviours feature={this.props.feature} />
          </Advanced>
        </EditorProps>
      </section>
    )
  }
}

VoxModel.Editor = Editor

export class Megavox extends VoxModel<MegavoxRecord> {
  static isRenderable = true
  static metadata: FeatureMetadata = {
    title: 'Megavox',
    subtitle: 'large .vox model',
    type: 'megavox',
    image: '/icons/megavox.png',
  }

  static template: FeatureTemplate = {
    type: 'megavox',
    scale: [0.5, 0.5, 0.5],
    url: '',
    flipX: true,
  }

  protected override _voxImportParams(): VoxImportOptions {
    return { ...super._voxImportParams(), sizeHint: this.scale, megavox: true }
  }

  override whatIsThis() {
    return (
      <label>
        A large .vox model (megavox).
      </label>
    )
  }
}

Megavox.Editor = Editor

export class Ride extends VoxModel<RideRecord> {
  static isRenderable = true
  static metadata: FeatureMetadata = {
    title: 'Ride',
    subtitle: 'driveable .vox (car, hover, animal)',
    type: 'ride',
    image: '/icons/megavox.png',
  }

  static template: FeatureTemplate = {
    type: 'ride',
    scale: [0.5, 0.5, 0.5],
    url: '',
    flipX: true,
  }

  // live drive state (ephemeral) - not written to the parcel feature record every frame
  driverUuid: string | null = null
  emptySince: number | null = null
  private parkedVisible = true
  private emptyRecallTimer: ReturnType<typeof setTimeout> | null = null
  private staleDriverTimer: ReturnType<typeof setTimeout> | null = null
  private lastDriveStateAt = 0
  private driveGui: ActionGui | null = null
  private driveTrigger: FeatureTrigger | null = null

  protected override afterGenerate() {
    ;(this.description as any).collidable = true
    super.afterGenerate()
    if (!this.driveTrigger) {
      this.driveTrigger = { proximityToTrigger: 7, onTrigger: () => this.showDriveGui(), onUnTrigger: () => this.hideDriveGui() }
      this.addTrigger(this.driveTrigger)
    }
  }

  private showDriveGui() {
    if (this.driveGui || !this.mesh) return
    if (this.driverUuid) return
    const top = this.mesh.getBoundingInfo().boundingBox.maximumWorld.y - this.mesh.absolutePosition.y
    const gui = new ActionGui(this, { position: new BABYLON.Vector3(0, top + 0.6, 0) })
    gui.addButton('Drive', {
      positionInGrid: [0, 0],
      height: '50px',
      onClick: () => (window.connector?.controls as any)?.enterVehicle?.(this),
    })
    gui.refresh()
    this.driveGui = gui
  }

  private hideDriveGui() {
    this.driveGui?.dispose()
    this.driveGui = null
  }

  protected override _voxImportParams(): VoxImportOptions {
    return { ...super._voxImportParams(), sizeHint: this.scale, megavox: true }
  }

  get isFlyable() {
    return !!this.description.flyable
  }

  get isDriven() {
    return !!this.driverUuid
  }

  override whatIsThis() {
    return (
      <label>
        A rideable .vox (car, hovercraft, animal). Anyone can hop in with E / Drive. Seated owners press <em>G</em> to adjust the seat, <em>T</em> to turn facing. Check <em>flyable</em> for hover (Space / V to climb).
      </label>
    )
  }

  // remotes see the avatar vehicle ghost - do not drag the lot mesh (that shears/stretches it).
  // local driver keeps the real mesh.
  setParkedVisible(visible: boolean) {
    this.parkedVisible = visible
    if (!this.mesh) return
    const localDriver = !!this.driverUuid && this.driverUuid === window.connector?.persona?.uuid
    this.mesh.setEnabled(localDriver || (visible && !this.isDriven))
  }

  applyDrivePose(position: [number, number, number], rotation: [number, number, number]) {
    if (!this.mesh) return
    if (this.mesh.isWorldMatrixFrozen) this.mesh.unfreezeWorldMatrix()
    if (this.mesh.rotationQuaternion) this.mesh.rotationQuaternion = null
    this.mesh.position.fromArray(position)
    this.mesh.rotation.fromArray(rotation)
    this.mesh.computeWorldMatrix(true)
  }

  broadcastDriveState(extra: Record<string, any> = {}) {
    const pos = this.mesh ? ([this.mesh.position.x, this.mesh.position.y, this.mesh.position.z] as [number, number, number]) : (this.description.position as any)
    const rot = this.mesh ? ([this.mesh.rotation.x, this.mesh.rotation.y, this.mesh.rotation.z] as [number, number, number]) : (this.description.rotation as any)
    this.parcel.sendStatePatch({
      [this.uuid]: {
        driverUuid: this.driverUuid,
        emptySince: this.emptySince,
        position: pos,
        rotation: rot,
        ...extra,
      },
    })
  }

  claimDriver(uuid: string) {
    if (this.driverUuid && this.driverUuid !== uuid) return false
    this.clearEmptyRecall()
    this.clearStaleDriverCheck()
    this.driverUuid = uuid
    this.emptySince = null
    this.setParkedVisible(false)
    this.hideDriveGui()
    this.broadcastDriveState()
    return true
  }

  releaseDriver(uuid?: string) {
    if (!this.driverUuid) return
    if (uuid && this.driverUuid !== uuid) return
    this.driverUuid = null
    this.emptySince = Date.now()
    this.setParkedVisible(true)
    if (this.driveTrigger?.triggered) this.showDriveGui()
    this.broadcastDriveState()
    this.scheduleEmptyRecall(this.distanceFromParkSq() > 16 * 16 ? 8_000 : EMPTY_RECALL_MS)
  }

  isAwayFromPark() {
    return this.distanceFromParkSq() > 4
  }

  recallToPark() {
    this.clearEmptyRecall()
    this.clearStaleDriverCheck()
    this.driverUuid = null
    this.emptySince = null
    const pos = (this.description.position as [number, number, number]) || [0, 0, 0]
    const rot = (this.description.rotation as [number, number, number]) || [0, 0, 0]
    this.applyDrivePose(pos, rot)
    try {
      this.mesh?.freezeWorldMatrix()
    } catch {}
    this.setParkedVisible(true)
    this.broadcastDriveState({ recall: true, position: pos, rotation: rot, driverUuid: null, emptySince: null })
    const controls = window.connector?.controls as any
    if (controls?.vehicleFeature === this) controls.stopVehicle?.()
  }

  private distanceFromParkSq() {
    if (!this.mesh) return 0
    const park = (this.description.position as [number, number, number]) || [0, 0, 0]
    const dx = this.mesh.position.x - park[0]
    const dy = this.mesh.position.y - park[1]
    const dz = this.mesh.position.z - park[2]
    return dx * dx + dy * dy + dz * dz
  }

  private isDriverPresent(uuid: string) {
    const c = window.connector
    if (!c) return false
    if (uuid === c.persona?.uuid) return c.controls?.vehicleFeature === this
    if (Date.now() - this.lastDriveStateAt < STALE_DRIVER_MS) return true
    return c.avatarsByUuid?.has(uuid) ?? false
  }

  private scheduleEmptyRecall(waitMs = EMPTY_RECALL_MS) {
    this.clearEmptyRecall()
    const emptySince = this.emptySince || Date.now()
    const remaining = Math.max(0, waitMs - (Date.now() - emptySince))
    this.emptyRecallTimer = setTimeout(() => {
      this.emptyRecallTimer = null
      if (this.driverUuid) return
      this.recallToPark()
    }, remaining)
  }

  private clearEmptyRecall() {
    if (this.emptyRecallTimer) {
      clearTimeout(this.emptyRecallTimer)
      this.emptyRecallTimer = null
    }
  }

  private scheduleStaleDriverCheck() {
    this.clearStaleDriverCheck()
    this.staleDriverTimer = setTimeout(() => {
      this.staleDriverTimer = null
      if (!this.driverUuid) return
      if (this.isDriverPresent(this.driverUuid)) return this.scheduleStaleDriverCheck()
      this.recallToPark()
    }, STALE_DRIVER_MS)
  }

  private clearStaleDriverCheck() {
    if (this.staleDriverTimer) {
      clearTimeout(this.staleDriverTimer)
      this.staleDriverTimer = null
    }
  }

  private maybeRecoverAbandoned() {
    if (!this.mesh) return
    if (this.driverUuid) {
      if (!this.isDriverPresent(this.driverUuid)) this.scheduleStaleDriverCheck()
      return
    }
    if (!this.emptySince && !this.isAwayFromPark()) return
    const wait = this.isAwayFromPark() ? 8_000 : EMPTY_RECALL_MS
    if (this.emptySince && Date.now() - this.emptySince >= wait) this.recallToPark()
    else if (this.emptySince || this.isAwayFromPark()) {
      if (!this.emptySince) this.emptySince = Date.now()
      this.scheduleEmptyRecall(wait)
    }
  }

  override receiveState(state: Record<string, any>) {
    if (!state || typeof state !== 'object') return
    if (state.driverUuid) this.lastDriveStateAt = Date.now()
    if ('driverUuid' in state) {
      const next = state.driverUuid || null
      const wasUs = this.driverUuid === window.connector?.persona?.uuid
      this.driverUuid = next
      this.emptySince = state.emptySince ?? (next ? null : this.emptySince)
      this.setParkedVisible(!next)
      if (next) this.hideDriveGui()
      else if (this.driveTrigger?.triggered) this.showDriveGui()
      if (wasUs && next && next !== window.connector?.persona?.uuid) {
        ;(window.connector?.controls as any)?.stopVehicle?.()
      }
      if (next) {
        this.clearEmptyRecall()
        this.scheduleStaleDriverCheck()
      } else if (state.emptySince) {
        this.scheduleEmptyRecall(this.isAwayFromPark() ? 8_000 : EMPTY_RECALL_MS)
      }
    }
    if (state.recall || (state.position && !this.driverUuid)) {
      if (Array.isArray(state.position) && Array.isArray(state.rotation)) {
        this.applyDrivePose(state.position as [number, number, number], state.rotation as [number, number, number])
      }
    }
    this.maybeRecoverAbandoned()
  }

  override dispose() {
    if (this.mesh && (!this.driverUuid || !this.isDriverPresent(this.driverUuid!)) && this.isAwayFromPark()) {
      try {
        const pos = (this.description.position as [number, number, number]) || [0, 0, 0]
        const rot = (this.description.rotation as [number, number, number]) || [0, 0, 0]
        this.driverUuid = null
        this.emptySince = null
        this.broadcastDriveState({ recall: true, position: pos, rotation: rot, driverUuid: null, emptySince: null })
      } catch {}
    }
    this.clearEmptyRecall()
    this.clearStaleDriverCheck()
    this.hideDriveGui()
    super.dispose()
  }
}

const EMPTY_RECALL_MS = 30_000
const STALE_DRIVER_MS = 15_000

Ride.Editor = class RideEditor extends Editor {
  constructor(props: FeatureEditorProps<VoxModel>) {
    super(props)
    this.state = {
      ...this.state,
      flyable: !!(props.feature.description as any).flyable,
      collidable: true,
    }
  }

  componentDidUpdate() {
    this.merge({
      link: this.state.link,
      cubescale: this.state.cubescale,
      collidable: true,
      flyable: !!this.state.flyable,
    } as any)
  }

  render() {
    return (
      <section>
        <Toolbar feature={this.props.feature} scene={this.props.scene} />
        <EditorProps>
          <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
          <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
          <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />
          {!!this.importError && (
            <dd class="full">
              <Panel type="danger">{this.importError}</Panel>
            </dd>
          )}
          <UrlSourceVoxModels feature={this.props.feature} scene={this.props.scene} />

          <Advanced>
            <Animation feature={this.props.feature} />
            <FeatureID feature={this.props.feature} />
            <Hyperlink feature={this.props.feature} />

            <dt>flyable</dt>
            <dd>
              <input type="checkbox" name="flyable" checked={!!this.state.flyable} onChange={(e) => this.setState({ flyable: e.currentTarget.checked })} />
              <small> hovercraft mode - Space / PageUp climb, V / PageDown dive.</small>
            </dd>
            <dd class="full">
              <small>
                seated? press <em>G</em> to adjust where you sit - saves for everyone. <em>T</em> flips facing.
              </small>
            </dd>
            <dd class="full">
              <button
                type="button"
                onClick={() => {
                  ;(this.props.feature as any).recallToPark?.()
                }}
              >
                bring back
              </button>
              <small> reset to the saved park spot (kicks a driver if needed).</small>
            </dd>

            <dt>Enable Collision</dt>
            <dd>
              <input type="checkbox" name="collidable" disabled checked />
            </dd>

            <Behaviours feature={this.props.feature} />
          </Advanced>
        </EditorProps>
      </section>
    )
  }
} as typeof Editor
