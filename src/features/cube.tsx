import { CubeRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { fetchTexture } from '../textures/textures'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, FeatureID, SpecularColorSetting, Toolbar, UrlSourceImages } from '../ui/features'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature3D, MeshExtended } from './feature'

export default class Cube extends Feature3D<CubeRecord> {
  static metadata: FeatureMetadata = {
    title: 'Cube',
    subtitle: 'texturable cube',
    type: 'cube',
    image: '/icons/cube.png',
  }

  static template: FeatureTemplate = {
    type: 'cube',
    scale: [0.5, 0.5, 0.5],
    url: '',
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

  refreshCollidable() {
    if (this.mesh) {
      this.mesh.checkCollisions = this.withinBounds && !!this.description.collidable
    }
  }

  whatIsThis() {
    return <label>This is a simple cube that can be textured or colored. </label>
  }

  async generate() {
    this.mesh = BABYLON.MeshBuilder.CreateBox(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    this.mesh.isPickable = true

    // handle no-texture case
    if (!this.textureURL) {
      this.createMaterial()
      this.afterGenerate()
      return
    }

    // load texture and create material
    const texture = await fetchTexture(this.scene, this.textureURL, this.abortController.signal)
    texture.hasAlpha = false
    this.createMaterial(texture)

    this.afterGenerate()
  }

  afterSetCommon = () => {
    this.refreshCollidable()
  }

  async generateInstance(root: Cube) {
    if (!(root.mesh instanceof BABYLON.Mesh)) throw new Error('generateInstance must be called with root feature')

    // TODO the mesh type does not allow for an instanced mesh. The feature class hierarchy needs to be refactored to allow for this
    this.mesh = root.mesh.createInstance(this.uniqueEntityName('instance')) as unknown as MeshExtended

    this.afterGenerate()
  }

  afterGenerate() {
    if (this.disposed) return
    this.setCommon()
    this.addEvents()
    this.addAnimation()
  }

  /**
   * Create a material for the mesh;
   * @NOTE We re-create a new material when receiving the texture from the bucket because doing
   * mesh.material.diffuseTexture = texture wasn't working. (and unfreezing did not help)
   * @param texture BABYLON.BaseTexture
   */
  createMaterial = (texture?: BABYLON.BaseTexture) => {
    if (!this.mesh || this.disposed) {
      return
    }
    if (this.mesh.material) {
      this.mesh.material.dispose()
    }
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)

    material.specularColor.fromArray(this.description.specularColor || [1, 1, 1])
    if (this.description.color) {
      material.diffuseColor = BABYLON.Color3.FromHexString(this.description.color)
    }
    if (texture) {
      material.diffuseTexture = texture
    }
    material.blockDirtyMechanism = true
    this.mesh.material = material
  }

  toString() {
    return '[cube]'
  }
}

class Editor extends FeatureEditor<Cube> {
  constructor(props: FeatureEditorProps<Cube>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      color: props.feature.description.color || '#ffffff',
      collidable: props.feature.description.collidable,
    }
  }

  componentDidUpdate() {
    this.merge({
      color: this.state.color,
      collidable: this.state.collidable,
    })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Cube</h2>
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

            <UrlSourceImages feature={this.props.feature} />

            <Advanced>
              <FeatureID feature={this.props.feature} />
              <Animation feature={this.props.feature} />

              <div className="f">
                <form>
                  <label>
                    <input type="checkbox" name="collidable" onChange={(e) => this.setState({ collidable: e.currentTarget.checked })} checked={this.state.collidable}></input>
                    Enable Collision
                  </label>
                </form>
              </div>

              <div style={{ display: 'flex', justify: 'flex-start' }}>
                <div className="f">
                  <label>Tint</label>
                  <span>
                    <input type="color" value={this.state.color} onInput={(e) => this.setState({ color: e.currentTarget.value })} />
                  </span>
                </div>
                <SpecularColorSetting feature={this.props.feature} />
              </div>
              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Cube.Editor = Editor
