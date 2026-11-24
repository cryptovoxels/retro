import { afterEach, expect, test, vi } from 'vitest'
import { createEngine } from '../common/helpers/utils'

afterEach(() => vi.restoreAllMocks())

test('engine waits for WebGPU initialization', async () => {
  let ready!: () => void
  const initAsync = vi.fn(() => new Promise<void>((resolve) => (ready = resolve)))
  const engine = { initAsync }
  vi.spyOn(BABYLON, 'WebGPUEngine').mockImplementation(function () {
    return engine as any
  })
  const pending = createEngine({})
  expect(initAsync).toHaveBeenCalledOnce()
  ready()
  expect(await pending).toBe(engine)
})

test('WebGPU failure never creates a fallback engine', async () => {
  vi.spyOn(BABYLON, 'WebGPUEngine').mockImplementation(function () {
    return { initAsync: () => Promise.reject(new Error('WebGPU unavailable')) } as any
  })
  const fallback = vi.spyOn(BABYLON, 'Engine')
  await expect(createEngine({})).rejects.toThrow('WebGPU unavailable')
  expect(fallback).not.toHaveBeenCalled()
})
