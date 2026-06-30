import { Feature3D, MeshExtended } from './feature'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, FeatureID, SpecularColorSetting, Toolbar, UrlSourceImages } from '../ui/features'
import { Position, Rotation, Scale, EditorProps } from '../../web/src/components/editor'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import type { AssetRecord } from '../../common/messages/feature'

export default class Asset extends Feature3D<AssetRecord> {
  static metadata: FeatureMetadata = {
    title: 'Asset',
    subtitle: 'A asset',
    type: 'asset',
    image: '/icons/cube.png',
  }

  static template: FeatureTemplate = {
    type: 'asset',
    scale: [0.5, 0.5, 0.5],
  }

  async generate() {
    this.mesh = BABYLON.MeshBuilder.CreateBox(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    this.mesh.isPickable = true

    const mat = new BABYLON.StandardMaterial('asset/material', this.scene)
    mat.diffuseColor.set(1, 0, 1)
    this.mesh.material = mat
  }

  whatIsThis() {
    return <label>This is a generic asset that can be used in the scene.</label>
  }
}

class Editor extends FeatureEditor<Asset> {
  constructor(props: FeatureEditorProps<Asset>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
    }
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Asset</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={this.props.feature} scene={this.props.scene} />
          <EditorProps>
            <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
            <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
            <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />
          </EditorProps>
        </div>
      </section>
    )
  }
}

Asset.Editor = Editor
