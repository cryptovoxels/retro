import { throttle } from 'lodash'
import { ImageMode, ImageRecord, WrapMode } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { fetchSpinnerTexture, fetchTexture } from '../textures/textures'
import { rebindGizmosBoundToFeature } from '../tools/gizmos'
import { Advanced, Animation, BlendMode, FeatureEditor, FeatureEditorProps, FeatureID, Hyperlink, Toolbar, UrlSourceImages } from '../ui/features'
import { tidyFloat } from '../utils/helpers'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D, MeshExtended, TransparencyMode } from './feature'

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
  loaded = false

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
    this.loaded = false
    if (this.recentlySpawned) {
      // we don't want to show a loading image in other cases as this makes the world look more janky, but it is important
      // for builder user experience to show loading image if the image was just added by the user (e.g. drag and drop)
      this.renderLoading()
    }

    const texture = await fetchTexture(this.scene, this.textureURL, this.abortController.signal, {
      transparent: !!this.description.transparent,
      stretch: !!this.description.stretch,
      pixelated: this.description.pixelated,
    })
    texture.hasAlpha = false
    this.renderImage(texture)
    this.loaded = true
  }

  async renderLoading() {
    const texture = await fetchSpinnerTexture(this.scene, this.abortController.signal)
    // if for some reason the loading image takes longer to load than the actual image, don't replace it!
    if (this.loaded) return null
    texture.hasAlpha = false
    return this.renderImage(texture)
  }

  renderImage(texture: BABYLON.Texture): BABYLON.Mesh | null {
    if (this.disposed) return null

    const vertical = this.rotation.x == 0 && this.rotation.z == 0

    if (this.description.uScale && this.description.vScale) {
      texture.uScale = parseFloat(this.description.uScale.toString())
      texture.vScale = parseFloat(this.description.vScale.toString())
    }
    const plane = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.specularColor.set(0, 0, 0)
    material.diffuseColor.set(1, 1, 1)
    material.emissiveColor.set(1, 1, 1)
    material.diffuseTexture = texture
    material.backFaceCulling = false
    material.zOffset = -1

    plane.material = material
    if (this.mesh) {
      this.mesh.dispose()
    }
    this.mesh = plane

    // if any gizmos are bound to this feature we need to rebind them, since we just replaced mesh.
    rebindGizmosBoundToFeature(this)

    this.mesh.visibility = tidyFloat(this.description.opacity, 1)

    setTextureProperties(this, texture, material, plane)

    this.setCommon()
    this.addAnimation()
    this.addScriptTriggers()
    this.addEvents()

    return plane
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
        <header>
          <h2>Edit Image</h2>
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
        </div>
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
  tex: BABYLON.Texture,
  mat: BABYLON.StandardMaterial,
  mesh: BABYLON.Mesh,
) {
  switch (options.wrapMode) {
    // good for transparent images with alpha, to remove borders
    case 'Clamp':
      tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE
      tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE
      break
    case 'Mirror':
      tex.wrapU = BABYLON.Texture.MIRROR_ADDRESSMODE
      tex.wrapV = BABYLON.Texture.MIRROR_ADDRESSMODE
      break
    default:
      tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE
      tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE
  }

  mat.alpha = 0.999

  if (options.blendMode === 'Multiply') {
    mat.alphaMode = BABYLON.Engine.ALPHA_MULTIPLY
    return
  }

  if (options.blendMode === 'Screen') {
    mat.alphaMode = BABYLON.Engine.ALPHA_SCREENMODE
    return
  }

  // COMBINE and the various transparency options
  mat.alphaMode = BABYLON.Engine.ALPHA_COMBINE

  // since this image has no transparency, turn off unnecessary alpha blending to speed up rendering
  // https://doc.babylonjs.com/how_to/how_to_use_blend_modes#how-to-use-blend-modes
  if (options.transparencyMode === TransparencyMode.Ignore) {
    mat.alpha = 1
    return
  }
  // this material has a texture that the user indicated has transparency
  mat.opacityTexture = tex

  if (options.transparencyMode === TransparencyMode.AlphaBlend) {
    return
  }

  // special transparency options to help with layer ordering of large meshes
  if (options.transparencyMode === TransparencyMode.AlphaTest) {
    mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST
    return
  }

  // the default alphaIndex is Infinity, this moves it to the back, but not all the way
  if (options.transparencyMode === TransparencyMode.Background) {
    mesh.alphaIndex = 10
  }
  mat.blockDirtyMechanism = true
}
