import * as Comlink from 'comlink'
import { installAbort } from './monoworker/abort'
import { groundMesh } from './monoworker/ground-mesh'
import { islandLayout, islandSurface } from './monoworker/island'
import { bakeLightmap } from './monoworker/lightmap'
import { loadVox } from './monoworker/vox'
import { loadIndex, nearbyLots, fetchLots } from './monoworker/world'
import { voxelCollider } from './monoworker/physics'

installAbort()

const api = {
  // ready probe for createComlinkWorker (importScripts can fail after new Worker)
  ping: () => true as const,
  groundMesh,
  islandLayout,
  islandSurface,
  bakeLightmap,
  loadVox,
  voxelCollider,
  loadIndex,
  nearbyLots,
  fetchLots,
}

export type Mono = typeof api
export const mono = api

// only expose inside a real worker (main-thread fallback imports this module too)
const WGS = (globalThis as any).WorkerGlobalScope
const inWorker = typeof WGS !== 'undefined' && typeof self !== 'undefined' && self instanceof WGS
if (inWorker) Comlink.expose(api)
