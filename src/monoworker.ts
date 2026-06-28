// ABOUTME: The monoworker - one worker, many feature modules exposed over minimal Comlink.
// ABOUTME: Add a worker = import its pure module and add one line to the api object below.

import * as Comlink from 'comlink'
import { bakeLightmap } from './monoworker/lightmap'

const api = {
  bakeLightmap,
  // next PR: gridStep, voxelMesh, etc. - one line each
}

export type Mono = typeof api
export const mono = api

if (typeof self !== 'undefined' && 'postMessage' in self) Comlink.expose(api)
