import { GroupRecord } from '../../common/messages/feature'
import { Position, Rotation, Behaviours, EditorProps } from '../../web/src/components/editor'
import { FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { FeatureTemplate } from './_metadata'
import Feature, { MeshExtended, NonMeshedFeature, transformVectors } from './feature'
import { boundingBoxesOfFeatures, boundingBoxOfBoundingBoxes } from './utils/bounding-box'

const getTransformArrays = (
  mesh: BABYLON.AbstractMesh | transformVectors,
): {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
} => {
  const position: [number, number, number] = [0, 0, 0]
  const rotation: [number, number, number] = [0, 0, 0]
  const scale: [number, number, number] = [1, 1, 1]

  mesh.position.toArray(position)
  mesh.rotation.toArray(rotation)
  mesh.scaling.toArray(scale)
  return { position, rotation, scale }
}

export default class Group extends NonMeshedFeature<GroupRecord> {
  static Editor: typeof Editor
  static template: FeatureTemplate = {
    scale: [1, 1, 1],
    type: 'group',
  }

  get children(): Array<Feature> {
    return this.parcel.featuresList.filter((feature) => feature?.groupId === this.uuid)
  }

  get boundingBox(): BABYLON.BoundingBox | null {
    const boundingBoxes = boundingBoxesOfFeatures(this.children)
    if (boundingBoxes.length) {
      return boundingBoxOfBoundingBoxes(boundingBoxes)
    }
    return null
  }

  whatIsThis() {
    return <label>Collect features into a group so that you can manipulate them as a single feature. </label>
  }

  // Note we consider ourself to be a descendant (though not a child) of ourself.
  descendants = (): Array<Feature> => {
    const result = this.children.flatMap((child) => (child instanceof Group ? child.descendants() : [child]))
    result.push(this)
    return result
  }

  deleteIfNoChildren = () => {
    if (!this.children.length) {
      this.delete()
    }
  }

  afterGenerate() {
    this.setCommon()
    this.addAnimation()
  }

  generate() {
    //@todo: Fix type casting here;
    this.mesh = new BABYLON.TransformNode('feature/parent', this.scene) as MeshExtended
    this.afterGenerate()
    return Promise.resolve()
  }

  toString() {
    return `[group]`
  }

  delete() {
    this.children.forEach((child) => child.delete())
    super.delete()
  }

  refreshWorldMatrix() {
    super.refreshWorldMatrix()
    this.children.forEach((child) => child.refreshWorldMatrix())
  }

  async regenerate() {
    await super.regenerate()

    await Promise.all(this.children.map((child) => child.regenerate()))
  }

  addChild = (child: Feature) => {
    if (!this.mesh) {
      throw new Error('Group: Transform Node not generated')
    }
    child.set({
      groupId: this.uuid,
      ...getTransformArrays(child.getTransformVectorsRelativeToNode(this.mesh)),
    })
  }

  addChildren = (children: Feature[]) => {
    children.forEach(this.addChild)
  }

  // make it so that the child's parent is the parent's parent
  sendChildToGrandparents = (child: Feature) => {
    if (!this.mesh?.parent) {
      throw new Error('Group sendChildToGrandparents: Transform Node not generated')
    }
    child.set({
      groupId: this.groupId,
      ...getTransformArrays(child.getTransformVectorsRelativeToNode(this.mesh.parent)),
    })
    this.deleteIfNoChildren()
  }

  sendChildrenToGrandparent = (children: Feature[]) => {
    children.forEach(this.sendChildToGrandparents)
  }

  // the child's parent becomes the parcel. As in- it has no group.
  abandonChild = (child: Feature) => {
    child.set({
      groupId: null,
      ...getTransformArrays(child.getTransformVectorsRelativeToNode(child.parcel.transform)),
    })
    this.deleteIfNoChildren()
  }

  dissolve = () => {
    this.sendChildrenToGrandparent(this.children)
    this.delete()
  }
}

class Editor extends FeatureEditor<Group> {
  onUngroup = () => {
    this.props.feature.dissolve()
    window.ui?.featureTool.unHighlight()
    window.ui?.showEditBrowse()
  }

  render() {
    const f = this.props.feature
    return (
      <section>
        <header>
          <h2>Edit Group</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={f} scene={this.props.scene} />
          <EditorProps>
            <button onClick={this.onUngroup}>Dissolve</button>
            <Position feature={f} key={f.position.toString()} />
            <Rotation feature={f} key={f.rotation.toString()} />
            <FeatureID feature={f} />
            <Behaviours feature={f} />
          </EditorProps>
        </div>
      </section>
    )
  }
}

Group.Editor = Editor
