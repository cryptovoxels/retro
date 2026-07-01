import { ParticlesRecord } from '../../common/messages/feature'
import { Position, Rotation, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { tidyColor3, tidyFloat } from '../utils/helpers'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature3D } from './feature'

const clamp = (v: number, min: number, max: number) => {
  return Math.min(Math.max(v, min), max)
}
export default class ParticleSystem extends Feature3D<ParticlesRecord> {
  static metadata: FeatureMetadata = {
    title: 'Particles',
    subtitle: 'particle emitter',
    type: 'particles',
    image: '/icons/particles.png',
  }
  static template: FeatureTemplate = {
    type: 'particles',
    scale: [1, 1, 1],
    rotation: [Math.PI / 2, 0, 0],
    color1: '#808080',
    color2: '#333333',
    colorDead: '#000033',
    opacityDead: 0.0,
    gravity: 9.81,
  }
  particleSystem: BABYLON.ParticleSystem | null = null

  get emitRate() {
    return this.description.emitRate || 100
  }

  get minSize() {
    return this.description.minSize || 0.1
  }

  get maxSize() {
    return this.description.maxSize || 0.5
  }

  private _showTarget = false

  set showTarget(value: boolean) {
    this._showTarget = value
    if (this.mesh?.material) {
      this.mesh.visibility = value ? 1 : 0
    }
  }

  whatIsThis() {
    return <label>An emitter of particles given a certain intensity, color or image.</label>
  }

  async generate() {
    if (this.disposed) throw new Error('disposed')

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.specularColor.set(0, 0, 0)
    material.emissiveColor.set(1, 0, 1)
    material.backFaceCulling = false
    material.zOffset = -7

    const plane = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene)
    plane.material = material
    plane.visibility = this._showTarget ? 1 : 0

    this.mesh = plane
    this.setCommon()
    this.addAnimation()
    this.addScriptTriggers()

    if (this.deprecatedSince('5.7.0')) {
      this.mesh.rotation.x = Math.PI / 2
    }
    this.mesh.translate(BABYLON.Axis.Z, -0.1, BABYLON.Space.LOCAL)

    await this.createParticleSystem(this.mesh)
    this.refreshWorldMatrix()
  }

  async createParticleSystem(plane: BABYLON.AbstractMesh) {
    this.particleSystem = new BABYLON.ParticleSystem('feature/particle-system', 200, this.scene)

    const url = this.url ? `${process.env.IMG_URL}/img?url=${encodeURIComponent(this.url)}&passthrough=true` : process.env.ASSET_PATH + '/textures/diamond.png'

    // Texture of each particle
    this.particleSystem.particleTexture = new BABYLON.Texture(url, this.scene)
    if (this.disposed) throw new Error('disposed')

    // Where the particles come from
    this.particleSystem.emitter = plane // the starting object, the emitter
    this.particleSystem.minEmitBox = new BABYLON.Vector3(-0.5, 0, -0.5) // Starting all from
    this.particleSystem.maxEmitBox = new BABYLON.Vector3(0.5, 0, 0.5) // To...

    // Colors of particles
    if (!this.description.url) {
      try {
        this.particleSystem.color1 = BABYLON.Color4.FromColor3(tidyColor3(this.description.color1, '#808080'), 1)

        this.particleSystem.color2 = BABYLON.Color4.FromColor3(tidyColor3(this.description.color2, '#333333'), 1)
      } catch (e) {
        this.particleSystem.color1 = new BABYLON.Color4(1, 0, 0, 1)
        this.particleSystem.color2 = new BABYLON.Color4(1, 0, 0, 1)
      }
    }

    try {
      this.particleSystem.colorDead = BABYLON.Color4.FromColor3(BABYLON.Color3.FromHexString(this.description.colorDead || '#000033'), clamp(tidyFloat(this.description.opacityDead, 0.0), 0, 1))
    } catch (e) {
      this.particleSystem.colorDead = new BABYLON.Color4(1, 0, 0, 1)
    }

    // Size of each particle (random between...
    this.particleSystem.minSize = this.minSize
    this.particleSystem.maxSize = this.maxSize

    // Life time of each particle (random between...
    this.particleSystem.minLifeTime = 0.3
    this.particleSystem.maxLifeTime = 0.6

    // Emission rate
    this.particleSystem.emitRate = this.emitRate
    this.particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD

    let gravity = 9.81
    try {
      gravity = clamp(tidyFloat(this.description.gravity, 9.81), 0.0, 30.0)
    } catch (e) {}

    // Set the gravity of all particles
    this.particleSystem.gravity = new BABYLON.Vector3(0, -gravity, 0)

    // Direction of each particle after it has been emitted
    this.particleSystem.direction1 = new BABYLON.Vector3(-0.2, 0, -10)
    this.particleSystem.direction2 = new BABYLON.Vector3(0, 0.2, -10)

    // Angular speed, in radians
    this.particleSystem.minAngularSpeed = 5
    this.particleSystem.maxAngularSpeed = 10

    // Speed
    this.particleSystem.minEmitPower = 0.2
    this.particleSystem.maxEmitPower = 1
    this.particleSystem.updateSpeed = 0.005

    // Start the particle system
    this.particleSystem.start()
  }

  toString() {
    return '[particles]'
  }

  dispose() {
    if (this.particleSystem) {
      this.particleSystem.dispose()
    }
    super.dispose()
  }
}

class Editor extends FeatureEditor<ParticleSystem> {
  constructor(props: FeatureEditorProps<ParticleSystem>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      emitRate: tidyFloat(props.feature.description.emitRate, 100),
      minSize: tidyFloat(props.feature.description.minSize, 0.1),
      maxSize: tidyFloat(props.feature.description.maxSize, 0.5),
      color1: props.feature.description.color1,
      color2: props.feature.description.color2,
      colorDead: props.feature.description.colorDead,
      opacityDead: props.feature.description.opacityDead,
      gravity: props.feature.description.gravity,
      url: props.feature.description.url,
    }
  }

  componentDidUpdate() {
    this.merge({
      emitRate: parseFloat(this.state.emitRate),
      minSize: parseFloat(this.state.minSize),
      maxSize: parseFloat(this.state.maxSize),
      color1: this.state.color1,
      color2: this.state.color2,
      colorDead: this.state.colorDead,
      opacityDead: this.state.opacityDead,
      gravity: this.state.gravity,
      url: this.state.url,
    })
  }

  componentDidMount() {
    super.componentDidMount()
    this.props.feature.showTarget = true
  }

  componentWillUnmount() {
    this.props.feature.showTarget = false
    super.componentWillUnmount()
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Particles</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={this.props.feature} scene={this.props.scene} />
          <EditorProps>
            {/* keys are provided so that the getState in the component is reset after gizmo is used */}
            <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
            <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />
            <Animation feature={this.props.feature} />

            <div className="f">
              <label>URL</label>
              <input type="text" value={this.state.url} onInput={(e) => this.setState({ url: e.currentTarget.value })} />
            </div>

            <div className="f">
              <label>Emit Rate</label>
              <input type="range" min={1} max={150} step={5} value={this.state.emitRate} onInput={(e) => this.setState({ emitRate: parseFloat(e.currentTarget.value) })} />
            </div>

            <div className="f">
              <label>Minimum Size</label>
              <input type="range" min={0.1} max={1} step={0.04} value={this.state.minSize} onInput={(e) => this.setState({ minSize: parseFloat(e.currentTarget.value) })} />
            </div>

            <div className="f">
              <label>Maximum Size</label>
              <input type="range" min={0.1} max={1} step={0.04} value={this.state.maxSize} onInput={(e) => this.setState({ maxSize: parseFloat(e.currentTarget.value) })} />
            </div>

            <Advanced>
              <FeatureID feature={this.props.feature} />

              <div className="f">
                <label>Color 1</label>
                <input type="color" value={this.state.color1} onInput={(e) => this.setState({ color1: e.currentTarget.value })} />
              </div>

              <div className="f">
                <label>Color 2</label>
                <input type="color" value={this.state.color2} onInput={(e) => this.setState({ color2: e.currentTarget.value })} />
              </div>

              <div className="f">
                <label>Final color</label>
                <input type="color" value={this.state.colorDead} onInput={(e) => this.setState({ colorDead: e.currentTarget.value })} />
              </div>

              <div className="f">
                <label>Final opacity: {this.state.opacityDead}</label>
                <input type="range" value={this.state.opacityDead} min="0.0" max="1.0" step="0.1" onInput={(e) => this.setState({ opacityDead: parseFloat(e.currentTarget.value) })} />
              </div>

              <div className="f">
                <label>Gravity: {this.state.gravity}</label>
                <input type="range" value={this.state.gravity} min="0.0" max="30" onInput={(e) => this.setState({ gravity: parseFloat(e.currentTarget.value) })} />
              </div>

              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

ParticleSystem.Editor = Editor
