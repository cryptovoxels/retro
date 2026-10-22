import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import ndarray from 'ndarray'
import cachedFetch from '../web/src/helpers/cached-fetch'

vi.mock('../web/src/helpers/cached-fetch', () => ({ default: vi.fn() }))

vi.mock('../common/helpers/detector', () => ({ isSkynet: () => true, wantsRoboshot: () => false, robotFov: () => 1.2 }))
vi.mock('../common/helpers/upload-media', () => ({ uploadParcelBytes: vi.fn() }))
vi.mock('../common/helpers/parcel-compile', () => ({ tilesetRuntimeUrl: (url: string) => url }))
vi.mock('../common/helpers/ugc-upload-keys', () => ({ contentName: vi.fn() }))

import { installBuilder } from '../src/builder'

let parcel: any
let patches: any[]

beforeEach(() => {
  vi.useFakeTimers()
  patches = []
  let pending: ReturnType<typeof setTimeout>
  parcel = {
    id: 123,
    loaded: true,
    canEdit: true,
    sandbox: false,
    fieldShape: [17, 8, 17],
    field: ndarray(new Uint16Array(17 * 8 * 17), [17, 8, 17]),
    generateVoxelField: vi.fn().mockResolvedValue(undefined),
    set(points: [number, number, number][], value: number) {
      for (const point of points) this.field.set(...point, value)
      clearTimeout(pending)
      pending = setTimeout(() => patches.push({ points, value }), 5)
    },
  }
  window.grid = { isOpen: true, getByID: () => parcel } as any
  installBuilder()
})

afterEach(() => vi.useRealTimers())

it('searches the current host without double-encoding names and returns failures', async () => {
  const result = { success: true, assets: [{ id: 'chair', name: 'red & blue chair' }] }
  vi.mocked(cachedFetch).mockResolvedValueOnce({ json: async () => result } as any)
  expect(await window.builder.search('red & blue chair', 1)).toEqual(result)
  const url = new URL(String(vi.mocked(cachedFetch).mock.calls[0][0]), 'https://local.test')
  expect(url.origin).toBe('https://local.test')
  expect(url.searchParams.get('q')).toBe('red & blue chair')
  expect(url.searchParams.get('page')).toBe('1')
  vi.mocked(cachedFetch).mockRejectedValueOnce(new Error('offline'))
  expect(await window.builder.search('chair')).toEqual({ error: 'offline' })
})

it('sends every chunk without losing debounced patches and waits for the final mesh', async () => {
  const value = window.builder.block(4, 0)
  const result = window.builder.fill(123, [0, 0, 0], [16, 7, 16], value)
  await vi.runAllTimersAsync()
  expect(await result).toEqual({ submitted: 2312, sandbox: false })
  expect(patches.map((p) => p.points.length)).toEqual([2048, 264])
  expect(
    window.builder.read(123, [
      [0, 0, 0],
      [16, 7, 16],
    ]),
  ).toEqual([value, value])
  expect(parcel.generateVoxelField).toHaveBeenCalledOnce()
})

it('rejects invalid bounds and read-only writes before changing any cells', async () => {
  expect(await window.builder.fill(123, [0, 0, 0], [17, 0, 0], 1)).toHaveProperty('error')
  expect(
    await window.builder.set(
      123,
      [
        [0, 0, 0],
        [-1, 0, 0],
      ],
      1,
    ),
  ).toHaveProperty('error')
  parcel.canEdit = false
  expect(await window.builder.set(123, [[0, 0, 0]], 1)).toHaveProperty('error')
  expect(parcel.field.get(0, 0, 0)).toBe(0)
  expect(patches).toHaveLength(0)
})

it('rejects concurrent writes and stops if the connection drops between chunks', async () => {
  const result = window.builder.fill(123, [0, 0, 0], [16, 7, 16], 32771)
  expect(await window.builder.set(123, [[0, 0, 0]], 0)).toHaveProperty('error')
  ;(window.grid as any).isOpen = false
  await vi.runAllTimersAsync()
  expect(await result).toHaveProperty('error')
  expect(patches).toHaveLength(1)
})
