import { beforeEach, afterEach, expect, it, vi } from 'vitest'
vi.mock('../common/voxels/helpers', () => ({ getFieldShape: () => [1, 1, 1], getBufferFromVoxels: () => ({ data: new Uint16Array([1]), shape: [1, 1, 1] }) }))
vi.mock('../common/helpers/bloom', () => ({ packIds: (ids: string[]) => ids.join(',') }))
const metadata = { id: 7, hash: 'abc', x1: 0, x2: 10, y1: 0, y2: 10, z1: 0, z2: 10, island: 'Origin', owner: 'owner' }
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetModules()
  fetcher = vi.fn(async (url: any, _options?: any) => ({ ok: true, json: async () => (String(url).includes('cached.json') ? { parcels: [metadata] } : { parcels: [{ id: 7, voxels: 'voxel data', features: [] }] }) }))
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

it('answers spatial queries without starting parcel fetches or owning residency', async () => {
  const worker = await import('../src/monoworker/world')
  expect(await worker.nearbyLots([5, 5, 5], 0)).toHaveLength(1)
  expect(await worker.nearbyLots([30, 5, 5], 0)).toHaveLength(0)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('merges index metadata into fetched content and decodes the voxel field', async () => {
  const worker = await import('../src/monoworker/world')
  const result = await worker.fetchLots([7], new AbortController().signal)
  expect(result[0].record).toMatchObject({ id: 7, island: 'Origin', x1: 0, voxels: 'voxel data' })
  expect(result[0].field?.data).toEqual(new Uint16Array([1]))
})

it('passes cancellation to the actual pack request and skips aborted work', async () => {
  const worker = await import('../src/monoworker/world')
  await worker.loadIndex()
  const controller = new AbortController()
  controller.abort()
  expect(await worker.fetchLots([7], controller.signal)).toEqual([])
  expect(fetcher).toHaveBeenCalledTimes(1)
  const active = new AbortController()
  await worker.fetchLots([7], active.signal)
  expect(fetcher.mock.calls[1][1]).toMatchObject({ signal: active.signal })
})

it('falls back to individual requests when a cached pack misses a parcel', async () => {
  const worker = await import('../src/monoworker/world')
  await worker.loadIndex()
  fetcher.mockImplementation(async (url: any, _options?: any) => ({ ok: true, json: async () => (String(url).endsWith('.pack') ? { parcels: [] } : { success: true, parcel: { id: 7, features: [] } }) }))
  const result = await worker.fetchLots([7], new AbortController().signal)
  expect(result[0].record.island).toBe('Origin')
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('picks up new parcels after a publish without reconnecting the worker', async () => {
  const worker = await import('../src/monoworker/world')
  await worker.loadIndex()
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ parcels: [{ ...metadata, id: 10000 }] }) })
  await worker.loadIndex(true)
  expect((await worker.nearbyLots([5, 5, 5], 0)).map((p) => p.id)).toEqual([10000])
})
