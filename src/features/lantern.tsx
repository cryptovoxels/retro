import { LanternRecord } from '../../common/messages/feature'
import { Position, Scale, EditorProps } from '../../web/src/components/editor'
import { createLanternMaterial } from '../materials'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { tidyFloat } from '../utils/helpers'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature3D } from './feature'

export default class Lantern extends Feature3D<LanternRecord> {
  static metadata: FeatureMetadata = {
    title: 'Lantern',
    subtitle: 'rgb light source',
    type: 'lantern',
    image: '/icons/lantern.png',
  }

  static template: FeatureTemplate = {
    type: 'lantern',
    scale: [0.5, 0.5, 0.5],
    rotation: [0, 0, 0],
    color: '#ff00aa',
  }

  get rotation() {
    return BABYLON.Vector3.Zero()
  }

  whatIsThis() {
    return <label>The lantern emits light of the selected color and intensity. For it to work you need to activate baking.</label>
  }

  generate() {
    this.mesh = BABYLON.MeshBuilder.CreateBox(this.uniqueEntityName('mesh'), { size: 0.5 }, this.scene)
    this.mesh.isPickable = true
    BABYLON.Tags.AddTagsTo(this.mesh, 'glow')

    this.setCommon()

    // Use dedicated lantern material
    const strength = this.description.strength ? parseFloat(String(this.description.strength)) : undefined
    this.mesh.material = createLanternMaterial(this.scene, {
      color: this.description.color || '#FFFFFF',
      strength,
    })

    return Promise.resolve()
  }

  override update(props: Partial<LanternRecord>) {
    super.update(props)

    // Update material if color or strength changed (material is cached, need to recreate)
    if (this.mesh && (props.color !== undefined || props.strength !== undefined)) {
      const strength = this.description.strength ? parseFloat(String(this.description.strength)) : undefined
      this.mesh.material = createLanternMaterial(this.scene, {
        color: this.description.color || '#FFFFFF',
        strength,
      })
    }
  }

  override _dispose() {
    // Call parent dispose
    super._dispose()
  }
}

class Editor extends FeatureEditor<Lantern> {
  constructor(props: FeatureEditorProps<Lantern>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      color: props.feature.description.color,
      strength: tidyFloat(props.feature.description.strength, 50),
    }
  }

  componentDidUpdate() {
    this.merge({
      color: this.state.color,
      strength: this.state.strength,
    })
  }

  updateStrength(strength: number) {
    // todo modify materiel emmissive value
    this.setState({ strength })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Lantern</h2>
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

            <div className="f">
              <label>Color</label>
              <input type="color" value={this.state.color} onInput={(e) => this.setState({ color: e.currentTarget.value })} />
            </div>

            <div className="f">
              <label>Strength: {this.state.strength}</label>
              <input type="range" min={1} max={100} value={this.state.strength} onInput={(e) => this.updateStrength(parseFloat(e.currentTarget.value))} />
            </div>

            <Advanced>
              <FeatureID feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Lantern.Editor = Editor
