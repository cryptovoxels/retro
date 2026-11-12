import { afterEach, expect, it, vi } from 'vitest'
import { parcelCache } from '../handlers/parcel-cache'
vi.mock('../lib/logger', () => ({ default: { error: vi.fn() } }))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(async () => 'SELECT parcels') }))

afterEach(() => vi.useRealTimers())

function response() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), set: vi.fn(), setHeader: vi.fn() } as any
}

it('coalesces cold requests and serves the last good snapshot after a refresh failure', async () => {
  vi.useFakeTimers()
  const rows = [{ id: 42 }]
  const client = { query: vi.fn(async (sql: string) => ({ rows: sql === 'SELECT parcels' ? rows : [] })), release: vi.fn() }
  const db = { connect: vi.fn(async () => client) } as any
  const handler = parcelCache(db)
  const first = response()
  const second = response()
  await Promise.all([handler({} as any, first), handler({} as any, second)])
  expect(db.connect).toHaveBeenCalledTimes(1)
  expect(first.json).toHaveBeenCalledWith({ success: true, parcels: rows })
  expect(second.json).toHaveBeenCalledWith({ success: true, parcels: rows })
  expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', "SET LOCAL statement_timeout = '5s'", 'SELECT parcels', 'COMMIT'])
  expect(client.release).toHaveBeenCalledOnce()

  await vi.advanceTimersByTimeAsync(60001)
  client.query.mockImplementation(async (sql) => {
    if (sql === 'SELECT parcels') throw Error('database unavailable')
    return { rows: [] }
  })
  const stale = response()
  await handler({} as any, stale)
  await vi.advanceTimersByTimeAsync(0)
  expect(stale.json).toHaveBeenCalledWith({ success: true, parcels: rows })
  expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  expect(client.release).toHaveBeenCalledTimes(2)
  await handler({} as any, response())
  expect(db.connect).toHaveBeenCalledTimes(2)
})

it('returns a retryable 503 on cold failure and recovers on the next refresh', async () => {
  vi.useFakeTimers()
  const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
  const db = { connect: vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(client) } as any
  const handler = parcelCache(db)
  const failed = response()
  await handler({} as any, failed)
  expect(failed.status).toHaveBeenCalledWith(503)
  expect(failed.setHeader).toHaveBeenCalledWith('Retry-After', '5')
  expect(failed.set).toHaveBeenCalledWith('Cache-Control', 'no-cache,no-store,must-revalidate')
  await vi.advanceTimersByTimeAsync(5000)
  const recovered = response()
  await handler({} as any, recovered)
  expect(recovered.json).toHaveBeenCalledWith({ success: true, parcels: [] })
})

it('does not resurrect an old snapshot when a refresh overlaps an island publish', async () => {
  const { islandEvents } = await import('../islands')
  let finish: (result: any) => void = () => {}
  const old = new Promise((resolve) => {
    finish = resolve
  })
  const read = vi
    .fn()
    .mockReturnValueOnce(old)
    .mockResolvedValue({ rows: [{ id: 10000 }] })
  const db = { connect: async () => ({ query: (q: string) => (q === 'SELECT parcels' ? read() : Promise.resolve()), release() {} }) } as any
  const handler = parcelCache(db)
  const before = handler({} as any, response())
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
  islandEvents.emit('published', 57)
  const after = response()
  await handler({} as any, after)
  finish({ rows: [] })
  await before
  await handler({} as any, after)
  expect(after.json.mock.calls).toEqual(Array(2).fill([{ success: true, parcels: [{ id: 10000 }] }]))
  expect(read).toHaveBeenCalledTimes(2)
})
