import { throttle } from 'lodash'
import { ProxyAssetOpensea } from '../../common/messages/api-opensea'
import { ImageMode, NftImageRecord } from '../../common/messages/feature'
import { isUgcTextureUrl } from '../../common/helpers/parcel-compile'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { app } from '../../web/src/state'
import { fetchTexture } from '../textures/textures'
import { rebindGizmos } from '../tools/gizmos'
import { Advanced, BlendMode, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar, SourceInput } from '../ui/features'
import OpenseaAssetHelper from '../ui/gui/opensea-asset-helper'
import showNftView from '../ui/html-ui/nft-view'
import { tidyFloat } from '../utils/helpers'
import { opensea, readOpenseaUrl } from '../utils/proxy'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D, TransparencyMode } from './feature'
import { setTextureProperties } from './image'
import { Action } from '../../common/messages'

function frameMat(scene: BABYLON.Scene, name: string, color: BABYLON.Color3): BABYLON.StandardMaterial {
  const m = new BABYLON.StandardMaterial(`feature/nft-image/${name}`, scene)
  m.emissiveColor = color
  m.disableLighting = true
  m.freeze()
  return m
}

const frameThick = 0.05

export default class NftImage extends Feature2D<NftImageRecord> {
  static classicFrameMaterial: BABYLON.StandardMaterial
  static colorsFrameMaterial: BABYLON.StandardMaterial
  static blueFrameMaterial: BABYLON.StandardMaterial
  static metadata: FeatureMetadata = {
    title: 'NFT Image',
    subtitle: 'nfts you own',
    type: 'nft-image',
    image: '/icons/nft-image.png',
  }
  static template: FeatureTemplate = {
    type: 'nft-image',
    scale: [1, 1, 0],
    url: '',
  }
  frame: BABYLON.Mesh | null = null
  forceUpdate = false
  rendered = false
  assetHelper: OpenseaAssetHelper | null = null
  // Cached opensea info
  asset: ProxyAssetOpensea | null = null
  parcelOwnerIsAssetOwner = false
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

  get blendMode(): ImageMode {
    if (this.description.blendMode) {
      return this.description.blendMode
    }
    if (this.description.inverted) {
      return 'Screen'
    }
    return 'Combine'
  }

  get frameMaterial() {
    const style = this.description.nftFrameStyle || 'classic'
    if (style == 'classic') {
      return NftImage.classicFrameMaterial
    } else if (style == 'blue') {
      return NftImage.blueFrameMaterial
    } else if (style == 'colors') {
      return NftImage.colorsFrameMaterial
    }
  }

  get nftInfo() {
    if (!this.url) {
      return null
    }
    return readOpenseaUrl(this.url)
  }

  static generateFrameMaterials(scene: BABYLON.Scene) {
    NftImage.classicFrameMaterial = frameMat(scene, 'nft-classic-frame', new BABYLON.Color3(0.6, 0.6, 0.6))
    NftImage.colorsFrameMaterial = frameMat(scene, 'nft-frame-frame', new BABYLON.Color3(0.8, 0.4, 0.8))
    NftImage.blueFrameMaterial = frameMat(scene, 'nft-blue-frame', new BABYLON.Color3(0.2, 0.4, 0.9))
  }

  toString() {
    return this.url || super.toString()
  }

  whatIsThis() {
    return <label>This feature allows you to display digital art</label>
  }

  forceRefresh() {
    this.forceUpdate = true
    this.generateNFT()
  }

  get isInteract() {
    return true
  }

  shouldBeInteractive() {
    return !!this.url
  }

  async generate() {
    if (!this.frameMaterial) {
      NftImage.generateFrameMaterials(this.scene)
    }

    this.generateNFT()

    return Promise.resolve()
  }

  generateNFT = async (): Promise<void> => {
    this.loaded = false
    this.generateDraft()
    if (this.disposed || this.abortController.signal.aborted) return

    // compiled / rehosted: paint ugc directly, never OpenSea for the in-world texture
    const rawUrl = (this.description as any).url as string | undefined
    if (isUgcTextureUrl(rawUrl) || isUgcTextureUrl(this.url)) {
      if (this.url) await this.paintTexture(this.url)
      return
    }

    // draft present: leave it, don't hit OpenSea just to maybe replace it with a failure
    if ((this.description as any).draft) return

    // uncompiled, no draft: OpenSea for the texture (popup path shares loadURL)
    const imgUrl = await this.loadURL()
    if (!imgUrl || this.disposed || this.abortController.signal.aborted) return

    // parcel 86 svg hack kept for the one place that needs it
    if (this.parcel.id === 86 && imgUrl.endsWith('.svg') && this.assetHelper) {
      try {
        await this.paintSvgHack(imgUrl)
      } catch {
        // leave blank
      }
      return
    }

    await this.paintTexture(imgUrl)
  }

  private async paintTexture(url: string) {
    try {
      const texture = await fetchTexture(this.scene, url, this.abortController.signal, {
        transparent: !!this.description.transparent,
        stretch: !!this.description.stretch,
        pixelated: this.description.pixelated,
      })
      if (this.disposed || this.abortController.signal.aborted) {
        texture.dispose()
        return
      }
      texture.hasAlpha = false
      this.renderImage(texture)
      this.loaded = true
    } catch {
      // aborted or failed: leave draft / blank
    }
  }

  private async paintSvgHack(imgUrl: string) {
    const res = await fetch(imgUrl, { mode: 'cors', credentials: 'omit' })
    const svgText = await res.text()
    const datauri = `data:image/svg+xml;base64,${btoa(svgText)}`
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = datauri
    await img.decode()
    const size = { width: 512, height: 512 }
    const tex = new BABYLON.DynamicTexture('imgTex', size, this.scene, false)
    tex.onDisposeObservable.add(() => img.remove())
    const ctx = tex.getContext()
    ctx.clearRect(0, 0, size.width, size.height)
    ctx.drawImage(img, 0, 0, size.width, size.height)
    tex.update(true)
    if (this.disposed || this.abortController.signal.aborted) {
      tex.dispose()
      return
    }
    this.renderImage(tex)
    this.loaded = true
  }

  // OpenSea metadata + image URL. used for uncompiled render and the inspect popup. never returns an error PNG.
  loadURL = async (): Promise<string | null> => {
    if (!this.url) return null
    const nftInfo = this.nftInfo
    if (!nftInfo) return null

    if (!this.forceUpdate && this.asset && this.assetHelper && this.asset.token_id === nftInfo.token && this.asset.asset_contract.address === nftInfo.contract) {
      return this.assetHelper.getImage || null
    }
    this.asset = this.assetHelper = null

    const data = await opensea(nftInfo.contract, nftInfo.token, nftInfo.chain).catch((err) => {
      console.warn(`couldn't fetch NFT for parcel ${this.parcel.id}`, err, nftInfo)
    })

    if (!data || !('asset_contract' in data)) return null

    this.asset = data
    this.assetHelper = new OpenseaAssetHelper(data)
    this.forceUpdate = false

    return this.assetHelper.getImage || null
  }

  onClick() {
    this.connector.sendMetric(Action.Inspect)
    void this.openDetails()
  }

  private async openDetails() {
    if (!this.asset) {
      await this.loadURL().catch(() => {})
    }
    showNftView(this)
  }

  renderImage(texture: BABYLON.Texture): BABYLON.Mesh | null {
    if (this.disposed) return null

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.specularColor.set(0, 0, 0)
    material.diffuseColor.set(1, 1, 1)

    // Emissive color is a custom property that's a user-input
    let defaultIntensity = 1 // emissiveColor intensity
    // Previously, nft-images did not have an emissiveColor making them dark. 0.01 is the equivalent of no emissiveColor
    // Because we now introduce it, I set the new default of emissiveColor to be 0.5 instead of no emissiveColor
    if (!this.deprecatedSince('7.18.11')) {
      defaultIntensity = tidyFloat(this.description.emissiveColorIntensity, 0.5)
    }

    material.emissiveColor.fromArray(new Array(3).fill(defaultIntensity))

    material.backFaceCulling = false
    material.zOffset = -5
    material.diffuseTexture = texture

    // draft mesh has no uvs, must be replaced not reused
    if (!(this.mesh instanceof BABYLON.Mesh) || !this.mesh.isVerticesDataPresent(BABYLON.VertexBuffer.UVKind)) {
      this.mesh?.dispose()
      this.mesh = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
      rebindGizmos(this)
    } else {
      const old = this.mesh.material
      this.mesh.material = null
      if (old instanceof BABYLON.StandardMaterial && old.getBindedMeshes().length <= 1) {
        old.dispose(false, true)
      }
    }

    this.mesh.material = material

    setTextureProperties(this, texture, material, this.mesh)

    this.setCommon()
    return this.mesh
  }

  afterSetCommon = () => {
    this.generateFrame()
  }

  generateFrame() {
    if (this.frame) {
      this.frame.dispose()
    }

    const style = this.description.nftFrameStyle || 'classic'
    let frameMaterial = NftImage.classicFrameMaterial

    if (style == 'blue') {
      frameMaterial = NftImage.blueFrameMaterial
    } else if (style == 'colors') {
      frameMaterial = NftImage.colorsFrameMaterial
    }

    if (!this.mesh) {
      return
    }

    // wire click even when metadata fetch failed (Base etc.) so we can retry on inspect
    this.addScriptTriggers()
    this.addEvents()

    if (!this.asset) {
      return
    }

    if (!this.assetHelper?.isOwner(this.parcel.owner)) {
      return
    }
    if (!this.description.hasFrame) {
      return
    }

    const w = this.scale.x
    const h = this.scale.y
    const t = frameThick
    const name = this.uniqueEntityName('mesh')
    const top = BABYLON.MeshBuilder.CreateBox(`${name}/top`, { width: w + 2 * t, height: t, depth: t }, this.scene)
    top.position.y = h / 2 + t / 2
    const bottom = BABYLON.MeshBuilder.CreateBox(`${name}/bottom`, { width: w + 2 * t, height: t, depth: t }, this.scene)
    bottom.position.y = -(h / 2 + t / 2)
    const left = BABYLON.MeshBuilder.CreateBox(`${name}/left`, { width: t, height: h, depth: t }, this.scene)
    left.position.x = -(w / 2 + t / 2)
    const right = BABYLON.MeshBuilder.CreateBox(`${name}/right`, { width: t, height: h, depth: t }, this.scene)
    right.position.x = w / 2 + t / 2

    this.frame = BABYLON.Mesh.MergeMeshes([top, bottom, left, right], true)!
    this.frame.name = 'nft-image-frame'
    this.frame.material = frameMaterial
    this.frame.parent = this.mesh.parent
    this.frame.position.copyFrom(this.position)
    this.frame.rotation.copyFrom(this.rotation)
  }

  _dispose() {
    this.frame?.dispose()
    super._dispose()
  }
}

class Editor extends FeatureEditor<NftImage> {
  update: (dict: NftImage) => void

  constructor(props: FeatureEditorProps<NftImage>) {
    super(props)
    this.state = {
      id: props.feature.description.id,
      url: props.feature.description.url,
      inverted: !!props.feature.description.inverted,
      stretch: !!props.feature.description.stretch,
      pixelated: !!props.feature.description.pixelated,
      hasFrame: !!props.feature.description.hasFrame,
      nftFrameStyle: props.feature.description.nftFrameStyle || 'classic',
      blendMode: props.feature.blendMode,
      transparencyMode: props.feature.transparencyMode,
      emissiveColorIntensity: tidyFloat(props.feature.description.emissiveColorIntensity, 0.5),
      /* Editor states*/
      isOwner: false,
    }

    this.update = throttle(
      (dict) => {
        this.setState({ dict })
      },
      200,
      { leading: false, trailing: true },
    )
  }

  get nftInfo() {
    if (!this.state.url) {
      return null
    }
    return readOpenseaUrl(this.state.url)
  }

  componentDidMount() {
    // Check if we own that NFT to show the `show frame` option
    this.fetchOwnership()
    super.componentDidMount()
  }

  componentDidUpdate() {
    this.merge({
      inverted: !!this.state.inverted,
      color: !!this.state.color,
      stretch: !!this.state.stretch,
      pixelated: !!this.state.pixelated,
      transparent: this.state.transparencyMode !== TransparencyMode.Ignore ? this.state.transparencyMode : false,
      emissiveColorIntensity: parseFloat(this.state.emissiveColorIntensity).toFixed(2),
      hasFrame: this.state.hasFrame,
      nftFrameStyle: this.state.nftFrameStyle,
    })
  }

  onUrlChange = (url?: string) => {
    this.setState({ url }, () => {
      this.fetchOwnership()
    })
  }

  fetchOwnership = async (cachebust = false) => {
    if (!this.state.url) {
      this.setState({ isOwner: false })
      return
    }
    const nftInfo = this.nftInfo
    if (!nftInfo) {
      this.setState({ isOwner: false })
      return
    }
    if (!app.state.wallet) {
      this.setState({ isOwner: false })
      return
    }

    const r = await opensea(nftInfo.contract, nftInfo.token, nftInfo.chain)

    const helper = new OpenseaAssetHelper(r)
    this.setState({ isOwner: helper.isOwner(app.state.wallet) })
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

          <SourceInput feature={this.props.feature} accept="nft" handleStateChange={this.onUrlChange} />

          <Advanced>
            <FeatureID feature={this.props.feature} />

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
            </div>

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
              <label>Emissive Color Intensity {'(Current : ' + (this.state.emissiveColorIntensity * 100).toFixed(2) + '% )'}</label>
              <input type="range" min={0.01} max={1} value={this.state.emissiveColorIntensity} step={0.01} onChange={(e) => this.setState({ emissiveColorIntensity: e.currentTarget.value })}></input>
            </div>

            {this.state.isOwner && (
              <div className="f">
                <label>Frame</label>
                <label>
                  <input type="checkbox" checked={this.state.hasFrame} onChange={(e) => this.setState({ hasFrame: e.currentTarget.checked })} />
                  Show frame
                </label>
                <small>This frame shows you (the parcel owner) owns this nft.</small>
              </div>
            )}

            {this.state.isOwner && !!this.state.hasFrame && (
              <div className="sub-f">
                <div className="f">
                  <label>Frame style</label>
                  <select onInput={(e) => this.setState({ nftFrameStyle: e.currentTarget.value })} value={this.state.nftFrameStyle}>
                    <option value={'classic'}>Classic</option>
                    <option value={'colors'}>Colors</option>
                    <option value={'blue'}>Blue</option>
                  </select>
                  <small>Select a frame color style</small>
                </div>
              </div>
            )}

            <Behaviours feature={this.props.feature} />
          </Advanced>
        </EditorProps>
      </section>
    )
  }
}

NftImage.Editor = Editor
