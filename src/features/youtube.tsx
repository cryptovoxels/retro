import { h } from 'preact'
import { YoutubeRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { fetchNoImageTexture, fetchTexture } from '../textures/textures'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { isURL } from '../utils/helpers'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D } from './feature'

export function buildYoutubeThumbnailUrl(videoId: string | undefined): string | null {
  if (!videoId) {
    return null
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

export async function loadYoutubeThumbnail(scene: BABYLON.Scene, videoId: string | undefined, signal: AbortSignal): Promise<BABYLON.Texture> {
  const thumbnailUrl = buildYoutubeThumbnailUrl(videoId)
  if (!thumbnailUrl) {
    return fetchNoImageTexture(scene)
  }

  return new Promise((resolve) => {
    const texture = new BABYLON.Texture(
      thumbnailUrl,
      scene,
      false,
      true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      () => resolve(texture),
      async () => resolve(await fetchNoImageTexture(scene)),
    )

    signal.addEventListener('abort', () => texture.dispose(), { once: true })
  })
}

export default class Youtube extends Feature2D<YoutubeRecord> {
  static metadata: FeatureMetadata = {
    title: 'Youtube / Twitch',
    subtitle: 'Link to videos and livestreams',
    type: 'youtube',
    image: '/icons/youtube.png',
  }
  static template: FeatureTemplate = {
    type: 'youtube',
    scale: [2, 1, 0],
    url: '',
  }

  // https://www.youtube.com/watch?v=wIft-t-MQuE&
  get videoId() {
    if (!this.url) {
      return undefined
    }
    try {
      if (this.isYoutube) {
        if (this.url.match('youtu.be')) {
          // handle shortened youtube links
          return (this.url.match(/youtu\.be\/([^?]+)/) || [])[1]
        } else {
          return (this.url.match(/\?v=([^&]+)/) || [])[1]
        }
      } else if (this.isTwitch) {
        return (this.url.match(/(com|tv)\/(\w+)/) || [])[2]
      }
    } catch (e) {
      return undefined
    }
  }

  get isYoutube() {
    return !!this.url?.match('youtube.com|youtu.be')
  }

  get isTwitch() {
    return !!this.url?.match('twitch')
  }

  get previewUrl(): string | null {
    if (this.description.previewUrl && typeof this.description.previewUrl === 'string') {
      return this.description.previewUrl
    } else if (this.isYoutube) {
      return `https://i.ytimg.com/vi/${this.videoId}/hqdefault.jpg`
    } else {
      return null
    }
  }

  toString() {
    return this.url || super.toString()
  }

  shouldBeInteractive(): boolean {
    return !!this.url && isURL(this.url)
  }

  whatIsThis() {
    return <label>Opens a youtube or twitch link in a new tab. </label>
  }

  generate() {
    this.mesh = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    this.mesh.id = this.mesh.name + '/' + this.uuid
    this.setCommon()
    this.setPreview()
    this.addEvents()
    return Promise.resolve()
  }

  async setPreview() {
    if (this.disposed) return

    if (this.isTwitch) {
      this.setTwitchPreview()
      return
    }

    let texture: BABYLON.Texture
    if (this.description.previewUrl) {
      texture = await fetchTexture(this.scene, this.previewUrl, this.abortController.signal, { transparent: false, stretch: true })
    } else {
      texture = await loadYoutubeThumbnail(this.scene, this.videoId, this.abortController.signal)
    }
    texture.hasAlpha = false

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = texture
    material.backFaceCulling = false
    material.zOffset = -4
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 1, 1)
    material.blockDirtyMechanism = true

    if (this.mesh) {
      this.mesh.material = material
    }
  }

  setTwitchPreview() {
    if (this.disposed) return
    const channel = this.videoId ?? 'unknown'
    const w = 640
    const h = 360
    const tex = new BABYLON.DynamicTexture(this.uniqueEntityName('tpreview' as any), { width: w, height: h }, this.scene, false)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    const font = 'bold 18px "Source Code Pro", monospace'

    ctx.fillStyle = '#1a1a1e'
    ctx.fillRect(0, 0, w, h)

    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#9146ff'
    ctx.fillText('twitch / ' + channel, w / 2, h / 2 - 40)

    ctx.fillStyle = '#f5f5f0'
    ctx.fillText('twitch disabled embedding', w / 2, h / 2)

    const cta = '\u25B6 open on twitch.tv'
    const tw = ctx.measureText(cta).width
    const padX = 14
    const padY = 10
    const bw = tw + padX * 2
    const bh = 20 + padY * 2
    const bx = w / 2 - bw / 2
    const by = h / 2 + 30
    ctx.fillStyle = 'rgba(145,70,255,0.85)'
    ctx.fillRect(bx, by, bw, bh)
    ctx.fillStyle = '#f5f5f0'
    ctx.fillText(cta, w / 2, by + bh / 2)

    tex.update()
    tex.hasAlpha = false

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = tex
    material.backFaceCulling = false
    material.zOffset = -4
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 1, 1)
    material.blockDirtyMechanism = true

    if (this.mesh) this.mesh.material = material
  }

  onClick() {
    if (this.isTwitch) {
      window.open('https://twitch.tv/' + this.videoId, '_blank')
    } else if (this.isYoutube && this.videoId) {
      window.open('https://www.youtube.com/watch?v=' + this.videoId, '_blank')
    } else if (this.url) {
      window.open(this.url, '_blank')
    }
    this.behaviours?.dispatch(this.uuid, 'click')
  }
}

class Editor extends FeatureEditor<Youtube> {
  constructor(props: FeatureEditorProps<Youtube>) {
    super(props)

    if (!props.feature.description.screenRatio) {
      props.feature.description.screenRatio = '169'
    }

    this.state = {
      id: props.feature.description.id,
      url: props.feature.description.url,
      previewUrl: props.feature.description.previewUrl,
      screenRatio: props.feature.description.screenRatio,
    }
  }

  componentDidUpdate() {
    this.merge({
      url: this.state.url,
      previewUrl: this.state.previewUrl,
      screenRatio: this.state.screenRatio,
      inverted: !!this.state.inverted,
    })
  }

  changeRatio(e: h.JSX.TargetedEvent<HTMLInputElement, Event>) {
    this.props.feature.description.screenRatio = e.currentTarget.value
    this.setState({ screenRatio: e.currentTarget.value })
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

          <div className="f">
            <label>URL</label>
            <input type="text" value={this.state.url} onInput={(e) => this.setState({ url: e.currentTarget.value })} />

            <small>
              Supported URLs:
              <br /> * Youtube single video
              <br /> * Twitch channel
            </small>
          </div>

          <div className="f">
            <label>Preview Image URL (optional)</label>
            <input type="text" value={this.state.previewUrl} onInput={(e) => this.setState({ previewUrl: e.currentTarget.value })} />
            <small>Shown on the screen. If empty, uses the youtube thumbnail (or a link CTA for twitch).</small>
          </div>
          <Advanced>
            <FeatureID feature={this.props.feature} />

            <div className="f">
              <label>Video size ratio</label>
              <input type="radio" checked={this.props.feature.description.screenRatio === '43'} onChange={this.changeRatio.bind(this)} name="ratio" value="43" /> 4:3&nbsp;&nbsp;&nbsp;
              <input type="radio" checked={this.props.feature.description.screenRatio === '169'} onChange={this.changeRatio.bind(this)} name="ratio" value="169" /> 16:9
            </div>

            <Behaviours feature={this.props.feature} />
          </Advanced>
        </EditorProps>
      </section>
    )
  }
}

Youtube.Editor = Editor
