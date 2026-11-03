import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ handler: undefined as any, failures: [] as Array<(error: Error) => void>, downloads: 0 }))
vi.mock('../../compressor/src/www', () => ({
  app: {
    get: vi.fn(),
    route: () => ({
      all: (handler: any) => {
        state.handler = handler
      },
    }),
  },
}))
vi.mock('../../compressor/src/config', () => ({ default: { space: { client: () => ({ send: async () => ({}) }), name: 'test' } } }))
vi.mock('../../compressor/src/storage', () => ({
  clear: vi.fn(),
  hashify: (url: string) => url,
  find: async () => {
    throw new Error('cache miss')
  },
  download: () => {
    state.downloads++
    return new Promise((_resolve, reject) => state.failures.push(reject))
  },
  getSourceURL: (id: string) => id,
  s3Move: vi.fn(),
  s3Copy: vi.fn(),
  DownloadError: class extends Error {},
}))
vi.mock('../../compressor/src/mobile', () => ({ mobileImage: vi.fn() }))
vi.mock('../../compressor/src/texture', () => ({
  Texture: class {
    constructor(public id: string) {}
  },
  CreateError: class extends Error {},
}))

function response() {
  const res: any = { set: vi.fn(() => res), sendStatus: vi.fn(), contentType: vi.fn(), status: vi.fn(() => res), header: vi.fn(() => res), end: vi.fn() }
  return res
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

it('deduplicates requests, runs two conversions, bounds the backlog, and releases failed jobs', async () => {
  const interval = vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as any)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const oldTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  try {
    await import('../../compressor/src/index')
    for (let i = 0; i < 34; i++) state.handler({ query: { url: `https://example.com/${i}.png`, hint: '.astc.ktx' }, setTimeout: vi.fn() }, response())
    await settle()
    expect(state.downloads).toBe(2)
    const duplicate = response()
    state.handler({ query: { url: 'https://example.com/0.png', hint: '.astc.ktx' }, setTimeout: vi.fn() }, duplicate)
    expect(duplicate.sendStatus).not.toHaveBeenCalled()
    const overflow = response()
    state.handler({ query: { url: 'https://example.com/overflow.png', hint: '.astc.ktx' }, setTimeout: vi.fn() }, overflow)
    expect(overflow.sendStatus).toHaveBeenCalledWith(503)
    state.failures.shift()!(new Error('source failed'))
    await settle()
    expect(state.downloads).toBe(3)
    expect(duplicate.status).toHaveBeenCalledWith(500)
    while (state.failures.length) {
      state.failures.shift()!(new Error('source failed'))
      await settle()
    }
  } finally {
    interval.mockRestore()
    log.mockRestore()
    error.mockRestore()
    if (oldTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = oldTls
  }
})
