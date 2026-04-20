import type { FeatureTrigger } from './feature'
import { Feature3D } from './feature'
import {
  Advanced,
  Animation,
  CollectibleTryBone,
  CollectibleTryPosition,
  CollectibleTryRotation,
  CollectibleTryScale,
  FeatureEditor,
  FeatureEditorProps,
  FeatureID,
  SetParentDropdown,
  Toolbar,
  UrlSourceCollectibleModels,
  UuidReadOnly,
} from '../ui/features'
import showCollectibleHTMLUi from '../ui/html-ui/collectible-ui'
import { app } from '../../web/src/state'
import { CollectibleInfoRecord, CollectibleModelRecord } from '../../common/messages/feature'
import { defaultBone } from '../../web/types'
import ActionGui from '../ui/gui/action-button-gui'
import { CostumeAttachment } from '../../common/messages/costumes'
import Config from '../../common/config'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Position, Rotation, Scale, Script } from '../../web/src/components/editor'

interface CollectibleModelSharedState {
  wornBy: string | null
}

const COLLECTIBLE_MODEL_TYPE = 'collectible-model'

export default class CollectibleModel extends Feature3D<CollectibleModelRecord> {
  static metadata: FeatureMetadata = {
    title: 'Collectible Model',
    subtitle: '.vox collectible',
    type: COLLECTIBLE_MODEL_TYPE,
    image: '/icons/collectible-model.png',
  }
  static template: FeatureTemplate = {
    type: COLLECTIBLE_MODEL_TYPE,
    scale: [1, 1, 1],
    url: '',
  }
  sharedState: CollectibleModelSharedState = { wornBy: null }
  lastAvatarId: string | null = null
  proximityTrigger: FeatureTrigger | null = null
  refreshAvatarsIntervalHandle: NodeJS.Timeout | null = null
  ActionGui: ActionGui | null = null

  get collectible(): CollectibleInfoRecord | undefined {
    // collectible props is set via UrlSourceCollectibleModels in Editor.
    return this.description.collectible
  }

  get url() {
    return this.collectible ? 'https://www.voxels.com/w/' + this.collectible.hash + '/vox' : undefined
  }

  get shouldShowTryOnPopup() {
    return !!this.description.showTryOnPopUp
  }

  get collectibleUuid() {
    return 'try-' + this.uuid
  }

  get currentAvatar() {
    const wornBy = this.sharedState.wornBy

    const avatar = wornBy && this.connector.findAvatar(wornBy)
    if (avatar && this.parcel.contains(avatar.position)) {
      return avatar
    }
  }

  toString() {
    return this.collectible ? this.collectible.name + ' / ' + this.collectible.collection_name : 'Collectible Model [' + this.uuid + ']'
  }

  whatIsThis() {
    return <label>This feature allows you to display a Voxels collectible you own</label>
  }

  dispose() {
    this.refreshAvatarsIntervalHandle && clearInterval(this.refreshAvatarsIntervalHandle)
    this.hideGUI()
    this._dispose()
  }

  async onError() {
    if (this.disposed) return

    const mesh = await this.scene.importVox(`https://www.voxels.com/models/vox-five-broken.vox`, { signal: this.abortController.signal })

    if (this.mesh) {
      this.mesh.dispose()
    }

    this.mesh = mesh
    this.mesh.isPickable = true
    this.mesh.name = 'feature/collectible-model'
    this.mesh.id = this.uniqueEntityName('mesh')
    this.setCommon()
    this.addEvents()

    this.afterGenerate()
  }

  async generate() {
    let url: string

    if (this.url) {
      url = Config.voxModelURL(this.url, this.parcel, 'collectible-model')
    } else {
      url = `${process.env.ASSET_PATH}/models/shopping-bag.vox`
    }
    let mesh
    try {
      mesh = await this.scene.importVox(url, { signal: this.abortController.signal })
    } catch (e) {
      await this.onError()
      return Promise.resolve()
    }

    // we wait until after vox import has finished before destroying the previous one to make sure
    // that if generate gets called quickly before import has finished, we don't end up with duplicate meshes
    if (this.mesh) {
      this.mesh.dispose()
    }

    this.mesh = mesh
    this.mesh.isPickable = true

    // this is set later by refreshCollisions
    this.mesh.checkCollisions = false

    this.mesh.name = 'feature/collectible-model'
    this.mesh.id = this.uniqueEntityName('mesh')
    this.afterGenerate()

    if (this.mesh.material) {
      this.mesh.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND
    }

    this.refreshAvatarsIntervalHandle = setInterval(() => {
      // we manually refresh the broadcast stream every 1 second in case the avatar has not loaded at the start, or the avatar
      // leaves without ending broadcast (somehow??!)
      // basically, this makes sure we get a stream (eventually)
      this.refreshAvatars()
    }, 2000)

    if (this.collectible && !!this.description.tryable) {
      this.proximityTrigger = this.addTrigger({ proximityToTrigger: 3.5, onTrigger: this.onTrigger, onUnTrigger: this.onUnTrigger })
    }

    return Promise.resolve()
  }

  onTrigger = () => {
    if (this.collectible) {
      this.showGUI()
    }
  }

  onUnTrigger = () => {
    // Don't hide "Take off Collectible" if the user is currently wearing it.
    if (!this.currentAvatar?.isUser) {
      this.hideGUI()
    }
  }

  afterGenerate() {
    this.setCommon()
    this.addEvents()
    this.addAnimation()
  }

  async toggleUI() {
    this.collectible && showCollectibleHTMLUi(this, this.scene)
  }

  showGUI = () => {
    if (this.ActionGui) return
    this.ActionGui = new ActionGui(this)

    this.updateGUI()
  }

  hideGUI = () => {
    if (!this.ActionGui) return
    this.ActionGui.dispose()
    this.ActionGui = null
  }

  tryOnCollectible() {
    if (!this.avatar || this.avatar === this.currentAvatar) return

    this.sendState({ wornBy: this.avatar.uuid })
    this.refreshAvatars()

    this.connector.controls.enterThirdPerson()
    app.showSnackbar('Press C to switch back to first person')
  }

  createAttachment() {
    const token_id = this.collectible?.token_id
    const collection_id = this.collectible?.collection_id

    let rotation = [0, 0, 0]
    if (this.description.tryRotation) {
      // collectible rotation is saved in radians
      rotation = [BABYLON.Angle.FromRadians(this.description.tryRotation[0]).degrees(), BABYLON.Angle.FromRadians(this.description.tryRotation[1]).degrees(), BABYLON.Angle.FromRadians(this.description.tryRotation[2]).degrees()]
    }

    return {
      uuid: this.collectibleUuid,
      wearable_id: token_id,
      collection_id: collection_id,
      chain_id: this.collectible?.chain_id || 1,
      collection_address: this.collectible?.collection_address || '',
      bone: this.description.tryBone || defaultBone(this.collectible),
      position: this.description.tryPosition || [0, 0, 0],
      rotation,
      scaling: this.description.tryScale || [0.5, 0.5, 0.5],
    } as CostumeAttachment
  }

  receiveState(state: CollectibleModelSharedState) {
    this.sharedState = state
    this.refreshAvatars()
  }

  sendState(state: CollectibleModelSharedState) {
    this.sharedState = state
    this.parcel.sendStatePatch({ [this.uuid]: this.sharedState })
  }

  refreshAvatars() {
    if (!this.sharedState) return

    const avatar = this.currentAvatar
    const lastAvatar = this.lastAvatarId && this.connector.findAvatar(this.lastAvatarId)
    if (this.mesh) {
      this.mesh.visibility = avatar ? 0 : 1
    }
    if (this.lastAvatarId != avatar?.uuid) {
      // Update on state change
      this.updateGUI()
    }

    if (avatar === lastAvatar) return

    if (lastAvatar && lastAvatar.attachmentManager) {
      lastAvatar.attachmentManager.remove(this.collectibleUuid)
      this.lastAvatarId = null
    }

    if (avatar && avatar.attachmentManager) {
      avatar.attachmentManager.wear(this.createAttachment())
      avatar.emote('✨')
      avatar.emote('✨', this.positionInGrid.subtractFromFloats(0, 1, 0))
      this.lastAvatarId = avatar.uuid
    }

    if (lastAvatar && !avatar) {
      // sparkles on put back collectible
      lastAvatar.emote('✨', this.positionInGrid.subtractFromFloats(0, 1, 0))
    }
  }

  takeOffCollectible() {
    this.hideGUI()

    if (!this.currentAvatar || !this.currentAvatar?.isUser) return

    this.sendState({ wornBy: null })
    this.refreshAvatars()
  }

  updateGUI = () => {
    if (!this.ActionGui) return
    this.ActionGui.listOfControls = []

    if (this.currentAvatar && !this.currentAvatar?.isUser) {
      this.hideGUI()
      return
    }

    if (!this.currentAvatar && this.shouldShowTryOnPopup) {
      const text = `Try on wearable`
      this.ActionGui.addButton(text, { positionInGrid: [0, 0], onClick: this.tryOnCollectible.bind(this), height: '50px' })
    } else if (this.currentAvatar?.isUser) {
      let text = `Take off wearable`
      text = text.length > 22 ? text.substring(0, 20) + '...' : text
      this.ActionGui.addButton(text, { positionInGrid: [0, 0], onClick: this.takeOffCollectible.bind(this), height: '50px' })
    }

    this.ActionGui.refresh()
  }

  // On click show the HTML UI (not the GUI)
  onClick() {
    this.toggleUI()
  }

  // On exit the parcel, remove collectible
  onExit = () => {
    this.takeOffCollectible()
  }

  nudge() {
    return -0.02
  }

  shouldBeInteractive(): boolean {
    return !!this.collectible
  }
}

class Editor extends FeatureEditor<CollectibleModel> {
  constructor(props: FeatureEditorProps<CollectibleModel>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      loading: false,
      tryable: !!props.feature.description.tryable,
      tryPosition: props.feature.description.tryPosition,
      tryRotation: props.feature.description.tryRotation,
      tryScale: props.feature.description.tryScale,
      tryBone: props.feature.description.tryBone || 'Head',
      showTryOnPopUp: !!props.feature.description.showTryOnPopUp,
    }
  }

  componentDidUpdate() {
    this.merge({ tryable: this.state.tryable, showTryOnPopUp: this.state.showTryOnPopUp })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Collectible Model</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={this.props.feature} scene={this.props.scene} />
          {/* keys are provided so that the getState in the component is reset after gizmo is used */}
          <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
          <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
          <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />

          <UrlSourceCollectibleModels feature={this.props.feature} />

          <Advanced>
            <FeatureID feature={this.props.feature} />
            <SetParentDropdown feature={this.props.feature} />
            {!this.props.scene.config.isSpace && (
              <div className="f">
                <label>Interactivity Options</label>
                <label>
                  <input checked={this.state.tryable} onInput={(e) => this.setState({ tryable: e.currentTarget.checked })} type="checkbox" />
                  <small>Allow parcel visitors to try on collectible</small>
                </label>
              </div>
            )}
            {this.state.tryable && !this.props.scene.config.isSpace && (
              <div className="sub-f">
                <div className="f">
                  <label>Pop up</label>
                  <label>
                    <input checked={!!this.state.showTryOnPopUp} onInput={(e) => this.setState({ showTryOnPopUp: e.currentTarget.checked })} type="checkbox" />
                    <small>Shows a 'Try on' popup when nearby</small>
                  </label>
                </div>
                <CollectibleTryBone feature={this.props.feature} scene={this.props.parcel.scene} />
                <CollectibleTryPosition feature={this.props.feature} />
                <CollectibleTryRotation feature={this.props.feature} />
                <CollectibleTryScale feature={this.props.feature} />
              </div>
            )}
            <Animation feature={this.props.feature} />
            <UuidReadOnly feature={this.props.feature} />
            <Script feature={this.props.feature} />
          </Advanced>
        </div>
      </section>
    )
  }
}

CollectibleModel.Editor = Editor
