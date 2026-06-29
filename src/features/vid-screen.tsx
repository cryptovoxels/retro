import { exitPointerLock } from '../../common/helpers/ui-helpers'
import { throttle } from 'lodash'
import { render, unmountComponentAtNode } from 'preact/compat'
import { FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { VidScreenRecord } from '../../common/messages/feature'
import { Feature2D } from './feature'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'

function openControls(vidscreen: VidScreen) {
  const div = document.createElement('div')
  div.className = 'vid-screen overlay'
  document.body.appendChild(div)

  const close = () => {
    div && unmountComponentAtNode(div)
    window.connector.controls.enableMovement()
    div?.remove()

    document.body.removeEventListener('keydown', keydown)
    document.body.removeEventListener('keyup', keyup)

    vidscreen.stop()
  }
  window.connector.controls.disableMovement()
  exitPointerLock()

  const keys: keys = {
    up: false,
    down: false,
    left: false,
    right: false,
    a: false,
    b: false,
  }

  const sendKeys = throttle(() => vidscreen.sendKeys(keys), 1000 / 100, { leading: false, trailing: true })

  document.body.addEventListener('keydown', keydown)

  function keydown(e: KeyboardEvent) {
    if (e.keyCode === 37) keys.left = true
    if (e.keyCode === 38) keys.up = true
    if (e.keyCode === 39) keys.right = true
    if (e.keyCode === 40) keys.down = true
    if (e.keyCode === 65) keys.a = true
    if (e.keyCode === 66) keys.b = true
    if (e.keyCode === 83) keys.b = true // S
    if (e.keyCode === 27) close()

    sendKeys()
  }

  document.body.addEventListener('keyup', keyup)

  function keyup(e: any) {
    if (e.keyCode === 37) keys.left = false
    if (e.keyCode === 38) keys.up = false
    if (e.keyCode === 39) keys.right = false
    if (e.keyCode === 40) keys.down = false
    if (e.keyCode === 65) keys.a = false
    if (e.keyCode === 66) keys.b = false
    if (e.keyCode === 83) keys.b = false // S

    sendKeys()
  }

  render(
    <div>
      <p>
        <b>Playing Vid Screen</b>
        <br />
        Use Arrow keys to play game. Press A and B (or S) to shoot. You are frozen until you <button onClick={() => close()}>Close</button>.
      </p>
    </div>,
    div,
  )
}

type keys = {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  a: boolean
  b: boolean
}
export default class VidScreen extends Feature2D<VidScreenRecord> {
  static metadata: FeatureMetadata = {
    title: 'VidScreen',
    subtitle: 'Programmable 64x64 screen',
    type: 'vid-screen',
    image: '/icons/vid-screen.png',
  }
  static template: FeatureTemplate = {
    type: 'vid-screen',
    scale: [1, 1, 0],
  }
  texture: BABYLON.RawTexture | null = null
  running = false

  renderStatic() {
    const img = new Uint8Array(64 * 64 * 64 * 3)

    let i: number

    for (i = 0; i < 64 * 64 * 3; i += 3) {
      const r = Math.floor(Math.random() * 256)
      img[i + 0] = r
      img[i + 1] = r
      img[i + 2] = r
    }

    this.texture && this.texture.update(img)
  }

  generate() {
    const img = new Uint8Array(64 * 64 * 64 * 3)

    // Make a dynamic texture
    const texture = BABYLON.RawTexture.CreateRGBTexture(img, 64, 64, this.scene, false, true, BABYLON.Texture.NEAREST_SAMPLINGMODE)
    this.texture = texture
    this.renderStatic()

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseTexture = texture
    material.zOffset = -0.1
    material.specularColor.fromArray(this.description.specularColor || [1, 1, 1])

    const plane = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    plane.material = material
    this.mesh = plane
    this.setCommon()
    this.addEvents()

    return Promise.resolve()
  }

  updateScreen(screen: Uint8Array) {
    if (this.running && this.texture) {
      this.texture.update(screen)
    }
  }

  sendKeys(keys: keys) {
    if (!this.running) {
      return
    }

    if (this.behaviours) {
      this.behaviours.dispatch(this.uuid, 'keys', { keys })
    }
  }

  onClick() {
    if (this.running) {
      return
    }

    this.running = true

    if (this.behaviours) {
      this.behaviours.dispatch(this.uuid, 'start')
    }

    openControls(this)
  }

  stop() {
    this.running = false

    if (this.behaviours) {
      this.behaviours.dispatch(this.uuid, 'stop')
    }

    this.renderStatic()
  }

  whatIsThis(): string {
    return "It's a vid screen"
  }
}

class Editor extends FeatureEditor<VidScreen> {
  constructor(props: FeatureEditorProps<VidScreen>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
    }
  }

  componentDidUpdate() {
    this.merge({})
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit VidScreen</h2>
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

            <FeatureID feature={this.props.feature} />

            <Behaviours feature={this.props.feature} />
          </EditorProps>
        </div>
      </section>
    )
  }
}

VidScreen.Editor = Editor
