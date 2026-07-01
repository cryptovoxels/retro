import { TextInputRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, SpecularColorSetting, Toolbar } from '../ui/features'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D } from './feature'

export default class TextInput extends Feature2D<TextInputRecord> {
  static metadata: FeatureMetadata = {
    title: 'Text input',
    subtitle: 'Allow user input!',
    type: 'text-input',
    image: '/icons/text-input.png',
  }
  static template: FeatureTemplate = {
    type: 'text-input',
    scale: [1, 0.25, 0],
  }
  input: BABYLON.GUI.InputText | null = null

  toString() {
    return this.description.placeholder || super.toString()
  }

  shouldBeInteractive(): boolean {
    return true
  }

  whatIsThis() {
    return <label>Allow users to enter a text input. Useful for scripting.</label>
  }

  generate() {
    const plane = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    const texture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(plane, 512, 128)
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = texture

    material.specularColor.fromArray(this.description.specularColor || [1, 1, 1])

    material.zOffset = -5
    material.blockDirtyMechanism = true
    plane.material = material

    const input = new BABYLON.GUI.InputText()
    input.width = 1
    input.maxWidth = 1
    input.height = '80px'
    input.fontSize = 38
    input.text = ''
    input.fontFamily = `'helvetica neue', sans-serif`
    input.placeholderText = this.description.placeholder || ''
    input.placeholderColor = '#aaaaaa'
    input.color = '#333333'
    input.background = 'white'
    input.focusedBackground = '#f3f3f3'
    input.onTextChangedObservable.add(() => this.onChanged())
    this.input = input

    texture.addControl(input)

    this.mesh = plane
    this.setCommon()

    return Promise.resolve()
  }

  onChanged() {
    if (this.behaviours) {
      this.behaviours.dispatch(this.uuid, 'changed', { text: this.input?.text || '' })
    }
  }
}

class Editor extends FeatureEditor<TextInput> {
  constructor(props: FeatureEditorProps<TextInput>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      placeholder: props.feature.description.placeholder,
    }
  }

  componentDidUpdate() {
    this.merge({
      placeholder: this.state.placeholder,
    })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Text Input</h2>
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

            <FeatureID feature={this.props.feature} />

            <div className="f">
              <label>Placeholder</label>
              <input value={this.state.placeholder} onInput={(e) => this.setState({ placeholder: e.currentTarget.value })} type="text" />
            </div>
            <Advanced>
              <SpecularColorSetting feature={this.props.feature} />

              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

TextInput.Editor = Editor
