// ABOUTME: Comlink wrapper utility that provides worker functionality with main thread fallback
// ABOUTME: Used for running code in workers when available, or in main thread in sandboxed environments

import * as Comlink from 'comlink'
import { forceMainThreadWorkers } from './detector'

interface ComlinkWorkerResult<T> {
  worker: T
  cleanup: () => void
  isWorker: boolean
}

type ReadyApi = { ping?: () => boolean | Promise<boolean> }

const READY_MS = 4000

/**
 * Creates a worker with Comlink, falls back to main thread if workers unavailable
 *
 * NOTE: Use `() => new Worker(new URL('./worker.ts', import.meta.url))` - webpack 5
 * recognizes this pattern and compiles TypeScript workers to separate bundles
 *
 * Worker script failures (importScripts NetworkError, etc) happen AFTER new Worker()
 * succeeds, so we wait for ping / error before treating the worker as live.
 */
export async function createComlinkWorker<T>(workerFactory: () => Worker, fallback: () => T | Promise<T>, options: { debug?: boolean; workerName?: string } = {}): Promise<ComlinkWorkerResult<T>> {
  // Force main thread if URL parameter is set
  if (forceMainThreadWorkers()) {
    if (options.debug) {
      const workerName = options.workerName || 'unknown-worker'
      console.warn(`[ComlinkWorker] MAIN THREAD MODE: Running ${workerName} in main thread via URL parameter`)
    }

    const api = await fallback()

    // Add verification that we're on main thread
    if (options.debug && typeof window !== 'undefined') {
      console.log('[ComlinkWorker] Confirmed main thread execution - window object available:', !!window)
    }

    return {
      worker: api,
      cleanup: () => {
        /* no-op for main thread */
      },
      isWorker: false,
    }
  }

  try {
    const worker = workerFactory()
    const api = Comlink.wrap<T & ReadyApi>(worker)

    await waitForWorkerReady(worker, api as ReadyApi)

    return {
      worker: api as T,
      cleanup: () => worker.terminate(),
      isWorker: true,
    }
  } catch (error) {
    console.warn(`[ComlinkWorker] Falling back to main thread${options.workerName ? ` (${options.workerName})` : ''}:`, error)

    const api = await fallback()

    return {
      worker: api,
      cleanup: () => {
        /* no-op for main thread */
      },
      isWorker: false,
    }
  }
}

function waitForWorkerReady(worker: Worker, api: ReadyApi): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.removeEventListener('error', onError)
      if (err) {
        try {
          worker.terminate()
        } catch {
          // ignore
        }
        reject(err)
      } else {
        resolve()
      }
    }

    const onError = () => finish(new Error('worker script failed to load'))

    const timer = setTimeout(() => finish(new Error('worker ready timeout')), READY_MS)

    worker.addEventListener('error', onError)

    // ping is exposed once webpack finished importScripts + Comlink.expose
    Promise.resolve()
      .then(() => (api.ping ? api.ping() : true))
      .then(() => finish())
      .catch((e) => finish(e instanceof Error ? e : new Error(String(e))))
  })
}

/**
 * Creates a message handler that's properly wrapped for Comlink when needed
 */
export function createMessageHandler<T>(handler: (message: T) => void, isWorker: boolean) {
  return isWorker ? Comlink.proxy(handler) : handler
}
