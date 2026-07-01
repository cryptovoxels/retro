import { createComlinkWorker } from '../common/helpers/comlink-worker'
import type { Mono } from './monoworker'

const COMPUTE_COUNT = 4

type MonoHandle = {
  worker: Mono
  cleanup: () => void
  isWorker: boolean
}

let grid: Promise<MonoHandle> | null = null
let pool: Promise<MonoHandle[]> | null = null

function spawn(): Promise<MonoHandle> {
  return createComlinkWorker<Mono>(
    () => new Worker(new URL('./monoworker.ts', import.meta.url)),
    () => import('./monoworker').then((m) => m.mono),
    { workerName: 'monoworker' },
  )
}

export function getGridMono() {
  return (grid ??= spawn())
}

export function getComputePool() {
  return (pool ??= Promise.all(Array.from({ length: COMPUTE_COUNT }, () => spawn())))
}

const busy = new Map<Mono, number>()

function pick(workers: Mono[]): Mono {
  let best = workers[0]
  let min = busy.get(best) || 0
  for (const w of workers) {
    const n = busy.get(w) || 0
    if (n < min) {
      min = n
      best = w
    }
  }
  busy.set(best, min + 1)
  return best
}

function done(w: Mono) {
  busy.set(w, Math.max(0, (busy.get(w) || 1) - 1))
}

export async function runCompute<T>(fn: (w: Mono) => T | Promise<T>): Promise<T> {
  const workers = (await getComputePool()).map((h) => h.worker)
  const w = pick(workers)
  try {
    return await fn(w)
  } finally {
    done(w)
  }
}

export async function runGrid<T>(fn: (w: Mono) => Promise<T>): Promise<T> {
  const w = (await getGridMono()).worker
  return fn(w)
}

export function terminateAll() {
  grid?.then((h) => h.cleanup())
  pool?.then((hs) => hs.forEach((h) => h.cleanup()))
  grid = null
  pool = null
  busy.clear()
}
