// ABOUTME: Pure functions extracted from pump-worker for testability and reuse
// ABOUTME: These functions handle instance detection, sorting, and feature grouping logic

import hash from 'object-hash'
import type { FeatureRecord, InstanceRelation, InstanceRelationMap, LoadOrderItem, SortableFeature } from './types'

const MATRIX_TRANSFORM_KEYS = new Set(['position', 'scale', 'rotation', 'collidable'])

function excludeKeys(key: string): boolean {
  return key === 'groupId' || key === 'uuid' || key === 'version' || key === 'animation' || MATRIX_TRANSFORM_KEYS.has(key)
}

export function featureKey(description: FeatureRecord): string | false {
  switch (description.type) {
    case 'image':
    case 'vox-model':
    case 'megavox':
    case 'cube':
      return hash(description, { excludeKeys })
    default:
      return false
  }
}

const featureKeyCache = new WeakMap<FeatureRecord, string | false>()

function getCachedFeatureKey(feature: FeatureRecord): string | false {
  if (featureKeyCache.has(feature)) {
    return featureKeyCache.get(feature)!
  }

  const key = featureKey(feature)
  featureKeyCache.set(feature, key)
  return key
}

export function groupInstanceableFeatures(features: FeatureRecord[]): Map<string, FeatureRecord[]> {
  const groups = new Map<string, FeatureRecord[]>()

  for (const feature of features) {
    const key = getCachedFeatureKey(feature)

    if (key === false) {
      groups.set(`unique_${feature.uuid}`, [feature])
    } else {
      const group = groups.get(key) || []
      group.push(feature)
      groups.set(key, group)
    }
  }

  return groups
}

export function identifyInstances(features: FeatureRecord[]): InstanceRelationMap {
  const instances: InstanceRelationMap = new Map()
  const groups = groupInstanceableFeatures(features)

  for (const [key, group] of groups.entries()) {
    if (key.startsWith('unique_') || group.length <= 1) continue

    const base = group[0]
    for (let i = 1; i < group.length; i++) {
      instances.set(group[i].uuid, base.uuid)
    }
  }

  return instances
}

export function workerIdentifyInstances(features: FeatureRecord[]): InstanceRelation[] {
  const instanceMap = identifyInstances(features)
  // Convert Map to array for serialization
  return Array.from(instanceMap.entries())
}

export function sortGroupsByHierarchy(groups: FeatureRecord[]): FeatureRecord[] {
  if (groups.length === 0) return []

  // Build dependency map
  const childToParent = new Map<string, string>()
  const allGroupIds = new Set(groups.map((g) => g.uuid))

  for (const group of groups) {
    if (group.groupId && allGroupIds.has(group.groupId)) {
      childToParent.set(group.uuid, group.groupId)
    }
  }

  if (childToParent.size === 0) {
    return groups.slice()
  }

  // Detect circular dependencies first
  const circularNodes = new Set<string>()
  const detectCircular = (startId: string) => {
    const path = new Set<string>()
    let current = startId

    while (current) {
      if (path.has(current)) {
        // Mark all nodes in this circular dependency
        for (const nodeId of path) {
          circularNodes.add(nodeId)
        }
        break
      }
      path.add(current)
      current = childToParent.get(current) || ''
    }
  }

  for (const group of groups) {
    detectCircular(group.uuid)
  }

  // Topological sort
  const sorted: FeatureRecord[] = []
  const visited = new Set<string>()

  const visit = (groupId: string) => {
    if (visited.has(groupId)) return
    visited.add(groupId)

    // Treat circular dependencies as root nodes
    if (!circularNodes.has(groupId)) {
      const parentId = childToParent.get(groupId)
      if (parentId) {
        visit(parentId)
      }
    }

    const group = groups.find((g) => g.uuid === groupId)
    if (group && !sorted.some((g) => g.uuid === groupId)) {
      sorted.push(group)
    }
  }

  for (const group of groups) {
    visit(group.uuid)
  }

  return sorted
}

export function categorizeWithPrecomputedInstances(features: FeatureRecord[], instanceRelations: InstanceRelationMap): { groups: FeatureRecord[]; baseFeatures: FeatureRecord[]; instances: Map<string, FeatureRecord[]> } {
  const groups: FeatureRecord[] = []
  const baseFeatures: FeatureRecord[] = []
  const instances = new Map<string, FeatureRecord[]>()

  for (const feature of features) {
    if (feature.type === 'group') {
      groups.push(feature)
    } else if (instanceRelations.has(feature.uuid)) {
      // This is an instance, group it with its base
      const baseUuid = instanceRelations.get(feature.uuid)!
      const instanceList = instances.get(baseUuid) || []
      instanceList.push(feature)
      instances.set(baseUuid, instanceList)
    } else {
      // This is a base feature
      baseFeatures.push(feature)
    }
  }

  return { groups, baseFeatures, instances }
}

export function calculateSortScore(
  worldPosition: [number, number, number],
  cameraPosition: [number, number, number],
  cameraDirection: [number, number, number],
  scale: [number, number, number],
  maxDrawDistance: number,
  parcelPenalty = 0,
): number {
  const dx = worldPosition[0] - cameraPosition[0]
  const dy = worldPosition[1] - cameraPosition[1]
  const dz = worldPosition[2] - cameraPosition[2]
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

  let distanceScore = 0
  let scaleScore = 0
  let directionScore = 0

  if (distance >= 0) {
    // Distance: 1.0 at camera, 0.0 at max draw distance
    distanceScore = Math.max(0, 1.0 - distance / maxDrawDistance)

    // Scale: normalized volume
    const normalizedScale = [scale[0] || 1, scale[1] || 1, scale[2] || 1]
    const scaleVolume = normalizedScale[0] * normalizedScale[1] * normalizedScale[2]
    scaleScore = Math.min(scaleVolume / 100, 1.0)

    // Direction: viewing angle bonus
    if (distance > 0) {
      const featureDir = [dx / distance, dy / distance, dz / distance]
      const camDirLength = Math.sqrt(cameraDirection[0] ** 2 + cameraDirection[1] ** 2 + cameraDirection[2] ** 2)

      if (camDirLength > 0) {
        const normalizedCamDir = [cameraDirection[0] / camDirLength, cameraDirection[1] / camDirLength, cameraDirection[2] / camDirLength]

        const dot = featureDir[0] * normalizedCamDir[0] + featureDir[1] * normalizedCamDir[1] + featureDir[2] * normalizedCamDir[2]

        if (dot >= 0.7) {
          directionScore = 1.0 // Forward view
        } else if (dot >= 0.0) {
          directionScore = 0.5 // Peripheral
        } else {
          directionScore = 0.1 // Behind camera
        }
      } else {
        directionScore = 0.5
      }
    } else {
      directionScore = 0.5 // At camera position
    }
  }

  // Combined score with weights
  const baseScore = distanceScore * 0.5 + scaleScore * 0.3 + directionScore * 0.2
  return Math.max(0, baseScore - parcelPenalty)
}

export function workerCreateLoadOrderWithSortableFeatures(
  sortableFeatures: SortableFeature[],
  instanceRelationsArray: InstanceRelation[],
  cameraPosition: [number, number, number],
  cameraDirection: [number, number, number],
  maxDrawDistance: number,
  currentParcelId?: number | string,
): LoadOrderItem[] {
  // Convert to FeatureRecord format
  const features: FeatureRecord[] = sortableFeatures.map((sf) => ({
    uuid: sf.uuid,
    type: sf.type,
    groupId: sf.groupId,
    position: sf.worldPosition,
  })) as FeatureRecord[]

  const instanceRelations: InstanceRelationMap = new Map(instanceRelationsArray)
  const { groups, baseFeatures, instances } = categorizeWithPrecomputedInstances(features, instanceRelations)

  const loadOrder: LoadOrderItem[] = []

  // Step 1: Load groups first
  const sortedGroups = sortGroupsByHierarchy(groups)
  if (sortedGroups.length > 0) {
    loadOrder.push(sortedGroups.map((g) => g.uuid))
  }

  // Step 2: Build position and scale lookup maps
  const featurePositionMap = new Map<string, [number, number, number]>()
  const featureScaleMap = new Map<string, [number, number, number]>()
  const featureParcelMap = new Map<string, number | string>()
  for (const sf of sortableFeatures) {
    featurePositionMap.set(sf.uuid, sf.worldPosition)
    featureScaleMap.set(sf.uuid, sf.scale)
    featureParcelMap.set(sf.uuid, sf.parcelId)
  }

  // Track feature count per parcel for penalties
  const parcelFeatureCounts = new Map<number | string, number>()

  // Step 3: Calculate sorting scores for base features
  const instanceGroupsToSort = baseFeatures.map((baseFeature) => {
    const worldPosition = featurePositionMap.get(baseFeature.uuid)
    if (!worldPosition) {
      return { baseFeature, instances: instances.get(baseFeature.uuid) || [], sortKey: Infinity }
    }

    const featureScale = featureScaleMap.get(baseFeature.uuid) || [1, 1, 1]
    const parcelId = featureParcelMap.get(baseFeature.uuid)

    // Track parcel feature counts
    if (parcelId !== undefined) {
      const count = parcelFeatureCounts.get(parcelId) || 0
      parcelFeatureCounts.set(parcelId, count + 1)
    }

    // Calculate penalty (0.0 - 0.2 based on how many features precede this parcel)
    const parcelPenalty = parcelId === currentParcelId ? 0 : parcelId !== undefined ? (parcelFeatureCounts.get(parcelId) || 0) * 0.01 : 0

    const score = calculateSortScore(worldPosition, cameraPosition, cameraDirection, featureScale, maxDrawDistance, parcelPenalty)

    return {
      baseFeature,
      instances: instances.get(baseFeature.uuid) || [],
      sortKey: -score, // Negative so higher scores come first
    }
  })

  // Step 4: Sort by score
  instanceGroupsToSort.sort((a, b) => a.sortKey - b.sortKey)

  // Step 5: Build load order with base + instances pattern
  for (const { baseFeature, instances } of instanceGroupsToSort) {
    if (instances.length > 0) {
      // Base feature + its instances in a single batch
      loadOrder.push([baseFeature.uuid, ...instances.map((i) => i.uuid)])
    } else {
      // Single non-instanced feature
      loadOrder.push(baseFeature.uuid)
    }
  }

  return loadOrder
}
