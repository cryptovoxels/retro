import Config from '../../common/config'
import { MegavoxRecord, VoxModelRecord } from '../../common/messages/feature'
import { Options as VoxImportOptions, voxImporter } from '../../common/vox-import/vox-import'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import Panel from '../../web/src/components/panel'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, FeatureID, Hyperlink, Toolbar, UrlSourceVoxModels } from '../ui/features'
import { isURL } from '../utils/helpers'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature3D, FeatureEvent, MeshExtended, transformVectors } from './feature'

// used when "Scale To Grid" is enabled
const CUBESCALE_MULTIPLIER_X = 0.02
const CUBESCALE_MULTIPLIER_Y = 0.065
const CUBESCALE_SCALE_FACTOR = 1 / (0.02 * 32) / 2
const CUBESCALE_SCALE_FACTOR_RECIPROCAL = 1 / CUBESCALE_SCALE_FACTOR
const CUBESCALE_SCALE_FACTOR_VECTOR = new BABYLON.Vector3(CUBESCALE_SCALE_FACTOR, CUBESCALE_SCALE_FACTOR, CUBESCALE_SCALE_FACTOR)
const CUBESCALE_SCALE_FACTOR_RECIPROCAL_VECTOR = new BABYLON.Vector3(CUBESCALE_SCALE_FACTOR_RECIPROCAL, CUBESCALE_SCALE_FACTOR_RECIPROCAL, CUBESCALE_SCALE_FACTOR_RECIPROCAL)

const cubescaleOffset = (scale: [number, number, number]) => new BABYLON.Vector3(CUBESCALE_MULTIPLIER_X * scale[0], 0, CUBESCALE_MULTIPLIER_Y * scale[2])

export default class VoxModel<Description extends VoxModelRecord | MegavoxRecord = VoxModelRecord> extends Feature3D<Description> {
  static Editor: typeof Editor
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

  public override async generate() {
    let url: string

    if (this.url && isURL(this.url)) {
      url = Config.voxModelURL(this.url, this.parcel, this.type)
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
      await this.onError()
      this.refreshErrorMessage()
      return
    }

    // we wait until after vox import has finished before destroying the previous one to make sure
    // that if generate gets called quickly before import has finished, we don't end up with duplicate meshes
    if (this.mesh) {
      this.mesh.dispose()
    }

    this.mesh = mesh
    this.mesh.isPickable = true

    // this is set later by refreshCollidable()
    this.mesh.checkCollisions = false

    this.mesh.name = this.uniqueEntityName('mesh')
    this.mesh.id = this.mesh.name
    this.afterGenerate()
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
    if (this.disposed) return

    // Only show error voxel models to users with editing rights
    if (!this.parcel.canEdit) {
      // Clean up existing mesh if any
      if (this.mesh) {
        this.mesh.dispose()
        this.mesh = undefined as any
      }
      return
    }

    const mesh = await voxImporter().import(`${process.env.ASSET_PATH}/models/vox-five-broken.vox`, { signal: this.abortController.signal })

    if (this.mesh) {
      this.mesh.dispose()
    }

    this.mesh = mesh
    this.mesh.isPickable = true
    this.mesh.name = this.uniqueEntityName('mesh')
    this.mesh.id = this.mesh.name

    this.afterGenerate()
  }

  private refreshCollidable() {
    if (this.mesh) {
      this.mesh.checkCollisions = this.withinBounds && !!this.description.collidable
    }
  }

  private afterGenerate() {
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
        <header>
          <h2>Edit Vox Model</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
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
        </div>
      </section>
    )
  }
}

VoxModel.Editor = Editor

export class Megavox extends VoxModel<MegavoxRecord> {
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

  // Needed by VoxModel.generate()
  protected override _voxImportParams(): VoxImportOptions {
    return { ...super._voxImportParams(), sizeHint: this.scale, megavox: true }
  }
}

Megavox.Editor = Editor
