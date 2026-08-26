import { PolytextRecord } from '../../common/messages/feature'
import { voxImporter } from '../../common/vox-import/vox-import'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature3D, MeshExtended } from './feature'
import { Color3, Mesh, addToScene } from '@babylonjs/lite'
import { hexRgb } from '../utils/feature-mesh'

const LETTER_SPACING = 0.5
const SCALE = 5.0
const ALPHABET_RED = 217
const ALPHABET_GREEN = 226
const ALPHABET_BLUE = 236

function buildColorMap(diffuse: [number, number, number]): Record<number, [number, number, number]> {
  const r = Math.round(diffuse[0] * 255)
  const g = Math.round(diffuse[1] * 255)
  const b = Math.round(diffuse[2] * 255)
  return {
    [ALPHABET_RED]: [r / 255, g / 255, b / 255],
    [ALPHABET_GREEN]: [(r * 0.5) / 255, (g * 0.5) / 255, (b * 0.5) / 255],
    [ALPHABET_BLUE]: [(r * 0.2) / 255, (g * 0.2) / 255, (b * 0.2) / 255],
  }
}

export default class Polytext extends Feature3D<PolytextRecord> {
  static metadata: FeatureMetadata = {
    title: 'Polytext',
    subtitle: '3d text',
    type: 'polytext',
    image: '/icons/polytext.png',
  }
  static template: FeatureTemplate = {
    type: 'polytext',
    scale: [0.2, 0.2, 0.2],
    rotate: [0, 0, 0],
    text: 'Text',
  }

  toString() {
    return this.description.text || super.toString()
  }

  whatIsThis() {
    return <label>Show customized 3d text! </label>
  }

  async generate() {
    const text = (this.description.text || '').slice(0, 24).toLowerCase()
    const colorMap = buildColorMap(hexRgb(this.description.color || '#ffffff'))
    const letters: Mesh[] = []
    let x = ((text.length + 1) * LETTER_SPACING * SCALE) / -2

    for (const ch of text) {
      x += LETTER_SPACING * SCALE

      if (!/[a-z0-9]/.test(ch)) {
        continue
      }

      try {
        const mesh = await voxImporter().import(`${process.env.ASSET_PATH || ''}/alphabet/${ch}.vox`, {
          signal: this.abortController.signal,
          colorMap,
        })
        if (this.disposed) {
          return
        }

        mesh.rotation.set(0, Math.PI / 2, 0)
        mesh.scaling.set(SCALE, SCALE, SCALE)
        mesh.position.set(0, (LETTER_SPACING * SCALE) / 2, x)
        letters.push(mesh)
      } catch (e) {
        if (e instanceof Error && e.message === 'Aborted') {
          return
        }
        console.warn('[Polytext] Failed to load letter:', ch, e)
      }
    }

    if (!letters.length || this.disposed) {
      return
    }

    const root = letters[0]
    addToScene(this.scene, root)
    for (let i = 1; i < letters.length; i++) {
      letters[i].parent = root
    }

    this.mesh = root as MeshExtended
    this.mesh.pickable = true

    this.setCommon()
    this.addAnimation()
  }
}

class Editor extends FeatureEditor<Polytext> {
  constructor(props: FeatureEditorProps<Polytext>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      text: props.feature.description.text,
      color: props.feature.description.color,
    }
  }

  componentDidUpdate() {
    this.merge({
      text: this.state.text,
      color: this.state.color,
    })
  }

  render() {
    return (
      <section>
        <Toolbar feature={this.props.feature} scene={this.props.scene} />
        <EditorProps>
          <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
          <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
          <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />
          <Animation feature={this.props.feature} />

          <div className="f">
            <label>Text</label>
            <input type="text" value={this.state.text} onInput={(e) => this.setState({ text: e.currentTarget.value })} />
            <small>(Only up to 24 characters supported)</small>
          </div>
          <div className="f">
            <label>Color</label>
            <input type="color" value={this.state.color || '#ffffff'} onInput={(e) => this.setState({ color: e.currentTarget.value })} />
            <small>
              <button title="Reset" onClick={() => this.setState({ color: '#FFFFFF' })}>
                Reset
              </button>
            </small>
          </div>

          <Advanced>
            <FeatureID feature={this.props.feature} />
            <Behaviours feature={this.props.feature} />
          </Advanced>
        </EditorProps>
      </section>
    )
  }
}

Polytext.Editor = Editor
