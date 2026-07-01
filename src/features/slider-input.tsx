import { throttle } from 'lodash'
import { SliderInputRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, SpecularColorSetting, Toolbar } from '../ui/features'
import { tidyFloat } from '../utils/helpers'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D } from './feature'

export default class SliderInput extends Feature2D<SliderInputRecord> {
  static metadata: FeatureMetadata = {
    title: 'Slider input',
    subtitle: 'Input value within a range.',
    type: 'slider-input',
    image: '/icons/slider-input.png',
  }
  static template: FeatureTemplate = {
    type: 'slider-input',
    scale: [1, 0.25, 0],
  }
  input: BABYLON.GUI.Slider | null = null
  grid: BABYLON.GUI.Grid | null = null

  get currentValue() {
    return this.input?.value || 0
  }

  toString() {
    return `[Slider: ${this.description.text}]`
  }

  whatIsThis() {
    return <label>Allow users to enter a numbered input within a range. Useful for scripting.</label>
  }

  generate() {
    const plane = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    const texture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(plane, 512, 128)
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = texture

    material.specularColor.fromArray(this.description.specularColor || [1, 1, 1])

    material.zOffset = -6
    material.blockDirtyMechanism = true
    plane.material = material

    // Used by controls.ts to suppress the blocking of move events
    plane.metadata = { captureMoveEvents: true }

    // Create grid for the GUI
    this.grid = new BABYLON.GUI.Grid()
    texture.addControl(this.grid)
    this.grid.addColumnDefinition(1)

    this.grid.addRowDefinition(0.5)
    this.grid.addRowDefinition(0.5)

    if (this.description.text) {
      const header = new BABYLON.GUI.TextBlock()
      header.text = this.description.text
      header.height = '30px'
      header.color = 'white'
      header.fontSize = 38
      header.fontFamily = `'helvetica neue', sans-serif`
      this.grid.addControl(header, 0, 0)
    }

    const input = new BABYLON.GUI.Slider()
    input.width = 1
    input.minimum = this.description.minimum || 0.01
    input.maximum = this.description.maximum || 100
    input.value = this.description.default || 25
    input.height = '80px'
    input.fontSize = 38
    input.fontFamily = `'helvetica neue', sans-serif`
    input.color = '#333333'
    input.background = 'white'
    input.onValueChangedObservable.add(() => this.onChanged())

    // HACK: supress the pointer events (value selection) for right-mouse click
    // Observables are unable to disable Babylon's built-in slider behvaiour
    const origPointerDown = input._onPointerDown.bind(input)
    input._onPointerDown = (target, coordinates, pointerId, buttonIndex, pi): boolean => {
      if (buttonIndex === 0) {
        return origPointerDown(target, coordinates, pointerId, buttonIndex, pi)
      }
      return false
    }

    this.input = input

    this.grid.addControl(input, 1, 0)

    this.mesh = plane
    this.setCommon()

    return Promise.resolve()
  }

  dispose() {
    this.grid?.dispose()
    this.grid = null
    this._dispose()
  }

  onChanged() {
    if (this.behaviours) {
      this.behaviours.dispatch(this.uuid, 'changed', { value: this.input?.value || 0 })
    }
  }
}

class Editor extends FeatureEditor<SliderInput> {
  update: (c: { text?: string; minimum?: string; maximum?: string; default?: string }) => void

  constructor(props: FeatureEditorProps<SliderInput>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      minimum: tidyFloat(props.feature.description.minimum, 0),
      maximum: tidyFloat(props.feature.description.maximum, 100),
      default: tidyFloat(props.feature.description.default, 25),
      text: props.feature.description.text,
    }
    this.update = throttle(
      (dict) => {
        this.setState(dict)
      },
      100,
      { leading: false, trailing: true },
    )
  }

  componentDidUpdate() {
    let defaultValue = parseFloat(this.state.default)
    if (defaultValue > parseFloat(this.state.maximum)) {
      defaultValue = parseFloat(this.state.maximum)
    } else if (defaultValue < parseFloat(this.state.minimum)) {
      defaultValue = parseFloat(this.state.minimum)
    }
    this.merge({
      minimum: parseFloat(this.state.minimum) > parseFloat(this.state.maximum) ? 0 : parseFloat(this.state.minimum),
      maximum: parseFloat(this.state.maximum) < parseFloat(this.state.minimum) ? 100 : parseFloat(this.state.maximum),
      default: defaultValue,
      text: this.state.text,
    })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Slider Input</h2>
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
              <label>Text</label>
              <input value={this.state.text} onInput={(e) => this.update({ text: e.currentTarget.value })} type="text" />
            </div>
            <div className="f">
              <label>Minimum</label>
              <input value={this.state.minimum} onInput={(e) => this.update({ minimum: e.currentTarget.value })} type="number" maxLength={10} />
            </div>
            <div className="f">
              <label>Maximum</label>
              <input value={this.state.maximum} onInput={(e) => this.update({ maximum: e.currentTarget.value })} type="number" maxLength={10} />
            </div>
            <div className="f">
              <label>Default</label>
              <input value={this.state.default} onInput={(e) => this.update({ default: e.currentTarget.value })} type="number" maxLength={10} />
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

SliderInput.Editor = Editor
