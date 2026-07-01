import { setCameraPosition, setCameraRotation } from '../utils/camera'
import { Feature3D } from './feature'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { Position, Scale, Rotation } from '../../web/src/components/editor'
import { PoseBallRecord } from '../../common/messages/feature'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Animations, AnimationYOffset } from '../avatar-animations'
import { EmoteAnimation, Idle } from '../states'

export default class PoseBall extends Feature3D<PoseBallRecord> {
  public static metadata: FeatureMetadata = {
    title: 'PoseBall',
    subtitle: 'avatar poses',
    type: 'pose-ball',
    image: '/icons/spawn-point.png',
  }

  public static template: FeatureTemplate = {
    type: 'pose-ball',
    scale: [0.5, 0.5, 0.5],
    animation: 'sitting',
  }

  private currentAnimation?: EmoteAnimation

  public override toString = () => '[pose-ball]'

  public override onClick = () => this.pose()

  whatIsThis() {
    return <label>A pose ball that allows players to sit or pose in different animations.</label>
  }

  static material: BABYLON.StandardMaterial | undefined

  public override async generate() {
    this.mesh = BABYLON.MeshBuilder.CreateSphere(this.uniqueEntityName('mesh'), { diameter: 1, segments: 12 }, this.scene)
    this.mesh.isPickable = true

    if (!PoseBall.material) {
      const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
      material.emissiveColor = BABYLON.Color3.FromHexString('#606060')
      material.disableLighting = true
      material.alpha = 0.5
      material.backFaceCulling = true
      material.disableDepthWrite = true
      PoseBall.material = material
    }

    // this.mesh.renderingGroupId = 2
    this.mesh.material = PoseBall.material

    this.setCommon()
    this.addEvents()
    this.addAnimation()
  }

  public override dispose() {
    this.unpose()
    super.dispose()
  }

  // helps to keep track when to disable/enable gravity and collision detection
  private static activePoses = 0

  private observer?: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>>

  private pose() {
    if (!this.avatar) return
    if (isNaN(Number(this.description.pose))) return

    const animation = Number(this.description.pose)

    if (PoseBall.activePoses === 0) {
      this.connector.controls.disableGravity()
      if (this.scene.activeCamera && 'checkCollisions' in this.scene.activeCamera) {
        this.scene.activeCamera.checkCollisions = false
      }
    }

    PoseBall.activePoses++

    setCameraRotation(this.scene, this.rotation)

    const position = this.positionInGrid.clone()
    position.y += AnimationYOffset(animation)
    position.y += this.avatar.height
    position.y += this.scale.y / 2
    setCameraPosition(this.scene, position)

    this.currentAnimation = new EmoteAnimation(animation)

    window.persona.setState({ state: this.currentAnimation }, this.connector.controls)

    this.observer = this.scene.onAfterRenderObservable.add(() => {
      if (!this.avatar) return
      // unpose the avatar if it moves more than 2 meters away from the pose ball
      const sqrDist = BABYLON.Vector3.DistanceSquared(this.avatar?.position, this.positionInGrid)
      if (sqrDist > 2 * 2) {
        this.unpose()
      }
    })
  }

  shouldBeInteractive(): boolean {
    return true
  }

  unpose() {
    if (!this.currentAnimation) return

    if (this.observer) {
      this.scene.onAfterRenderObservable.remove(this.observer)
      this.observer = undefined
    }

    window.persona.setState({ state: new Idle() }, this.connector.controls)

    this.currentAnimation = undefined

    PoseBall.activePoses--

    if (PoseBall.activePoses === 0) {
      this.connector.controls.enableGravity()

      if (this.scene.activeCamera && 'checkCollisions' in this.scene.activeCamera) {
        this.scene.activeCamera.checkCollisions = true
      }
    }
  }
}

class Editor extends FeatureEditor<PoseBall> {
  constructor(props: FeatureEditorProps<PoseBall>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      pose: props.feature.description.pose,
      text: props.feature.description.text,
    }
  }

  componentDidUpdate() {
    this.merge({
      pose: this.state.pose,
      text: this.state.text,
    })
  }

  render() {
    return (
      <section>
        <Toolbar feature={this.props.feature} scene={this.props.scene} />

        <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
        <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
        <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />

        <div className="f">
          <label>Text</label>
          <input type="text" value={this.state.text} maxLength={16} onInput={(e) => this.setState({ text: e.currentTarget.value })} />
        </div>

        <div className="f">
          <label>Pose</label>
          <select value={this.state.pose} onChange={(e) => this.setState({ pose: e.currentTarget.value })}>
            <option>Choose a pose</option>
            <option value={Animations.Sitting}>{Animations[Animations.Sitting]}</option>
            <option value={Animations.Applause}>{Animations[Animations.Applause]}</option>
            <option value={Animations.Celebration}>{Animations[Animations.Celebration]}</option>
          </select>
        </div>

        <Advanced>
          <FeatureID feature={this.props.feature} />
        </Advanced>
      </section>
    )
  }
}

PoseBall.Editor = Editor
