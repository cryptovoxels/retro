import { gunzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { islandGround } from '../handlers/island-ground'
import { islandEvents } from '../islands'

function response() {
  return { set: vi.fn().mockReturnThis(), vary: vi.fn(), type: vi.fn().mockReturnThis(), send: vi.fn(), sendStatus: vi.fn() }
}

function request(encoding = 'gzip') {
  return { params: { id: '57' }, acceptsEncodings: () => encoding } as any
}

afterEach(() => islandEvents.removeAllListeners())

it('reads terrain once for concurrent requests and serves the original bytes to identity clients', async () => {
  let ground = Buffer.alloc(8000, 255)
  const query = vi.fn(async () => ({ rows: [{ ground }] }))
  const connect = vi.fn(async () => ({ query, release() {} }))
  const serve = islandGround({ connect } as any)
  const gz = response(),
    raw = response()
  await Promise.all([serve(request(), gz as any), serve(request('identity'), raw as any)])
  expect(connect).toHaveBeenCalledTimes(1)
  expect(gz.vary).toHaveBeenCalledWith('Accept-Encoding')
  expect(gz.set).toHaveBeenCalledWith('Content-Encoding', 'gzip')
  expect(gz.set).toHaveBeenCalledWith('Cache-Control', 'public,no-cache')
  expect(gunzipSync(gz.send.mock.calls[0][0])).toEqual(ground)
  expect(raw.send).toHaveBeenCalledWith(ground)

  islandEvents.emit('published', 12)
  await serve(request(), response() as any)
  expect(connect).toHaveBeenCalledTimes(1)
  ground = Buffer.from([0, 1, 128, 255])
  islandEvents.emit('published', 57)
  const updated = response()
  await serve(request(), updated as any)
  expect(connect).toHaveBeenCalledTimes(2)
  expect(gunzipSync(updated.send.mock.calls[0][0])).toEqual(ground)
})

it('retries missing terrain and transient failures', async () => {
  const query = vi.fn(async () => ({ rows: [] as any[] }))
  const connect = vi
    .fn()
    .mockRejectedValueOnce(Error('offline'))
    .mockResolvedValue({ query, release() {} })
  const serve = islandGround({ connect } as any)
  const failed = response(),
    missing = response(),
    ok = response()
  await serve(request(), failed as any)
  expect(failed.sendStatus).toHaveBeenCalledWith(503)
  await serve(request(), missing as any)
  expect(missing.sendStatus).toHaveBeenCalledWith(404)
  query.mockResolvedValue({ rows: [{ ground: Buffer.alloc(16) }] })
  await serve(request(), ok as any)
  expect(ok.send).toHaveBeenCalledOnce()
})
