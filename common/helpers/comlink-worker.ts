// ABOUTME: Comlink wrapper utility that provides worker functionality with main thread fallback
// ABOUTME: Used for running code in workers when available, or in main thread in sandboxed environments

import * as Comlink from 'comlink'
import { installAbort } from '../../src/monoworker/abort'
import { forceMainThreadWorkers } from './detector'

installAbort()

interface ComlinkWorkerResult<T> {
  worker: T
  cleanup: () => void
  isWorker: boolean
}

type ReadyApi = { ping?: () => boolean | Promise<boolean> }

const READY_MS = 4000

/**
 * Creates a worker with Comlink, falls back to main thread only when forced
 * (embedded iframe, renderer preview). A worker that fails to load rejects.
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

  const worker = workerFactory()
  const api = Comlink.wrap<T & ReadyApi>(worker)

  await waitForWorkerReady(worker, api as ReadyApi)

  return {
    worker: api as T,
    cleanup: () => worker.terminate(),
    isWorker: true,
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

    // ping is exposed once the worker script has booted and called Comlink.expose
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
