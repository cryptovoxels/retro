import { describe, expect, it, vi } from 'vitest'

vi.mock('../common/helpers/detector', () => ({
  forceMainThreadWorkers: () => false,
}))

// light stub: Comlink.wrap returns the endpoint object we pass through postMessage protocol.
// For this test we drive Worker error / message ourselves and spy fallback.
vi.mock('comlink', () => ({
  wrap: (worker: Worker) => ({
    ping: () =>
      new Promise((resolve, reject) => {
        const w = worker as any
        if (w.__failPing) {
          // hang until error/timeout; real workers never answer after importScripts fail
          return
        }
        resolve(true)
      }),
  }),
  proxy: (x: any) => x,
}))

describe('createComlinkWorker', () => {
  it('falls back when the worker fires error before ready', async () => {
    const { createComlinkWorker } = await import('../common/helpers/comlink-worker')

    class FakeWorker {
      listeners: Record<string, Function[]> = {}
      __failPing = true
      addEventListener(type: string, fn: Function) {
        ;(this.listeners[type] ||= []).push(fn)
      }
      removeEventListener(type: string, fn: Function) {
        this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn)
      }
      terminate() {}
      // fire error on next tick like a failed importScripts
      constructor() {
        queueMicrotask(() => {
          for (const fn of this.listeners.error || []) fn(new ErrorEvent('error'))
        })
      }
    }

    const fallback = vi.fn(async () => ({ ping: () => true, main: true }))
    const result = await createComlinkWorker(() => new FakeWorker() as any, fallback, { workerName: 'test' })

    expect(fallback).toHaveBeenCalled()
    expect(result.isWorker).toBe(false)
    expect((result.worker as any).main).toBe(true)
  })

  it('keeps the worker when ping succeeds', async () => {
    const { createComlinkWorker } = await import('../common/helpers/comlink-worker')

    class OkWorker {
      listeners: Record<string, Function[]> = {}
      __failPing = false
      addEventListener(type: string, fn: Function) {
        ;(this.listeners[type] ||= []).push(fn)
      }
      removeEventListener(type: string, fn: Function) {
        this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn)
      }
      terminate() {}
    }

    const fallback = vi.fn(async () => ({ main: true }))
    const result = await createComlinkWorker(() => new OkWorker() as any, fallback)

    expect(fallback).not.toHaveBeenCalled()
    expect(result.isWorker).toBe(true)
  })
})
