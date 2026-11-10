import { takePose, leaveSeat, seated } from './pose'
import { Feature3D } from './feature'
import { Advanced, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { Position, Scale, Rotation } from '../../web/src/components/editor'
import { PoseBallRecord } from '../../common/messages/feature'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { Animations } from '../avatar-animations'

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

  public override toString = () => '[pose-ball]'

  get isInteract() {
    return true
  }
  get interactHint() {
    if (seated(this)) return 'stand'
    return Number(this.description.pose) === Animations.Sitting ? 'sit' : ''
  }

  public override onClick = () => {
    const animation = Number(this.description.pose)
    if (Number.isFinite(animation)) takePose(this, { animation, offset: [0, this.scale.y / 2, 0] })
  }

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
    leaveSeat(this)
    super.dispose()
  }

  shouldBeInteractive() {
    return true
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
