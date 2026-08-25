import type { Mono } from './monoworker'
import { getGridMono } from './mono-pool'

export function getMono() {
  return getGridMono()
}

export async function getMonoWorker(): Promise<Mono> {
  return (await getGridMono()).worker
}

export type { Mono }
export type { GridWorkerAPI, GridWorkerOutput, GridWorkerParcelLoaded, GridWorkerParcelUnloaded, GridWorkerQueryResponse } from './monoworker/grid'
