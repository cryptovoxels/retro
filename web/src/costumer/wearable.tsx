import { Component } from 'preact'
import voxImport from '../../../common/vox-import/sync-vox-import'
import { CostumeAttachment } from '../../../common/messages/costumes'
import { SUPPORTED_CHAINS_BY_ID } from '../../../common/helpers/chain-helpers'

const GLOW = new BABYLON.Color3(0.7, 0.3, 1.0)

interface Props {
  attachment: CostumeAttachment
  selected: boolean
  scene: BABYLON.Scene | null
  gizmoManager?: BABYLON.GizmoManager | null
  updateAttachment?: (attachment: CostumeAttachment) => void
  onSelect?: (evt: BABYLON.ActionEvent) => void
  onLoad?: (uuid: string, mesh: BABYLON.Mesh) => void
}

interface State {
  attached?: boolean
}

export class Wearable extends Component<Props, State> {
  mesh: BABYLON.Mesh | null = null
  origin: BABYLON.TransformNode | null = null
  mounted = false

  constructor(props: Props) {
    super(props)

    this.state = { attached: false }
  }

  private get scene() {
    return this.props.scene
  }

  private get avatar() {
    if (!this.scene) return null
    return this.scene.getMeshByName('avatar') as BABYLON.Mesh
  }

  private get skeleton() {
    return this.avatar?.skeleton ?? null
  }

  private get voxUrl() {
    const a = this.props.attachment
    return `/api/collections/${a.collection_id}/collectibles/${a.wearable_id}/vox`
  }

  private get layer() {
    return this.scene?.getHighlightLayerByName('selected') ?? null
  }

  private bone(bone: string): BABYLON.Bone | null {
    if (!this.skeleton) return null

    const index = this.skeleton.getBoneIndexByName(`mixamorig:${bone}`)

    if (index == -1) {
      console.error(`Bad bone name "${bone}"`)
      return null
    }

    return this.skeleton.bones[index]
  }

  private focus() {
    if (this.layer && this.mesh) {
      this.layer.removeAllMeshes()
      this.layer.addMesh(this.mesh, GLOW)
    }

    if (this.props.gizmoManager && this.mesh) {
      this.props.gizmoManager.attachToMesh(this.mesh)
    }
  }

  async componentDidMount() {
    this.mounted = true

    const opts = { invertX: false }

    if (!this.scene) {
      throw new Error('No scene')
    }

    const mat = new BABYLON.StandardMaterial(`wearable-${this.props.attachment.uuid}`, this.scene)
    mat.emissiveColor.set(0.3, 0.3, 0.3) // need a little light otherwise dark wearables
    mat.diffuseColor.set(1, 1, 1)
    mat.blockDirtyMechanism = true

    this.mesh = await voxImport(this.voxUrl, this.scene)

    if (!this.mounted) {
      this.mesh.dispose()
      return
    }

    this.mesh.name = 'vox-instance'
    this.mesh.id = this.props.attachment.uuid
    this.mesh.material = mat

    this.mesh.rotationQuaternion = BABYLON.Quaternion.Identity()
    this.mesh.position.set(0, 0, 0)
    this.mesh.scaling.set(1, 1, 1)

    this.origin = new BABYLON.TransformNode('Node/wearable', this.scene)
    this.mesh.setParent(this.origin)

    if (this.layer && this.props.selected) {
      this.focus()
    }

    this.mesh.actionManager = new BABYLON.ActionManager(this.scene)

    if (this.props.onSelect) {
      this.mesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickUpTrigger, this.props.onSelect))
    }

    // proxy the mesh with transform node
    const bone = this.bone(this.props.attachment.bone)

    if (bone && this.avatar) {
      this.origin.attachToBone(bone, this.avatar)
    }

    this.setTransform()

    if (this.props.onLoad) {
      this.props.onLoad(this.props.attachment.uuid, this.mesh)
    }
  }

  componentWillUnmount() {
    this.mounted = false
    this.mesh?.dispose()
    this.origin?.dispose()
  }

  componentDidUpdate(prevProps: Props) {
    if (this.origin && this.avatar) {
      const bone = this.bone(this.props.attachment.bone)

      if (bone) {
        this.origin.attachToBone(bone, this.avatar)
      }
    }

    // update mesh from state
    this.setTransform()

    if (this.mesh && prevProps.selected < this.props.selected) {
      this.focus()
    }
  }

  private setTransform() {
    if (!this.mesh) {
      return
    }
    const attachment = this.props.attachment
    this.mesh.position.fromArray(attachment.position)
    this.mesh.scaling.fromArray(attachment.scaling)
    this.mesh.rotationQuaternion = null
    this.mesh.rotation.fromArray(attachment.rotation.map((x) => (x * Math.PI) / 180))
  }

  render() {
    return null
  }
}
