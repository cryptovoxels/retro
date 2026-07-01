// ABOUTME: The monoworker - one worker, many feature modules exposed over minimal Comlink.
// ABOUTME: Add a worker = import its pure module and add one line to the api object below.

import * as Comlink from 'comlink'
import { bakeLightmap } from './monoworker/lightmap'
import { processVoxelisation } from './monoworker/voxel'
import { processJob } from './monoworker/baked'
import { loadVox, cancelJob } from './monoworker/vox'
import { requestInstanceIdentification, requestFeatureSorting } from './monoworker/pump'
import { setFontData, meshText } from './monoworker/polytext'
import { gridWorker } from './monoworker/grid'

const api = {
  bakeLightmap,
  processVoxelisation,
  processJob,
  loadVox,
  cancelJob,
  requestInstanceIdentification,
  requestFeatureSorting,
  setFontData,
  meshText,
  init: gridWorker.init.bind(gridWorker),
  cameraUpdate: gridWorker.cameraUpdate.bind(gridWorker),
  queryParcelsAtPosition: gridWorker.queryParcelsAtPosition.bind(gridWorker),
  handleParcelGenerated: gridWorker.handleParcelGenerated.bind(gridWorker),
  load: gridWorker.load.bind(gridWorker),
  setMessageCallback: gridWorker.setMessageCallback.bind(gridWorker),
}

export type Mono = typeof api
export const mono = api

if (typeof self !== 'undefined' && 'postMessage' in self) Comlink.expose(api)
