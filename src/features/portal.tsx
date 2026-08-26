import { PortalRecord } from '../../common/messages/feature'
import { voxFromFill } from '../../common/voxels/vox-from-fill'
import { Position, Rotation, Scale, EditorProps } from '../../web/src/components/editor'
import { AudioBus } from '../audio/audio-engine'
import { fetchTexture } from '../textures/textures'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar, SourceInput } from '../ui/features'
import PortalTeleportGUI from '../ui/gui/portal-gui'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature3D, FeatureTrigger } from './feature'

const DIAMOND = Math.PI / 4
const SPIN_FRAMES = 600

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
  static outlineMesh: BABYLON.Mesh | null = null

  sound: BABYLON.Sound | null = null
  proximityTrigger: FeatureTrigger | null = null
  _teleportGUI: PortalTeleportGUI | null = null
  outline: BABYLON.Mesh | null = null
  spinAnim: BABYLON.Animatable | null = null

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
    return !this.description.womp.space_id ? `/play?coords=${this.description.womp.coords}` : `/spaces/${this.description.womp.space_id}`
  }

  static getOutlineMesh(scene: BABYLON.Scene) {
    if (!Portal.outlineMesh) {
      Portal.outlineMesh = voxFromFill(
        [16, 16, 16],
        // Outline all 12 edges of the cube: return 1 for any voxel on any edge.
        (x, y, z, w, h, d) => {
          // a cube has edges where two coordinates are constant (either 0 or max-1), and the third varies
          let onEdge =
            ((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) || // z varies (edges parallel to z)
            ((x === 0 || x === w - 1) && (z === 0 || z === d - 1)) || // y varies (edges parallel to y)
            ((y === 0 || y === h - 1) && (z === 0 || z === d - 1)) // x varies (edges parallel to x)

          return onEdge ? 1 : 0
        },
        scene,
      )
      Portal.outlineMesh.name = 'portal-outline'
      Portal.outlineMesh.isVisible = false
      Portal.outlineMesh.isPickable = false
      const mat = new BABYLON.StandardMaterial('portal-outline', scene)
      mat.diffuseColor.set(1, 1, 1)
      mat.emissiveColor.set(0.8, 0.8, 0.9)
      mat.specularColor.set(0, 0, 0)
      mat.linkEmissiveWithDiffuse = true // so vertex AO darkens the emissive look
      mat.freeze()
      Portal.outlineMesh.material = mat
    }
    return Portal.outlineMesh
  }

  toString() {
    return 'Portal:' + this.description.url
  }

  whatIsThis() {
    return <label>A portal cube that uses Womps you've taken in the past.</label>
  }

  async generate() {
    this.description.isTrigger = true
    // How close you have to be for trigger to trigger. (minimum 1.76)
    this.description.proximityToTrigger = 2

    this.mesh = BABYLON.MeshBuilder.CreateBox(this.uniqueEntityName('mesh'), { size: 0.45 }, this.scene)
    this.mesh.isPickable = true
    this.mesh.onAfterWorldMatrixUpdateObservable.add(this.updateAfterWorldOffsetChange)

    this.attachOutline()
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

  attachOutline() {
    if (!this.mesh || this.outline) return
    this.outline = Portal.getOutlineMesh(this.scene).clone(`feature/portal/outline/${this.uuid}`)!
    this.outline.isVisible = true
    this.outline.isPickable = false
    this.outline.setParent(this.mesh)
    this.outline.position.setAll(0)
    this.outline.rotation.setAll(0)
    this.outline.scaling.setAll(0.5)
  }

  startSpin() {
    if (!this.mesh) return
    this.spinAnim?.stop()
    const baseY = this.rotation.y
    this.mesh.rotation.x = this.rotation.x + DIAMOND
    this.mesh.rotation.z = this.rotation.z + DIAMOND
    this.mesh.rotation.y = baseY

    const spin = new BABYLON.Animation('portal-spin', 'rotation.y', 30, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE)
    spin.setKeys([
      { frame: 0, value: baseY },
      { frame: SPIN_FRAMES, value: baseY + Math.PI * 2 },
    ])
    this.mesh.animations = [spin]
    this.spinAnim = this.scene.beginAnimation(this.mesh, 0, SPIN_FRAMES, true)
  }

  shouldBeInteractive(): boolean {
    return !!this.description.womp
  }

  /**
   * Portal womps tagged with space_id leave the world client.
   */
  isPortalToAnotherRealm(): boolean {
    return !!this.description.womp?.space_id
  }

  onClick() {
    if (!this.description.womp) {
      return
    }

    if (this._teleportGUI && this.proximityTrigger?.triggered) {
      // We already triggered the GUI via proximity. If user clicks on the Mesh and not the Button of the GUI, we assume they want to teleport
      // but to be sure we ask the user.
      if (this.coordinatesUrl) {
        if (this.isPortalToAnotherRealm()) {
          if (confirm('Do you want to teleport to ' + this.parcelName + '?')) {
            window.ui?.openLink(this.coordinatesUrl)
          }
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
    this.startSpin()
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
    this.spinAnim?.stop()
    this.spinAnim = null
    if (this.outline) {
      this.outline.dispose(false, false)
      this.outline = null
    }
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

    material.alpha = 0.85
    material.specularColor.set(0.4, 0.4, 0.5)
    material.diffuseColor.set(0.05, 0.05, 0.1)
    material.emissiveColor.set(0.15, 0.15, 0.25)
    material.ambientColor.set(0.1, 0.1, 0.15)

    texture.hasAlpha = false
    texture.coordinatesMode = BABYLON.Texture.SPHERICAL_MODE
    texture.uScale = 0.25
    texture.vScale = 0.25
    material.reflectionTexture = texture
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
        <Toolbar feature={this.props.feature} scene={this.props.scene} />
        <EditorProps>
          {/* keys are provided so that the getState in the component is reset after gizmo is used */}
          <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
          <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
          <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />

          <div className="f">
            <label>To a functional portal, select a womp.</label>
          </div>

          <SourceInput feature={this.props.feature} accept="womp" />

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
      </section>
    )
  }
}

Portal.Editor = Editor
