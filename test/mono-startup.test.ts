import { afterEach, expect, it, vi } from 'vitest'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../common/helpers/comlink-worker', () => ({ createComlinkWorker: create }))

afterEach(() => {
  create.mockReset()
  vi.resetModules()
})

it('retries grid startup after a failed download', async () => {
  const { getGridMono } = await import('../src/mono-pool')
  const handle = { worker: {}, cleanup: vi.fn(), isWorker: true }
  create.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(handle)
  await expect(getGridMono()).rejects.toThrow('offline')
  await expect(getGridMono()).resolves.toBe(handle)
  expect(create).toHaveBeenCalledTimes(2)
})

it('cleans up a partial compute pool and allows another startup', async () => {
  const { getComputePool } = await import('../src/mono-pool')
  const first = { worker: {}, cleanup: vi.fn(), isWorker: true }
  const retry = { worker: {}, cleanup: vi.fn(), isWorker: false }
  create.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(retry)
  await expect(getComputePool()).rejects.toThrow('offline')
  expect(first.cleanup).toHaveBeenCalledOnce()
  await expect(getComputePool()).resolves.toEqual([retry])
})
