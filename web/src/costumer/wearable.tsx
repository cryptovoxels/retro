import { Component } from 'preact'
import { voxImporter } from '../../../common/vox-import/vox-import'
import { Attachment } from './index'

interface Props {
  attachment: Attachment
  selected: boolean
  scene: BABYLON.Scene | null
  gizmoManager?: BABYLON.GizmoManager | null
  onSelect?: (evt: BABYLON.ActionEvent) => void
  onLoad?: (uuid: string, mesh: BABYLON.Mesh) => void
}

interface State {
  attached?: boolean
}

let selectionBoxMat: BABYLON.StandardMaterial | null = null

function getSelectionBoxMat(scene: BABYLON.Scene): BABYLON.StandardMaterial {
  if (!selectionBoxMat) {
    selectionBoxMat = new BABYLON.StandardMaterial('selection-box-mat', scene)
    selectionBoxMat.diffuseColor.set(0.9, 0.0, 0.6)
    // selectionBoxMat.emissiveColor.set(0.7, 0.7, 0.7)
  }

  return selectionBoxMat
}

function createBoxFrame(name: string, w: number, h: number, d: number, b: number, scene: BABYLON.Scene): BABYLON.Mesh {
  const hw = w / 2,
    hh = h / 2,
    hd = d / 2
  const edges: BABYLON.Mesh[] = []

  // 4 edges along X
  for (const [y, z] of [
    [-hh, -hd],
    [-hh, hd],
    [hh, -hd],
    [hh, hd],
  ] as [number, number][]) {
    const e = BABYLON.MeshBuilder.CreateBox('e', { width: w, height: b, depth: b }, scene)
    e.position.set(0, y, z)
    edges.push(e)
  }
  // 4 edges along Y
  for (const [x, z] of [
    [-hw, -hd],
    [-hw, hd],
    [hw, -hd],
    [hw, hd],
  ] as [number, number][]) {
    const e = BABYLON.MeshBuilder.CreateBox('e', { width: b, height: h, depth: b }, scene)
    e.position.set(x, 0, z)
    edges.push(e)
  }
  // 4 edges along Z
  for (const [x, y] of [
    [-hw, -hh],
    [-hw, hh],
    [hw, -hh],
    [hw, hh],
  ] as [number, number][]) {
    const e = BABYLON.MeshBuilder.CreateBox('e', { width: b, height: b, depth: d }, scene)
    e.position.set(x, y, 0)
    edges.push(e)
  }

  const merged = BABYLON.Mesh.MergeMeshes(edges, true, true)!
  merged.name = name
  return merged
}

export class Wearable extends Component<Props, State> {
  mesh: BABYLON.Mesh | null = null
  origin: BABYLON.TransformNode | null = null
  selectionBox: BABYLON.Mesh | null = null
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
    return `/api/collectibles/${this.props.attachment.wid}/vox`
  }

  private bone(bone: string): BABYLON.Bone | null {
    if (!this.skeleton) return null

    const lower = bone.toLowerCase()
    const found = this.skeleton.bones.find((b) => b.name.toLowerCase() === lower)

    if (!found) {
      console.error(`Bad bone name "${bone}"`)
      return null
    }

    return found
  }

  private focus(on: boolean) {
    if (on) {
      this.showSelectionBox()
    } else {
      this.selectionBox?.dispose()
      this.selectionBox = null
    }

    if (this.props.gizmoManager) {
      this.props.gizmoManager.attachToMesh(on ? this.mesh : null)
    }
  }

  private showSelectionBox() {
    if (!this.mesh || !this.scene) return
    this.selectionBox?.dispose()

    const bb = this.mesh.getBoundingInfo().boundingBox
    const size = bb.maximum.subtract(bb.minimum)
    const center = bb.minimum.add(size.scale(0.5))

    this.selectionBox = createBoxFrame('selection-box', size.x, size.y, size.z, 0.01, this.scene)
    this.selectionBox.parent = this.mesh
    this.selectionBox.position.copyFrom(center)
    this.selectionBox.material = getSelectionBoxMat(this.scene)
    this.selectionBox.isPickable = false
    this.selectionBox.renderingGroupId = 1
  }

  async componentDidMount() {
    this.mounted = true

    const opts = { invertX: false }

    if (!this.scene) {
      throw new Error('No scene')
    }

    if (!this.props.attachment.wid) return

    const mat = new BABYLON.StandardMaterial(`material`, this.scene)
    mat.emissiveColor.set(0.3, 0.3, 0.3) // need a little light otherwise dark wearables
    mat.diffuseColor.set(1, 1, 1)

    this.mesh = await voxImporter().import(this.voxUrl, {
      signal: AbortSignal.timeout(5000),
      invertX: false,
    })

    if (!this.mounted) {
      this.mesh.dispose()
      return
    }

    this.mesh.name = 'vox-instance'
    this.mesh.id = this.props.attachment.wid
    // this.mesh.material = mat

    this.mesh.rotationQuaternion = BABYLON.Quaternion.Identity()
    this.mesh.position.set(0, 0, 0)
    this.mesh.scaling.set(1, 1, 1)

    this.origin = new BABYLON.TransformNode('Node/wearable', this.scene)
    this.mesh.setParent(this.origin)

    if (this.props.selected) this.focus(true)

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

    if (this.props.onLoad && this.props.attachment.wid) {
      this.props.onLoad(this.props.attachment.wid, this.mesh)
    }
  }

  componentWillUnmount() {
    this.mounted = false
    this.selectionBox?.dispose()
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

    if (this.mesh && prevProps.selected !== this.props.selected) {
      this.focus(this.props.selected)
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
