import { throttle } from 'lodash'
import { ImageMode, ImageRecord, WrapMode } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { fetchTexture } from '../textures/textures'
import { rebindGizmos } from '../tools/gizmos'
import { Advanced, Animation, BlendMode, FeatureEditor, FeatureEditorProps, FeatureID, Hyperlink, Toolbar, SourceInput } from '../ui/features'
import { tidyFloat } from '../utils/helpers'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import Feature, { Feature2D, MeshExtended, TransparencyMode } from './feature'
import { Mesh, StandardMaterialProps, Texture2D, createStandardMaterial } from '@babylonjs/lite'
import { featurePlane } from '../utils/feature-mesh'

export default class Image extends Feature2D<ImageRecord> {
  static metadata: FeatureMetadata = {
    title: 'Image',
    subtitle: 'image from a url',
    type: 'image',
    image: '/icons/image.png',
  }
  static template: FeatureTemplate = {
    type: 'image',
    scale: [1, 1, 0],
    url: '',
  }

  get transparencyMode() {
    if (this.description.transparent === true) {
      return TransparencyMode.AlphaBlend
    } else if (typeof this.description.transparent === 'string') {
      return this.description.transparent as TransparencyMode
    } else {
      return TransparencyMode.Ignore
    }
  }

  get wrapMode(): WrapMode {
    if (this.description.wrapMode) {
      return this.description.wrapMode
    }
    return 'Repeat'
  }

  get textureURL(): string | null {
    if (!this.url) {
      return null
    }

    let srcUrl = ''
    // simple URL validation
    try {
      srcUrl = new URL(this.url).toString()
    } catch (e) {
      return null
    }
    if (!this.description.updateDaily) {
      return srcUrl
    }

    const date = new Date()
    const joiner = srcUrl.match(/\?/) ? '&' : '?'
    return srcUrl + `${joiner}nonce=${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`
  }

  toString() {
    return this.url || super.toString()
  }

  whatIsThis() {
    return <label>Show any image or gifs you want. </label>
  }

  async generateInstance(root: Image) {
    if (!root.mesh) {
      // No mesh, just create a non-instanced mesh
      await this.generate()
      return
    }

    this.mesh = root.mesh.createInstance(this.uniqueEntityName('instance')) as unknown as MeshExtended

    this.setCommon()
    this.addAnimation()
    if (this.description.isTrigger) {
      this.addScriptTriggers()
    }
    this.addEvents()
  }

  async generate(): Promise<void> {
    await this.loadContent()
  }

  private async loadContent() {
    const texture = await fetchTexture(this.scene, this.textureURL, this.abortController.signal, {
      transparent: !!this.description.transparent,
      stretch: !!this.description.stretch,
      pixelated: this.description.pixelated,
    })
    if (this.disposed || this.abortController.signal.aborted) {
      return
    }
    this.renderImage(texture)
  }

  renderImage(texture: Texture2D): Mesh | null {
    if (this.disposed) return null

    if (this.description.uScale && this.description.vScale) {
      texture.uScale = parseFloat(this.description.uScale.toString())
      texture.vScale = parseFloat(this.description.vScale.toString())
    }

    const material = createStandardMaterial()
    material.specularColor = [0, 0, 0]
    material.diffuseColor = [1, 1, 1]
    material.emissiveColor = [1, 1, 1]
    material.diffuseTexture = texture
    material.backFaceCulling = false

    if (!this.mesh) {
      this.mesh = featurePlane(this.scene, this.uniqueEntityName('mesh'))
      rebindGizmos(this)
    } else {
      const old = this.mesh.material
      this.mesh.material = null
      if (old && old !== Feature.draftMaterial) {
        old.dispose?.()
      }
    }

    this.mesh.material = material
      ; (this.mesh as any).visibility = tidyFloat(this.description.opacity, 1)

    setTextureProperties(this, texture, material, this.mesh)

    this.setCommon()
    this.addAnimation()
    this.addScriptTriggers()
    this.addEvents()

    return this.mesh
  }

  onClick() {
    if (this.behaviours) {
      this.behaviours.dispatch(this.uuid, 'click')
    }

    if (this.isLink && this.description.link) {
      this.onClickLink(this.description.link)
    }
  }
}

class Editor extends FeatureEditor<Image> {
  update: (dict: { opacity: string }) => void

  constructor(props: FeatureEditorProps<Image>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      url: props.feature.description.url,
      blendMode: props.feature.blendMode,
      stretch: !!props.feature.description.stretch,
      pixelated: !!props.feature.description.pixelated,
      link: props.feature.description.link,
      transparencyMode: props.feature.transparencyMode,
      opacity: tidyFloat(props.feature.description.opacity, 1),
      wrapMode: props.feature.wrapMode,
      updateDaily: props.feature.description.updateDaily,
      uScale: props.feature.description.uScale,
      vScale: props.feature.description.vScale,
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
    this.merge({
      link: this.state.link,
      stretch: !!this.state.stretch,
      pixelated: !!this.state.pixelated,
      transparent: this.state.transparencyMode !== TransparencyMode.Ignore ? this.state.transparencyMode : false,
      wrapMode: this.state.wrapMode,
      opacity: parseFloat(this.state.opacity).toFixed(2),
      updateDaily: !!this.state.updateDaily,
      uScale: this.state.uScale || 1,
      vScale: this.state.vScale || 1,
    })
  }

  setScale(scaleType: 'u' | 'v', value: number) {
    if (scaleType === 'u') {
      this.setState({ uScale: value })
    } else {
      this.setState({ vScale: value })
    }
  }

  onBlendModeChange = (e: string) => {
    this.setState({ blendMode: e })
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

          <SourceInput feature={this.props.feature} accept="image" />

          <Advanced>
            <Animation feature={this.props.feature} />

            <FeatureID feature={this.props.feature} />

            <Hyperlink feature={this.props.feature} />

            <BlendMode feature={this.props.feature} handleStateChange={this.onBlendModeChange} />

            <div className="f">
              <label>Transparency</label>
              <select onInput={(e) => this.setState({ transparencyMode: e.currentTarget.value })} value={this.state.transparencyMode}>
                <option value={TransparencyMode.Ignore}>Ignore Alpha</option>
                <option value={TransparencyMode.AlphaBlend}>Alpha Blended</option>
                <option value={TransparencyMode.AlphaTest}>Alpha Tested</option>
                <option value={TransparencyMode.Background}>Blended Background</option>
              </select>
            </div>

            <div className="f">
              <label>Opacity</label>
              <input disabled={this.state.blendMode !== 'Combine'} type="range" min={0.01} max={1} value={this.state.opacity} step={0.01} onChange={(e) => this.update({ opacity: e.currentTarget.value })}></input>
            </div>

            <div className="f">
              <label>Display</label>
              <label>
                <input type="checkbox" checked={this.state.stretch} onChange={(e) => this.setState({ stretch: e.currentTarget.checked })} />
                Stretch
              </label>
              <label>
                <input type="checkbox" checked={this.state.pixelated} onChange={(e) => this.setState({ pixelated: e.currentTarget.checked })} />
                Pixelate
              </label>
              <br />
            </div>

            <div className="f uv">
              <label>UVScale</label>
              <input type="number" min={1} max={64} value={this.state.uScale} onInput={(e) => this.setScale('u', parseFloat(e.currentTarget.value))} />
              <input type="number" min={1} max={64} value={this.state.vScale} onInput={(e) => this.setScale('v', parseFloat(e.currentTarget.value))} />
            </div>

            <div className="f wrap">
              <label>Wrap mode</label>
              <select onInput={(e) => this.setState({ wrapMode: e.currentTarget.value })} value={this.state.wrapMode}>
                <option value="Repeat">Repeat</option>
                <option value="Clamp">Clamp</option>
                <option value="Mirror">Mirror</option>
              </select>
            </div>

            <Behaviours feature={this.props.feature} />
          </Advanced>
        </EditorProps>
      </section>
    )
  }
}

Image.Editor = Editor

// set common image options, exported for nft-images and other 'image like' features
export function setTextureProperties(
  options: {
    blendMode: ImageMode
    transparencyMode: TransparencyMode
    wrapMode?: WrapMode
  },
  tex: Texture2D,
  mat: StandardMaterialProps,
  mesh: Mesh,
) {
  // todo(lite): wrap modes need sampler rebuild at load time
  void options.wrapMode
  void tex

  mat.alpha = 0.999

  if (options.blendMode === 'Multiply' || options.blendMode === 'Screen') {
    // todo(lite): custom blend modes
    return
  }

  if (options.transparencyMode === TransparencyMode.Ignore) {
    mat.alpha = 1
    return
  }

  mesh.hasVertexAlpha = true

  if (options.transparencyMode === TransparencyMode.AlphaBlend) {
    mat.alpha = 0.999
    return
  }

  if (options.transparencyMode === TransparencyMode.AlphaTest) {
    mat.alphaCutOff = 0.5
    return
  }

  if (options.transparencyMode === TransparencyMode.Background) {
    ; (mesh as any).alphaIndex = 10
  }
}
