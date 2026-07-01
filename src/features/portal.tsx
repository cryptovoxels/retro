import { PortalRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, EditorProps } from '../../web/src/components/editor'
import { AudioBus } from '../audio/audio-engine'
import { fetchTexture } from '../textures/textures'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar, UrlSourcePortalWomp } from '../ui/features'
import PortalTeleportGUI from '../ui/gui/portal-gui'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature3D, FeatureTrigger } from './feature'

export default class Portal extends Feature3D<PortalRecord> {
  static metadata: FeatureMetadata = {
    title: 'Portal',
    subtitle: 'teleporter to another parcel',
    type: 'portal',
    image: '/icons/portal.png',
  }
  static template: FeatureTemplate = {
    type: 'portal',
    scale: [0.6, 0.6, 0.6],
  }
  sound: BABYLON.Sound | null = null
  proximityTrigger: FeatureTrigger | null = null
  _teleportGUI: PortalTeleportGUI | null = null

  // fixme
  get audio() {
    return window._audio
  }

  get textureURL(): string | null {
    if (!this.url) {
      return null
    }
    try {
      return new URL(this.url).toString()
    } catch (e) {
      return null
    }
  }

  get parcelName() {
    const desc = this.description
    return desc.womp?.parcel_name || desc.womp?.parcel_address || desc.womp?.space_name || 'location'
  }

  get coordinatesUrl() {
    if (!this.description.womp) {
      return null
    }
    return !this.description.womp.space_id ? `/play?coords=${this.description.womp.coords}` : `/spaces/${this.description.womp.space_id}/play?coords=${this.description.womp.coords}`
  }

  toString() {
    return 'Portal:' + this.description.url
  }

  whatIsThis() {
    return <label>A spherical portal that uses Womps you've taken in the past.</label>
  }

  async generate() {
    this.description.isTrigger = true
    // How close you have to be for trigger to trigger. (minimum 1.76)
    this.description.proximityToTrigger = 3.5

    this.mesh = BABYLON.MeshBuilder.CreateSphere(this.uniqueEntityName('mesh'), { diameter: 1 }, this.scene)
    this.mesh.isPickable = true
    this.mesh.onAfterWorldMatrixUpdateObservable.add(this.updateAfterWorldOffsetChange)

    this.setCommon()

    const m = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    m.alpha = 0.1
    m.specularColor.set(0, 0, 0)
    m.blockDirtyMechanism = true
    this.mesh.material = m
    const texture = await fetchTexture(this.scene, this.textureURL, this.abortController.signal)
    this.renderImage(texture)

    this.addEvents()
    this.proximityTrigger = this.addTrigger({
      proximityToTrigger: 3.5,
      onTrigger: this.onTrigger.bind(this),
      onUnTrigger: this.onUnTrigger.bind(this),
    })
    return Promise.resolve()
  }

  shouldBeInteractive(): boolean {
    return !!this.description.womp
  }

  /**
   * Checks if the portal will send you to space from in-world or to in-world from Spaces
   * @returns boolean
   */
  isPortalToAnotherRealm(): boolean {
    return (!!this.description.womp?.space_id && !window.config.isSpace) || (!this.description.womp?.space_id && window.config.isSpace)
  }

  onClick() {
    if (!this.description.womp) {
      return
    }

    if (this._teleportGUI && this.proximityTrigger?.triggered) {
      // We already triggered the GUI via proximity. If user clicks on the Mesh and not the Button of the GUI, we assume they want to teleport
      // but to be sure we ask the user.
      if (this.coordinatesUrl && confirm('Do you want to teleport to ' + this.parcelName + '?')) {
        if (this.isPortalToAnotherRealm()) {
          window.ui?.openLink(this.coordinatesUrl)
        } else {
          window.persona.teleport(this.coordinatesUrl)
        }
      }
      // Don't toggle off GUI on-click if we triggered it via proximity.
      return
    }

    if (this._teleportGUI) {
      // toggle off
      this._teleportGUI.dispose()
      this._teleportGUI = null
      return
    }

    //We're far away from the Portal but we still clicked it: Show the teleportGUI.
    this._teleportGUI = new PortalTeleportGUI(this.scene, this)
    this._teleportGUI.generate()
  }

  afterSetCommon = () => {
    this.refreshSound()
    this._teleportGUI?.refresh()
  }

  refreshSound() {
    if (this.sound) {
      this.sound.dispose()
      this.sound = null
    }

    if (!this.description.playSound || !this.audio) return

    this.sound = this.audio.createSound({
      name: 'feature/portal',
      url: `${process.env.SOUNDS_URL}/features/portal-idle.wav`,
      outputBus: AudioBus.Parcel,
      options: {
        loop: true,
        autoplay: true,
        spatialSound: true,
        distanceModel: 'exponential',
        maxDistance: 10,
        rolloffFactor: 7,
        refDistance: 2,
        volume: 0.06,
      },
    })

    this.sound.setPosition(this.absolutePosition)
  }

  onTrigger() {
    if (!this.description.womp) {
      return
    }
    this._teleportGUI = new PortalTeleportGUI(this.scene, this)
    this._teleportGUI.generate()
  }

  onUnTrigger() {
    if (this._teleportGUI) {
      this._teleportGUI.dispose()
      this._teleportGUI = null
    }
  }

  updateAfterWorldOffsetChange = () => {
    if (!this.sound) {
      return
    }
    this.sound.setPosition(this.absolutePosition)
  }

  dispose() {
    if (this.sound) {
      this.sound.stop()
      this.sound.dispose()
      this.sound = null
    }
    if (this._teleportGUI) {
      this._teleportGUI.dispose()
      this._teleportGUI = null
    }

    this._dispose()
  }

  renderImage(texture: BABYLON.Texture) {
    if (!this.mesh) {
      return
    }
    this.mesh.material?.dispose()
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)

    material.alpha = 0.9
    material.specularColor.set(0, 0, 0.2)

    material.ambientColor.set(1, 1, 1)
    material.emissiveColor.set(0.7, 0.7, 1)
    material.diffuseColor.set(0.2, 0.2, 1)
    //material.emissiveColor.set(0.1, 0.1, 0.4)
    // images are inverted
    texture.hasAlpha = false
    texture.uScale = -1
    texture.vScale = -1
    material.diffuseTexture = texture
    material.blockDirtyMechanism = true

    this.mesh.material = material
  }
}

class Editor extends FeatureEditor<Portal> {
  constructor(props: FeatureEditorProps<Portal>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      url: props.feature.description.url,
      womp: props.feature.description.womp,
      playSound: !!props.feature.description.playSound,
    }
  }

  get selectedWomp() {
    return this.state.womp
  }

  componentDidUpdate() {
    this.merge({
      playSound: this.state.playSound,
    })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Portal</h2>
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

            <div className="f">
              <label>To a functional portal, select a womp.</label>
            </div>

            <UrlSourcePortalWomp feature={this.props.feature} />

            <div className="f">
              <label>Portal sound</label>
              <label>
                <input type="checkbox" checked={this.state.playSound} onChange={(e) => this.setState({ playSound: e.currentTarget.checked })} />
                Make sound
              </label>
            </div>

            {this.selectedWomp && (
              <div className="f">
                <label>Selected location:</label>
                <img src={this.state.url} width={50} height={50} title={this.selectedWomp.coords} />
                <dt>Parcel id</dt>
                <dd>{this.selectedWomp.parcel_id}</dd>
                <dt>Coordinates</dt>
                <dd>/play?coords={this.selectedWomp.coords}</dd>
                <dt>Created at</dt>
                <dd>{this.selectedWomp.created_at}</dd>
              </div>
            )}

            <Advanced>
              <FeatureID feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Portal.Editor = Editor
