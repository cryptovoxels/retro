import { throttle } from 'lodash'
import { isValidUrl } from '../../common/helpers/utils'
import { ProxyAssetOpensea } from '../../common/messages/api-opensea'
import { ImageMode, NftImageRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Script } from '../../web/src/components/editor'
import { app } from '../../web/src/state'
import nftFrameBlueShaderBlue from '../shaders/nft-frame-blue.fsh'
import nftFrameShaderClassic from '../shaders/nft-frame-classic.fsh'
import nftFrameColorsShaderColors from '../shaders/nft-frame-colors.fsh'
import nftVertexShader from '../shaders/nft.vsh'
import { fetchSpinnerTexture, fetchTexture } from '../textures/textures'
import { rebindGizmosBoundToFeature } from '../tools/gizmos'
import { Advanced, BlendMode, FeatureEditor, FeatureEditorProps, FeatureID, SetParentDropdown, Toolbar, TriggerEditor, UrlSourceNftImages, UuidReadOnly } from '../ui/features'
import OpenseaAssetHelper from '../ui/gui/opensea-asset-helper'
import showNftImageHTMLUi from '../ui/html-ui/nft-image-ui'
import { tidyFloat } from '../utils/helpers'
import { opensea, readOpenseaUrl } from '../utils/proxy'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D, TransparencyMode } from './feature'
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
    subtitle: 'For NFTs you own',
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

  async renderLoading() {
    const texture = await fetchSpinnerTexture(this.scene, this.abortController.signal)
    // if for some reason the loading image takes longer to load than the actual image, don't replace it!
    if (this.loaded) return null
    texture.hasAlpha = false
    return this.renderImage(texture)
  }

  shouldBeInteractive() {
    return !!this.url
  }

  async generate() {
    if (!this.frameMaterial) {
      NftImage.generateFrameMaterials(this.scene)
    }

    if (this.deprecatedSince('5.40.1')) {
      this.description.hasGui = true
      this.description.hasGuiResizable = false
    }
    if (this.deprecatedSince('5.23.0')) {
      this.description.hasFrame = true
    }
    this.generateNFT()

    return Promise.resolve()
  }

  generateNFT = async (): Promise<void> => {
    // get the URL of the asset
    return new Promise(async (resolve) => {
      this.loaded = false
      if (this.recentlySpawned) {
        // we don't want to show a loading image in other cases as this makes the world look more janky, but it is important
        // for builder user experience to show loading image if the image was just added by the user (e.g. drag and drop)
        await this.renderLoading()
        resolve()
      }
      var url = await this.loadURL()

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

      const texture = await fetchTexture(this.scene, url, this.abortController.signal, {
        transparent: !!this.description.transparent,
        stretch: !!this.description.stretch,
        pixelated: this.description.pixelated,
      })
      texture.hasAlpha = false
      this.renderImage(texture)
      this.loaded = true
      resolve()
    })
  }

  loadURL = async () => {
    if (!this.url) {
      // if no URL just show nothing
      return null
    }
    const nftInfo = this.nftInfo

    if (!nftInfo || !isValidUrl(this.url)) {
      // if we have a URL but the NFTinfo is bad, show error image
      return `${process.env.ASSET_PATH}/images/error-URL_is_invalid.png`
    }

    if (!this.forceUpdate && this.asset && this.assetHelper && this.asset.token_id === nftInfo.token && this.asset.asset_contract.address === nftInfo.contract) {
      return this.assetHelper.getImage
    }
    this.asset = this.assetHelper = null

    const data = await opensea(nftInfo.contract, nftInfo.token, nftInfo.chain, this.parcel.owner, this.forceUpdate).catch((err) => {
      console.warn(`couldn't fetch NFT for parcel ${this.parcel.id}`, err, nftInfo)
    })

    // console.log('data', data)

    if (!data || !('asset_contract' in data)) {
      return `${process.env.ASSET_PATH}/images/error-could_not_fetch_nft.png`
    }

    this.asset = data
    this.assetHelper = new OpenseaAssetHelper(data)
    this.forceUpdate = false

    if (queryParams.get('inspect') == this.uuid) {
      setTimeout(() => {
        this.onClick()
      }, 100)
    }

    return this.assetHelper.getImage
  }

  onClick() {
    this.connector.sendMetric(Action.Inspect)

    // I guess we'll still use the `HasGUI` for the option of opening the HTMLUI.
    this.description.hasGui && showNftImageHTMLUi(this)
  }

  renderImage(texture: BABYLON.Texture): BABYLON.Mesh | null {
    if (this.disposed) return null

    const plane = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
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
    material.zOffset = -2
    material.diffuseTexture = texture

    plane.material = material

    if (this.mesh) {
      this.mesh.dispose()
    }
    this.mesh = plane

    // if any gizmos are bound to this feature we need to rebind them, since we just replaced mesh.
    rebindGizmosBoundToFeature(this)

    setTextureProperties(this, texture, material, plane)

    this.setCommon()
    return plane
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
    if (!this.asset) {
      return
    }

    const box = (width: number, height: number, depth: number, extra: number) => {
      const he = extra / 2
      const faceUV = [
        new BABYLON.Vector4(-he, -he, width + he, height + he), // back
        new BABYLON.Vector4(-he, -he, width + he, height + he), // front
        new BABYLON.Vector4(-he, -he, height + he, depth + he), // right
        new BABYLON.Vector4(-he, -he, height + he, depth + he), // left
        new BABYLON.Vector4(-he, -he, depth + he, width + he), // top
        new BABYLON.Vector4(-he, -he, depth + he, width + he), // bottom
      ]

      const options = {
        width: width + extra,
        height: height + extra,
        depth: depth,
        faceUV: faceUV,
      }

      return BABYLON.MeshBuilder.CreateBox(this.uniqueEntityName('mesh'), options, this.scene)
    }
    this.addScriptTriggers()
    this.addEvents()

    if (!this.assetHelper?.isOwner(this.parcel.owner)) {
      return
    }
    if (!this.description.hasFrame) {
      return
    }
    // Generate boxes
    const outer_box = box(this.scale.x, this.scale.y, frameThick, frameThick)
    const inner_box = box(this.scale.x, this.scale.y, frameThick, 0)

    // CSG
    const c = BABYLON.CSG.FromMesh(outer_box)
    c.subtractInPlace(BABYLON.CSG.FromMesh(inner_box))

    // Dispose frame boxes
    outer_box.dispose()
    inner_box.dispose()

    // Set material
    this.frame = c.toMesh('nft-image-frame', frameMaterial.material, this.scene, false)
    if (this.parent) {
      this.frame.parent = this.parent
    }
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
      hasGui: !!props.feature.description.hasGui,
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
      hasGui: this.state.hasGui,
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

    const r = await opensea(nftInfo.contract, nftInfo.token, nftInfo.chain, app.state.wallet, cachebust)

    const helper = new OpenseaAssetHelper(r)
    this.setState({ isOwner: helper.isOwner(app.state.wallet) })
  }

  onBlendModeChange = (e: string) => {
    this.setState({ blendMode: e })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit NFT Image</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={this.props.feature} scene={this.props.scene} />
          {/* keys are provided so that the getState in the component is reset after gizmo is used */}
          <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
          <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
          <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />

          <UrlSourceNftImages feature={this.props.feature} handleStateChange={this.onUrlChange} />

          <Advanced>
            <FeatureID feature={this.props.feature} />
            <SetParentDropdown feature={this.props.feature} />

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

            <div className="f">
              <label>Gui</label>
              <label>
                <input type="checkbox" checked={this.state.hasGui} onChange={(e) => this.setState({ hasGui: e.currentTarget.checked })} />
                Show Information on click
              </label>
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

            <TriggerEditor feature={this.props.feature} />
            <UuidReadOnly feature={this.props.feature} />
            <Script feature={this.props.feature} />
          </Advanced>
        </div>
      </section>
    )
  }
}

NftImage.Editor = Editor
