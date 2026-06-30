import { SignRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, Animation, BlendMode, FeatureEditor, FeatureEditorProps, FeatureID, Hyperlink, Toolbar } from '../ui/features'
import { tidyFloat } from '../utils/helpers'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D } from './feature'

export default class Sign extends Feature2D<SignRecord> {
  static canvas: HTMLCanvasElement

  static metadata: FeatureMetadata = {
    title: 'Sign',
    subtitle: 'single line of text',
    type: 'sign',
    image: '/icons/sign.png',
  }

  static template: FeatureTemplate = {
    type: 'sign',
    scale: [0.5, 0.5, 0],
    text: 'Text',
  }

  get fontSize(): number {
    return tidyFloat(this.description.fontSize, 32)
  }

  get color(): string {
    return this.description.color || (this.description.inverted ? '#ffffff' : '#000000')
  }

  get background(): string {
    return this.description.background || (this.description.inverted ? '#000000' : '#ffffff')
  }

  toString(): string {
    return this.description.text || ''
  }

  whatIsThis() {
    return <label>A single-line text feature. Does not support markdown. </label>
  }

  generate() {
    if (!Sign.canvas) {
      Sign.canvas = document.createElement('canvas')
    }

    const text = this.description.text

    const width = this.scale.x * 128 * 2
    const height = this.scale.y * 128 * 2

    Sign.canvas.width = width
    Sign.canvas.height = height

    // Make a dynamic texture
    const dynamicTexture = new BABYLON.DynamicTexture(this.uniqueEntityName('texture'), Sign.canvas, this.scene, true)
    dynamicTexture.hasAlpha = false

    const ctx = dynamicTexture.getContext() as CanvasRenderingContext2D // typeCast needed.

    const planeSize = dynamicTexture.getSize()
    ctx.textAlign = 'center'
    ctx.font = `${this.fontSize}px 'Helvetica Neue', sans-serif`
    ctx.fillStyle = this.background
    ctx.fillRect(0, 0, planeSize.width, height)

    ctx.fillStyle = this.color
    if (text) {
      ctx.fillText(text, planeSize.width / 2, height / 2 + 10)
    }

    if (this.isLink && text) {
      const w = ((text.length * this.fontSize) / 256) * 0.6
      ctx.fillRect(width / 2 - w * 128, 90, w * 128 * 4, 4)
    }

    dynamicTexture.update(true)

    const plane = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)

    material.diffuseColor.set(1, 1, 1)
    material.diffuseTexture = dynamicTexture
    material.alpha = 0.999
    material.zOffset = -8
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 1, 1)
    material.backFaceCulling = false
    material.freeze()

    if (this.blendMode === 'Multiply') {
      material.alphaMode = BABYLON.Engine.ALPHA_MULTIPLY
    } else if (this.blendMode === 'Screen') {
      material.alphaMode = BABYLON.Engine.ALPHA_SCREENMODE
    } else {
      material.emissiveColor.set(0, 0, 0)
    }

    material.blockDirtyMechanism = true
    plane.material = material
    this.mesh = plane
    this.setCommon()

    if (this.isLink) {
      this.addEvents()
    }

    this.addAnimation()

    return Promise.resolve()
  }

  onClick() {
    if (!this.description.link) throw new Error('No link')
    this.onClickLink(this.description.link)
  }

  calculateScale() {
    if (!this.description.text) {
      return [0.5, 0.5, 0.5]
    }

    let width = ((this.description.text.length * this.fontSize) / 256) * 0.6
    width = Math.max(width, 0.5)

    this.description.scale = [width, 0.5, 0.5]
  }
}

class Editor extends FeatureEditor<Sign> {
  constructor(props: FeatureEditorProps<Sign>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      text: props.feature.description.text,
      link: props.feature.description.link,
      inverted: props.feature.description.inverted,
      fontSize: props.feature.description.fontSize,
      blendMode: props.feature.blendMode,
      color: props.feature.color,
      background: props.feature.background,
    }
  }

  componentDidUpdate() {
    this.merge({
      text: this.state.text,
      link: this.state.link,
      inverted: this.state.inverted,
      fontSize: this.state.fontSize,
      color: this.state.color,
      background: this.state.background,
    })
  }

  setText(text: string) {
    this.setState({ text })

    setTimeout(() => {
      this.props.feature.calculateScale()
      this.props.feature.regenerate()
    }, 15)
  }

  setSize(fontSize: number) {
    this.setState({ fontSize })

    setTimeout(() => {
      this.props.feature.calculateScale()
      this.props.feature.regenerate()
    }, 15)
  }

  onBlendModeChange = (e: string) => {
    this.setState({ blendMode: e })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Sign Feature</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={this.props.feature} scene={this.props.scene} />
          <EditorProps>
            {/* keys are provided so that the getState in the component is reset after gizmo is used */}
            <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
            <Scale feature={this.props.feature} handleStateChange={() => this.props.feature.regenerate()} />
            <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />

            <div className="f">
              <label>Text</label>
              <input type="text" value={this.state.text} onInput={(e) => this.setText(e.currentTarget.value)} />
            </div>

            <div className="f">
              <label>Font size</label>
              <input type="number" min={16} max={92} value={this.state.fontSize} onInput={(e) => this.setSize(parseInt(e.currentTarget.value))} />
            </div>

            <div className="f">
              <label>Color</label>
              <input type="color" value={this.state.color} onInput={(e) => this.setState({ color: e.currentTarget.value })} />
            </div>
            <div className="f">
              <label>Background</label>
              <input type="color" value={this.state.background} onInput={(e) => this.setState({ background: e.currentTarget.value })} />
            </div>
            <Advanced>
              <FeatureID feature={this.props.feature} />

              <Hyperlink feature={this.props.feature} />

              <BlendMode feature={this.props.feature} handleStateChange={this.onBlendModeChange} />

              <Animation feature={this.props.feature} />

              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Sign.Editor = Editor
