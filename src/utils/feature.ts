import { transformVectors } from '../features/feature'
import { TransformNode } from '@babylonjs/lite'
import { quat, vec3 } from 'wgpu-matrix'

// if we want to change the parent, but preserve the screen appearance, use this function to find what the feature's transforms should be updated to.
export const getTransformVectorsRelativeToNode = (forNode: TransformNode, relativeTo: TransformNode): transformVectors => {
  const quatRotation = quat.identity()
  const position = vec3.create()
  const scaling = vec3.create()

  const rotation = forNode.rotation.clone()

  forNode.computeWorldMatrix()
  relativeTo.computeWorldMatrix()

  const invertedNodeMatrix = (undefined as any /* todo(lite): new BABYLON.Matrix() */)
  relativeTo.getWorldMatrix().invertToRef(invertedNodeMatrix)

  const outputMatrix = (undefined as any /* todo(lite): new BABYLON.Matrix() */)
  forNode.getWorldMatrix().multiplyToRef(invertedNodeMatrix, outputMatrix)

  outputMatrix.decompose(scaling, quatRotation, position)
  quatRotation.toEulerAnglesToRef(rotation)

  return { rotation, position, scaling }
}
