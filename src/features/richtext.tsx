import { throttle } from 'lodash'
import { micromark } from 'micromark'
import { RichTextRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, BlendMode, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
// @ts-expect-error this is some dodgy vendor thing
import * as htmlToCanvas from '../vendor/html-to-canvas'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature2D } from './feature'

export default class Richtext extends Feature2D<RichTextRecord> {
  static iframe: HTMLIFrameElement | null = null
  static Editor: typeof RichtextEditor

  static metadata: FeatureMetadata = {
    title: 'Richtext',
    subtitle: 'a few lines of text',
    type: 'richtext',
    image: '/icons/richtext.png',
  }

  static template: FeatureTemplate = {
    type: 'richtext',
    scale: [2, 2, 0],
    text: `
  # Paragraph

  Your text goes here

  | Rank        | Winner    |
  | ----------- |:---------:|
  | 1.          | Hiro      |
  | 2.          | Parzival  |
  | 3.          | Neo       |

  `,
  }

  generate() {
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.alpha = 0.999

    material.zOffset = -16
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 1, 1)
    material.backFaceCulling = false

    if (this.blendMode === 'Multiply') {
      material.alphaMode = BABYLON.Engine.ALPHA_MULTIPLY
    } else if (this.blendMode === 'Screen') {
      material.alphaMode = BABYLON.Engine.ALPHA_SCREENMODE
    } else {
      material.emissiveColor.set(0, 0, 0)
    }

    const plane = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    material.blockDirtyMechanism = true
    plane.material = material

    this.mesh = plane
    this.setCommon()

    return Promise.resolve()
  }

  afterSetCommon = () => {
    this.render()
  }

  toString() {
    return micromark(this.description.text, 'Maruku').replace(/<.+?>/g, ' ')
  }

  whatIsThis() {
    return <label>A multi-line and markdown supporting text feature.</label>
  }

  private render() {
    if (!this.mesh) {
      //Should never happen
      throw new Error('Richtext Render: No mesh to render on')
    }
    let text = this.description.text?.toString() || ''

    const options: Record<string, number> = {
      width: this.scale.x * 128 * 2,
      height: this.scale.y * 128 * 2,
    }

    if (!Richtext.iframe) {
      Richtext.iframe = document.createElement('iframe')
      Richtext.iframe.setAttribute('sandbox', 'allow-same-origin')
      Richtext.iframe.style.cssText = 'position: absolute;  top: -1024px; left: 0; width: 512px; height: 512px; z-index: -1'
      document.body.appendChild(Richtext.iframe)

      const pageHtml = `
      <html>
        <head>
          <style>
            html, body{
              margin: 0;
              padding: 0;
              font-family: 'helvetica neue', sans-serif;
              font-size: 18px;
            }
            body{
            }
            table{
              width: 100%;
              border-collapse: collapse;
            }
            th{
              border-top: 1px solid #aaa;
              font-weight: bold;
            }
            td, th{
              border-bottom: 1px solid #aaa;
              text-align: left;
              padding: 0.3em 0;
            }
            *{
              box-sizing: border-box;
              line-height: 1.4em;
            }
            h1{
              margin-top: 0;
            }
            a{
              color: inherit;
            }
          </style>
        </head>
        <body>
        </body>
      </html>
      `

      const iDoc = Richtext.iframe.contentWindow?.document

      if (iDoc?.head) {
        iDoc.head.remove()
      }

      iDoc?.open()
      iDoc?.write(pageHtml)
      iDoc?.close()
    }

    text = text.replace(/</g, '&lt;')
    text = text.replace(/>/g, '&gt;')

    let html = micromark(text)
    html = `
      <body style="
        padding: 10px;
        width: ${options.width - 20}px;
        height: ${options.height}px;
        font-family: 'helvetica neue', sans-serif
        font-size: 18px;
        color: ${this.description.inverted ? 'white' : 'black'};
        background: ${this.description.inverted ? 'black' : 'white'}
      ">
        ${html}
      </body>
    `

    const iDoc = Richtext.iframe.contentWindow?.document
    if (iDoc?.body) {
      iDoc.body.outerHTML = html
    }

    const texture = new BABYLON.DynamicTexture(this.uniqueEntityName('texture'), options, this.scene, true)
    texture.hasAlpha = false

    const ctx = texture.getContext()
    ctx.fillStyle = this.description.inverted ? 'black' : 'white'
    ctx.fillRect(0, 0, options.width, options.height)
    htmlToCanvas(iDoc?.documentElement, ctx)
    texture.update(true)

    const m = this.mesh.material as BABYLON.StandardMaterial | null
    if (m) {
      m.diffuseTexture = texture
    }
  }
}

class RichtextEditor extends FeatureEditor<Richtext> {
  update: (text: string) => void

  constructor(props: FeatureEditorProps<Richtext>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      text: props.feature.description.text,
      blendMode: props.feature.description.blendMode,
      inverted: !!props.feature.description.inverted,
    }
    this.update = throttle(
      (text) => {
        this.setState({ text })
      },
      200,
      { leading: false, trailing: true },
    )
  }

  componentDidUpdate() {
    this.merge({
      text: this.state.text,
      inverted: !!this.state.inverted,
    })
  }

  onBlendModeChange = (blendMode: string) => {
    this.setState({ blendMode: blendMode })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Richtext</h2>
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
              <label>Text</label>
              <textarea onInput={(e) => this.update(e.currentTarget.value)} value={this.state.text} />
            </div>

            <Advanced>
              <FeatureID feature={this.props.feature} />

              <BlendMode feature={this.props.feature} handleStateChange={this.onBlendModeChange} />

              <div className="f">
                <label>
                  <input type="checkbox" checked={this.state.inverted} onInput={(e) => this.setState({ inverted: e.currentTarget.checked })} />
                  Inverted
                </label>
              </div>

              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Richtext.Editor = RichtextEditor
