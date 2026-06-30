import { voxImporter } from '../../common/vox-import/vox-import'
import { Feature3D } from './feature'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Sound, Toolbar } from '../ui/features'
import { ButtonRecord } from '../../common/messages/feature'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'

export default class Button extends Feature3D<ButtonRecord> {
  static metadata: FeatureMetadata = {
    title: 'Button',
    subtitle: 'scripting trigger',
    type: 'button',
    image: '/icons/button.png',
  }

  static template: FeatureTemplate = {
    type: 'button',
    scale: [0.5, 0.5, 0.5],
    text: 'A',
  }

  whatIsThis() {
    return <label>A button that can be clicked to trigger a script.</label>
  }

  async generate() {
    let url = 'button'

    if (this.description.color && ['white', 'red', 'green', 'blue'].indexOf(this.description.color) > -1) {
      url += `-${this.description.color}`
    }

    const mesh = await voxImporter().import(process.env.ASSET_PATH + '/models/' + url + '.vox', { signal: this.abortController.signal })
    mesh.isPickable = true

    // we wait until after vox import has finished before destroying the previous one to make sure
    // that if generate gets called quickly before import has finished, we don't end up with duplicate meshes
    if (this.mesh) {
      this.mesh.dispose()
    }
    this.mesh = mesh
    this.mesh.id = this.uniqueEntityName('mesh')
    // this.mesh.scaling.set(1, 1, 1)
    this.mesh.position.y -= 0.2 * this.mesh.scaling.y
    this.afterGenerate()
    return Promise.resolve()
  }

  afterGenerate() {
    this.setCommon()
    this.addEvents()
  }

  onClick() {
    if (this.behaviours) {
      this.behaviours.dispatch(this.uuid, 'click')
    }

    if (this.description.soundId) {
      const soundId = typeof this.description.soundId === 'number' ? this.description.soundId : parseInt(this.description.soundId)
      if (!isNaN(soundId)) this.playSound(soundId)
    }

    this.animate()
  }

  animate() {
    const DURATION = 10

    if (!this.animation && this.mesh) {
      const y = this.mesh.scaling.y
      this.animation = new BABYLON.Animation('button-press', 'scaling.y', 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE)

      const keys = []

      keys.push({ frame: 0, value: y * 0.8 })
      keys.push({ frame: DURATION, value: y })

      this.animation.setKeys(keys)

      this.mesh.animations = []
      this.mesh.animations.push(this.animation)
    }

    this.scene.beginAnimation(this.mesh, 0, DURATION, false)
  }

  toString() {
    return `[${this.description.color || 'red'} button]`
  }
}

class Editor extends FeatureEditor<Button> {
  constructor(props: FeatureEditorProps<Button>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      color: props.feature.description.color,
    }
  }

  componentDidUpdate() {
    this.merge({
      color: this.state.color,
    })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Button</h2>
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
              <label>Color</label>
              <select value={this.state.color || 'red'} onChange={(e) => this.setState({ color: e.currentTarget.value })}>
                <option value="red">Red</option>
                <option value="green">Green</option>
                <option value="blue">Blue</option>
                <option value="white">White</option>
              </select>
            </div>
            <Advanced>
              <FeatureID feature={this.props.feature} />
              <Sound feature={this.props.feature} />
              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Button.Editor = Editor
