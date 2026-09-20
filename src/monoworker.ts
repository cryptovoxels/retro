import * as Comlink from 'comlink'
import { installAbort } from './monoworker/abort'
import { bakeLightmap } from './monoworker/lightmap'
import { loadVox } from './monoworker/vox'
import { requestInstanceIdentification, requestFeatureSorting } from './monoworker/pump'
import { gridWorker } from './monoworker/grid'
import { voxelCollider, wearVoxels } from './monoworker/physics'
import { meshDrafts } from './monoworker/drafts'

installAbort()

const api = {
  // ready probe for createComlinkWorker (importScripts can fail after new Worker)
  ping: () => true as const,
  bakeLightmap,
  loadVox,
  meshDrafts,
  requestInstanceIdentification,
  requestFeatureSorting,
  voxelCollider,
  wearVoxels,
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
