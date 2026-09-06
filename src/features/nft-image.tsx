import { throttle } from 'lodash'
import { ProxyAssetOpensea } from '../../common/messages/api-opensea'
import { ImageMode, NftImageRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { app } from '../../web/src/state'
import nftFrameBlueShaderBlue from '../shaders/nft-frame-blue.fsh'
import nftFrameShaderClassic from '../shaders/nft-frame-classic.fsh'
import nftFrameColorsShaderColors from '../shaders/nft-frame-colors.fsh'
import nftVertexShader from '../shaders/nft.vsh'
import { fetchTexture } from '../textures/textures'
import { rebindGizmos } from '../tools/gizmos'
import { Advanced, BlendMode, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar, SourceInput } from '../ui/features'
import OpenseaAssetHelper from '../ui/gui/opensea-asset-helper'
import showNftView from '../ui/html-ui/nft-view'
import { tidyFloat } from '../utils/helpers'
import { opensea, readOpenseaUrl } from '../utils/proxy'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D, TransparencyMode } from './feature'
import { encodeImageDraft, persistDraft } from './feature-draft'
import { setTextureProperties } from './image'
import NFTFrame from './utils/nft-frame'
import { Action } from '../../common/messages'

export function arrayBufferToDataURL(buf: ArrayBuffer, mime = 'application/octet-stream'): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buf], { type: mime })
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string) // data:... base64
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}

BABYLON.Effect.ShadersStore['nftVertexShader'] = nftVertexShader
BABYLON.Effect.ShadersStore['nftFramePixelShader'] = nftFrameShaderClassic
BABYLON.Effect.ShadersStore['nftFrameColorsPixelShader'] = nftFrameColorsShaderColors
BABYLON.Effect.ShadersStore['nftFrameBluePixelShader'] = nftFrameBlueShaderBlue

const frameThick = 0.05

const queryParams = new URLSearchParams(document.location.search.substring(1))

export default class NftImage extends Feature2D<NftImageRecord> {
  static classicFrameMaterial: NFTFrame
  static colorsFrameMaterial: NFTFrame
  static blueFrameMaterial: NFTFrame
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
    NftImage.classicFrameMaterial = new NFTFrame(scene, 'nftFrame', 'nft-classic-frame')
    NftImage.colorsFrameMaterial = new NFTFrame(scene, 'nftFrameColors', 'nft-frame-frame')
    NftImage.blueFrameMaterial = new NFTFrame(scene, 'nftFrameBlue', 'nft-blue-frame')
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
    // get the URL of the asset
    return new Promise(async (resolve) => {
      this.loaded = false
      this.generateDraft()
      var url = await this.loadURL()

      if (this.disposed || this.abortController.signal.aborted) {
        return resolve()
      }

      if (!this.assetHelper) {
        console.warn('NFT URL:', this.url, 'could not be loaded.')
        return resolve()
      }

      const imgUrl = this.assetHelper!.getImage
      const isSvg = imgUrl.endsWith('.svg')
      // const isGif = imgUrl.endsWith('.gif')

      if (this.parcel.id === 86 && isSvg) {
        // 1) fetch → sanitize → blob → img (untainted)
        const res = await fetch(imgUrl, { mode: 'cors', credentials: 'omit' })
        const ext = imgUrl.split('.').pop()

        var datauri = ''

        if (ext == 'svg') {
          const svgText = await res.text()
          datauri = `data:image/svg+xml;base64,${btoa(svgText)}`
        } else if (ext == 'gif') {
          const buf = await res.arrayBuffer()
          const gifuri = await arrayBufferToDataURL(buf, 'image/gif')

          // const svg = `
          // <svg class="a p" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
          //   <image href="${gifuri}" width="512" height="512" />
          // </svg>

          datauri = `data:image/svg+xml;base64,${btoa(gifuri)}`
        } else {
          // const buf = await res.arrayBuffer()
          // datauri = await arrayBufferToDataURL(buf, 'image/png')
        }

        // optional but wise: strip scripts/external refs
        // e.g. DOMPurify if you have it:
        // svgText = DOMPurify.sanitize(svgText, { USE_PROFILES: { svg: true, svgFilters: true } });

        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = datauri
        await img.decode()

        // 2) upload to WebGL
        // gl.bindTexture(gl.TEXTURE_2D, tex);
        //         gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

        img.style.cssText = `
          position: fixed;
          top: 0;
          left: 32px;
          width: 32px;
          height: 32px;
          z-index: 1000;
        `
        document.body.appendChild(img)

        // console.log('img', img)

        const size = { width: 512, height: 512 }
        const tex = new BABYLON.DynamicTexture('imgTex', size, this.scene, false)

        // on dispose, remove the img from the DOM
        tex.onDisposeObservable.add(() => {
          img.remove()
        })

        // console.log('tex', tex)

        // draw the image into the texture
        const ctx = tex.getContext()

        function refresh() {
          if (!img) return

          ctx.clearRect(0, 0, size.width, size.height)
          ctx.drawImage(img, 0, 0, size.width, size.height)
          tex.update(true) // pass false to keep current invertY

          // console.log('refresh', img)

          // call again next frame if needed
          requestAnimationFrame(refresh)
        }

        refresh()
        // ctx.clearRect(0, 0, size.width, size.height)
        // ctx.drawImage(img, 0, 0, size.width, size.height)
        // tex.update() // upload to GPU

        // use it
        // const mat = new BABYLON.StandardMaterial('m', scene)
        // mat.diffuseTexture = tex
        // mesh.material = mat

        // const mesh = this.renderImage(tex)
        // this.loaded = true
        // resolve()
        // return mesh

        setTimeout(() => {
          // @ts-ignore
          this.mesh.material.diffuseTexture = tex
        }, 1000)
      }

      try {
        const texture = await fetchTexture(this.scene, url, this.abortController.signal, {
          transparent: !!this.description.transparent,
          stretch: !!this.description.stretch,
          pixelated: this.description.pixelated,
        })
        if (this.disposed || this.abortController.signal.aborted) {
          texture.dispose()
          return resolve()
        }
        texture.hasAlpha = false
        this.renderImage(texture)
        this.loaded = true
        void encodeImageDraft(imgUrl).then((d) => persistDraft(this, d))
      } catch {
        // aborted or failed: leave draft
      }
      resolve()
    })
  }

  loadURL = async () => {
    if (!this.url) {
      // if no URL just show nothing
      return null
    }
    const nftInfo = this.nftInfo

    if (!nftInfo) {
      // if we have a URL but the NFTinfo is bad, show error image
      return `${process.env.ASSET_PATH}/images/error-URL_is_invalid.png`
    }

    if (!this.forceUpdate && this.asset && this.assetHelper && this.asset.token_id === nftInfo.token && this.asset.asset_contract.address === nftInfo.contract) {
      return this.assetHelper.getImage
    }
    this.asset = this.assetHelper = null

    const data = await opensea(nftInfo.contract, nftInfo.token, nftInfo.chain).catch((err) => {
      console.warn(`couldn't fetch NFT for parcel ${this.parcel.id}`, err, nftInfo)
    })

    // console.log('data', data)

    if (!data || !('asset_contract' in data)) {
      return `${process.env.ASSET_PATH}/images/error-could_not_fetch_nft.png`
    }

    this.asset = data
    this.assetHelper = new OpenseaAssetHelper(data)
    this.forceUpdate = false

    return this.assetHelper.getImage
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

    if (!(this.mesh instanceof BABYLON.Mesh)) {
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
    this.frame.material = frameMaterial.material
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
