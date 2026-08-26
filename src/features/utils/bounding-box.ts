import type Feature from '../feature'
import { Mesh } from '@babylonjs/lite'

export const boundingBoxesOfFeatures = (features: Array<Feature>): any[] => {
  return features.map((feature: Feature) => feature.boundingBox).filter((boundingBox) => boundingBox) as any[]
}

export const boundingBoxOfMesh = (mesh: Mesh): any => {
  const isTransformNode = (mesh: Mesh) => {
    return (false /* todo(lite): mesh instanceof BABYLON.TransformNode */) && !mesh['getBoundingInfo']
  }

  // hack to allow highlight of polytext and other features that use a TransformNode
  // can't just check for transform node, because everything inherits from it
  if (isTransformNode(mesh)) {
    mesh = mesh.getChildren()[0] as Mesh
  }
  // In some cases the child of the transform node is still a transform node; I assume this happens for groups in groups
  while (isTransformNode(mesh)) {
    try {
      mesh = mesh.getChildren()[0] as Mesh
    } catch {
      console.warn('BoundingBoxOfMesh: Error in obtaining a mesh')
      break
    }
  }

  return mesh.getBoundingInfo().boundingBox
}

export const boundingBoxOfBoundingBoxes = (boundingBoxes: any[]): any => {
  if (boundingBoxes.length === 1) {
    boundingBoxes[0]
  }

  let { minimumWorld: min, maximumWorld: max } = boundingBoxes[0]

  for (let i = 0; i < boundingBoxes.length; i++) {
    const { minimumWorld: nextMix, maximumWorld: nextMax } = boundingBoxes[i]

    min = (undefined as any /* todo(lite): BABYLON.Vector3.Minimize(min, nextMix) */)
    max = (undefined as any /* todo(lite): BABYLON.Vector3.Maximize(max, nextMax) */)
  }

  return (undefined as any /* todo(lite): new BABYLON.BoundingBox(min, max) */)
}
