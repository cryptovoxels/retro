import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('recovers after repeated HTTP errors, network errors and invalid JSON without reloading', async () => {
  const data = { success: true, parcels: [{ id: 42 }] }
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 400 })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('truncated JSON')
      },
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
    .mockResolvedValue({ ok: true, json: async () => data })
  vi.stubGlobal('fetch', fetcher)
  const { parcelIndex } = await import('../common/utils')
  const pending = parcelIndex()
  expect(parcelIndex()).toBe(pending)
  await vi.advanceTimersByTimeAsync(10000)
  await expect(pending).resolves.toEqual(data)
  expect(fetcher).toHaveBeenCalledTimes(5)
  expect(fetcher.mock.calls[1][1].cache).toBe('reload')
  expect(fetcher.mock.calls[0][1].signal).toBeDefined()
  await parcelIndex()
  expect(fetcher).toHaveBeenCalledTimes(5)
  await parcelIndex(true)
  expect(fetcher).toHaveBeenCalledTimes(6)
})

it('shares an in-flight island list, then fetches the current world on the next visit', async () => {
  const json = vi
    .fn()
    .mockResolvedValueOnce({ islands: [] })
    .mockResolvedValue({ islands: [{ id: 57 }] })
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json })
  vi.stubGlobal('fetch', fetcher)
  const { fetchIslands } = await import('../common/utils')
  const first = fetchIslands()
  expect(fetchIslands()).toBe(first)
  expect(await first).toEqual({ islands: [] })
  expect(await fetchIslands()).toEqual({ islands: [{ id: 57 }] })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher).toHaveBeenCalledWith('/api/world/islands.json', { cache: 'no-store' })
})
