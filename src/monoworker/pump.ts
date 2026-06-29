import type { FeatureRecord, SortableFeature, InstanceRelation, LoadOrderItem, InstanceRelationMap } from '../pump/types'
import { workerIdentifyInstances, workerCreateLoadOrderWithSortableFeatures } from '../pump/worker-functions'

export async function requestInstanceIdentification(features: FeatureRecord[]): Promise<InstanceRelationMap> {
  if (!Array.isArray(features)) {
    throw new Error('Invalid features array')
  }

  const instanceRelations = workerIdentifyInstances(features)
  const map: InstanceRelationMap = new Map()
  for (const [instanceUuid, baseUuid] of instanceRelations) {
    map.set(instanceUuid, baseUuid)
  }
  return map
}

export async function requestFeatureSorting(
  features: SortableFeature[],
  instanceRelations: InstanceRelation[],
  cameraPosition: [number, number, number],
  cameraDirection: [number, number, number],
  maxDrawDistance = 200,
  currentParcelId?: number,
): Promise<LoadOrderItem[]> {
  if (!Array.isArray(features)) {
    throw new Error('Invalid features array')
  }

  if (!Array.isArray(instanceRelations)) {
    throw new Error('Invalid instanceRelations array')
  }

  if (!Array.isArray(cameraPosition) || cameraPosition.length !== 3) {
    throw new Error('Invalid camera position - must be [x, y, z] array')
  }

  if (!Array.isArray(cameraDirection) || cameraDirection.length !== 3) {
    throw new Error('Invalid camera direction - must be [x, y, z] array')
  }

  if (cameraPosition.some((v: number) => isNaN(v)) || cameraDirection.some((v: number) => isNaN(v))) {
    throw new Error('Camera position or direction contains NaN values')
  }

  const dirLength = Math.sqrt(cameraDirection[0] * cameraDirection[0] + cameraDirection[1] * cameraDirection[1] + cameraDirection[2] * cameraDirection[2])
  if (dirLength === 0) {
    throw new Error('Camera direction cannot be zero vector')
  }

  return workerCreateLoadOrderWithSortableFeatures(features, instanceRelations, cameraPosition, cameraDirection, maxDrawDistance, currentParcelId)
}
