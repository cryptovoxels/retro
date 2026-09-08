import { FeatureRecord as FR } from '../../common/messages/feature'

export type UUID = string

// Instance relationship: [instanceUuid, baseUuid] - maps a duplicate feature to its original
export type InstanceRelation = [UUID, UUID]

// Map of instance UUIDs to their base UUIDs
export type InstanceRelationMap = Map<UUID, UUID>

// Map of parcel IDs to their instance relations
export type ParcelInstanceRelations = Map<number | string, InstanceRelationMap>

// Load order item: either a single UUID or array of UUIDs (for parallel loading)
export type LoadOrderItem = UUID | UUID[]

export type FeatureRecord = FR & {
  uuid: UUID
}

export type LoadItem = FeatureRecord | FeatureRecord[]

export type SortableFeature = {
  uuid: UUID
  type: string
  worldPosition: [number, number, number]
  scale: [number, number, number]
  groupId?: UUID
  parcelId: number | string
}

export interface IdentifyInstancesRequest {
  type: 'identify-instances'
  requestId: string
  features: FeatureRecord[]
}

export interface SortFeaturesRequest {
  type: 'sort-features'
  requestId: string
  features: SortableFeature[]
  instanceRelations: InstanceRelation[]
  cameraPosition: [number, number, number]
  cameraDirection: [number, number, number]
  maxDrawDistance: number
  currentParcelId?: number | string
}

export type PumpWorkerInput = IdentifyInstancesRequest | SortFeaturesRequest

export interface WorkerTiming {
  total: number
  detection?: number
  sorting?: number
  serialization: number
}

export interface IdentifyInstancesResponse {
  type: 'identify-instances-response'
  requestId: string
  instanceRelations: InstanceRelation[]
  timing: WorkerTiming
}

export interface SortFeaturesResponse {
  type: 'sort-features-response'
  requestId: string
  loadOrder: LoadOrderItem[]
  timing: WorkerTiming
}

export interface WorkerErrorResponse {
  type: 'error'
  requestId: string
  error: string
}

export type PumpWorkerOutput = IdentifyInstancesResponse | SortFeaturesResponse | WorkerErrorResponse

export type WorkerOperationType = 'detection' | 'sorting'
