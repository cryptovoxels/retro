import * as Comlink from 'comlink'
import { bakeLightmap } from './monoworker/lightmap'
import { processVoxelisation } from './monoworker/voxel'
import { processJob } from './monoworker/baked'
import { loadVox, cancelJob } from './monoworker/vox'
import { requestInstanceIdentification, requestFeatureSorting } from './monoworker/pump'
import { setFontData, meshText } from './monoworker/polytext'
import { gridWorker } from './monoworker/grid'
import { voxelCollider, hullPoints } from './monoworker/physics'

const api = {
  // ready probe for createComlinkWorker (importScripts can fail after new Worker)
  ping: () => true as const,
  bakeLightmap,
  processVoxelisation,
  processJob,
  loadVox,
  cancelJob,
  requestInstanceIdentification,
  requestFeatureSorting,
  setFontData,
  meshText,
  voxelCollider,
  hullPoints,
  init: gridWorker.init.bind(gridWorker),
  cameraUpdate: gridWorker.cameraUpdate.bind(gridWorker),
  queryParcelsAtPosition: gridWorker.queryParcelsAtPosition.bind(gridWorker),
  handleParcelGenerated: gridWorker.handleParcelGenerated.bind(gridWorker),
  load: gridWorker.load.bind(gridWorker),
  setMessageCallback: gridWorker.setMessageCallback.bind(gridWorker),
}

export type Mono = typeof api
export const mono = api

// only expose inside a real worker (main-thread fallback imports this module too)
const WGS = (globalThis as any).WorkerGlobalScope
const inWorker = typeof WGS !== 'undefined' && typeof self !== 'undefined' && self instanceof WGS
if (inWorker) Comlink.expose(api)
