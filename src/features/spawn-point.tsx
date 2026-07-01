import { SpawnPointRecord } from '../../common/messages/feature'
import { voxImporter } from '../../common/vox-import/vox-import'
import { Position, Rotation, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Feature3D } from './feature'

export default class SpawnPoint extends Feature3D<SpawnPointRecord> {
  static metadata: FeatureMetadata = {
    title: 'Spawn point',
    subtitle: 'where avatars arrive',
    type: 'spawn-point',
    image: '/icons/spawn-point.png',
  }
  static template: FeatureTemplate = {
    type: 'spawn-point',
    scale: [1, 1, 1],
  }
  static Editor: any
  meshInside: BABYLON.Mesh | null = null
  matInside: BABYLON.StandardMaterial | null = null
  particleSystem: BABYLON.ParticleSystem | null = null

  toString() {
    return '[spawn-point]'
  }

  whatIsThis() {
    return <label>A landmark where users will spawn by default. Invisible to them.</label>
  }

  async generate() {
    try {
      const mesh = await voxImporter().import(process.env.ASSET_PATH + '/models/spawn-point-frame.vox', { signal: this.abortController.signal })

      const meshInside = await voxImporter().import(process.env.ASSET_PATH + '/models/blue_podium_pad.vox', { signal: this.abortController.signal })

      if (this.meshInside) {
        this.meshInside.dispose()
      }
      this.meshInside = meshInside

      if (this.mesh) {
        this.mesh.dispose()
      }
      this.mesh = mesh
      this.refreshVisible()
      this.meshInside.parent = this.mesh
      this.meshInside.position = BABYLON.Vector3.Zero()
      this.meshInside.checkCollisions = false
      this.matInside = this.meshInside.material as BABYLON.StandardMaterial

      const scale = 1
      this.description.scale = [scale, scale, scale]
      this.mesh.position.y -= 0.1 * this.mesh.scaling.y

      this.mesh.isPickable = true

      this.mesh.scaling.set(1, 1, 1)
      this.mesh.position.y -= 0

      this.mesh.name = this.uniqueEntityName('mesh')
      this.mesh.id = this.mesh.name

      this.setCommon()
      this.addEvents()
    } catch (error) {
      console.error(error)
      this.dispose()
      throw error
    }
  }

  dispose() {
    this.meshInside?.dispose()
    super.dispose()
  }

  stopEmit() {
    if (this.particleSystem) {
      const particleSystem = this.particleSystem
      particleSystem.emitRate = 0
      setTimeout(() => particleSystem.dispose(), 5000)
      this.particleSystem = null
    }
  }

  emitParticles(emoji: string) {
    this.stopEmit()

    const particleSystem = (this.particleSystem = new BABYLON.ParticleSystem('feature/spawn-point/emit-' + Math.round(Math.random() * 1000), 200, this.scene))

    //Texture of each particle
    const t = new BABYLON.DynamicTexture(this.uniqueEntityName('texture'), { width: 64, height: 64 }, this.scene, true)
    const ctx = t.getContext()

    ctx.font = '32px sans-serif'
    ctx.fillText(emoji, 8, 32)
    t.update()

    particleSystem.particleTexture = t

    // Where the particles come from
    particleSystem.emitter = this.mesh ?? null
    particleSystem.minEmitBox = new BABYLON.Vector3(-0.2, -0.1, -0.2) // Starting all from
    particleSystem.maxEmitBox = new BABYLON.Vector3(0.2, -0.1, 0.2) // To...

    // Colors of all particles
    particleSystem.color1 = new BABYLON.Color4(1, 1, 1, 1)
    particleSystem.color2 = new BABYLON.Color4(1, 1, 1, 1)
    particleSystem.colorDead = new BABYLON.Color4(1, 1, 1, 0)

    // Size of each particle (random between...
    particleSystem.minSize = 0.4
    particleSystem.maxSize = 0.5

    // Life time of each particle (random between...
    particleSystem.minLifeTime = 0.8
    particleSystem.maxLifeTime = 1

    // Emission rate
    particleSystem.emitRate = 5

    // Blend mode : BLENDMODE_ONEONE, or BLENDMODE_STANDARD
    particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD

    // Set the gravity of all particles
    particleSystem.gravity = new BABYLON.Vector3(0, 1, 0)

    // Direction of each particle after it has been emitted
    particleSystem.direction1 = new BABYLON.Vector3(0, 0, 0)
    particleSystem.direction2 = new BABYLON.Vector3(0, 0, 0)

    // Angular speed, in radians
    particleSystem.minAngularSpeed = 0
    particleSystem.maxAngularSpeed = 0 // Math.PI;

    // Speed
    particleSystem.minEmitPower = 0.2
    particleSystem.maxEmitPower = 1
    particleSystem.updateSpeed = 0.005

    // Start the particle system
    particleSystem.start()
  }

  afterSetCommon = () => {
    this.refreshVisible()
  }

  override afterUserChange() {
    this.refreshVisible()
  }

  refreshVisible() {
    const shouldShow = this.parcel.canEdit && !window.config.isOrbit

    if (this.mesh) {
      this.mesh.visibility = shouldShow ? 1 : 0
    }
    if (this.meshInside) {
      this.meshInside.visibility = shouldShow ? 1 : 0
    }

    if (shouldShow !== !!this.particleSystem) {
      if (shouldShow) {
        this.emitParticles('✨')
      } else {
        this.stopEmit()
      }
    }
  }
}

class Editor extends FeatureEditor<SpawnPoint> {
  constructor(props: FeatureEditorProps<SpawnPoint>) {
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
          <h2>Edit Spawn Point</h2>
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

            <div className="f">Only the owner and contributors can see it!</div>
            <Advanced>
              <FeatureID feature={this.props.feature} />

              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

SpawnPoint.Editor = Editor
