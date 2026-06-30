import { transformVectors } from '../features/feature'

// if we want to change the parent, but preserve the screen appearance, use this function to find what the feature's transforms should be updated to.
export const getTransformVectorsRelativeToNode = (forNode: BABYLON.TransformNode, relativeTo: BABYLON.Node): transformVectors => {
  const quatRotation = new BABYLON.Quaternion()
  const position = new BABYLON.Vector3()
  const scaling = new BABYLON.Vector3()

  const rotation = forNode.rotation.clone()

  forNode.computeWorldMatrix()
  relativeTo.computeWorldMatrix()

  const invertedNodeMatrix = new BABYLON.Matrix()
  relativeTo.getWorldMatrix().invertToRef(invertedNodeMatrix)

  const outputMatrix = new BABYLON.Matrix()
  forNode.getWorldMatrix().multiplyToRef(invertedNodeMatrix, outputMatrix)

  outputMatrix.decompose(scaling, quatRotation, position)
  quatRotation.toEulerAnglesToRef(rotation)

  return { rotation, position, scaling }
}
