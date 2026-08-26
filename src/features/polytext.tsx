import { PolytextRecord } from '../../common/messages/feature'
import { voxImporter } from '../../common/vox-import/vox-import'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature3D, MeshExtended } from './feature'

const LETTER_SPACING = 0.5
const SCALE = 5.0
const ALPHABET_RED = 217
const ALPHABET_GREEN = 226
const ALPHABET_BLUE = 236

function buildColorMap(diffuse: BABYLON.Color3): Record<number, [number, number, number]> {
  const r = Math.round(diffuse.r * 255)
  const g = Math.round(diffuse.g * 255)
  const b = Math.round(diffuse.b * 255)
  return {
    [ALPHABET_RED]: [r, g, b],
    [ALPHABET_GREEN]: [Math.round(r * 0.5), Math.round(g * 0.5), Math.round(b * 0.5)],
    [ALPHABET_BLUE]: [Math.round(r * 0.2), Math.round(g * 0.2), Math.round(b * 0.2)],
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
    const diffuse = BABYLON.Color3.FromHexString(this.description.color || '#ffffff')
    const colorMap = buildColorMap(diffuse)
    const letters: BABYLON.Mesh[] = []
    let x = ((text.length + 1) * LETTER_SPACING * SCALE) / -2

    for (const ch of text) {
      x += LETTER_SPACING * SCALE

      if (!/[a-z0-9]/.test(ch)) {
        continue
      }

      try {
        const mesh = await voxImporter().import(`${process.env.ASSET_PATH}/alphabet/${ch}.vox`, {
          signal: this.abortController.signal,
          colorMap,
        })
        if (this.disposed) {
          mesh.dispose()
          letters.forEach((m) => m.dispose())
          return
        }

        // Bake scale, rotation, centerline, and letter spacing into vertices
        mesh.rotation.y = Math.PI / 2
        mesh.scaling.set(SCALE, SCALE, SCALE)
        mesh.position.y = (LETTER_SPACING * SCALE) / 2
        mesh.position.z = x
        mesh.bakeCurrentTransformIntoVertices()
        letters.push(mesh)
      } catch (e) {
        if (e instanceof Error && e.message === 'Aborted') {
          letters.forEach((m) => m.dispose())
          return
        }
        console.warn('[Polytext] Failed to load letter:', ch, e)
      }
    }

    if (!letters.length || this.disposed) {
      letters.forEach((m) => m.dispose())
      return
    }

    const merged = BABYLON.Mesh.MergeMeshes(letters, true)
    if (!merged) {
      return
    }

    this.mesh = merged
    this.mesh.isPickable = true

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
