import { afterEach, expect, it, vi } from 'vitest'
import { remoteCompile } from '../../compiler/src/remote'
import { main } from '../../compiler/function/rehost'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('sends bounded authenticated batches, keeps private feature data local, and combines results', async () => {
  vi.stubEnv('UGC_SECRET', 'test-only-storage-secret')
  const call = vi.fn(async (_url: string, options: RequestInit) => {
    const { features, tileset } = JSON.parse(String(options.body))
    expect(options.headers).toHaveProperty('X-Require-Whisk-Auth', expect.stringMatching(/^[a-f0-9]{64}$/))
    expect(String(options.body)).not.toContain('private script')
    return Response.json({ patch: { features: { [features[0].uuid]: { url: 'ugc://converted' } }, ...(tileset ? { tileset: 'ugc://atlas' } : {}) }, missing: ['a'] })
  })
  vi.stubGlobal('fetch', call)
  const features = Array.from({ length: 10 }, (_, i) => ({ uuid: String(i), url: 'https://example.org/img', script: 'private script' }))
  expect(await remoteCompile(3, features, 'https://example.org/atlas')).toEqual({ patch: { features: { 0: { url: 'ugc://converted' }, 8: { url: 'ugc://converted' } }, tileset: 'ugc://atlas' }, missing: ['a'] })
  expect(call.mock.calls.map(([, init]) => JSON.parse(String(init.body)).features.length)).toEqual([8, 2])
})

it('does not return a saveable result when the function fails', async () => {
  vi.stubEnv('UGC_SECRET', 'test-only-storage-secret')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
  await expect(remoteCompile(3, [], 'atlas')).rejects.toThrow('503')
})

it('runs the function entry point without fetching already converted NFTs', async () => {
  const result = await main({ id: 3, features: [{ uuid: 'nft', type: 'nft-image', url: 'tezos:NetXdQprcVkpaWU/fa2:KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton/1' }] })
  expect(result.body).toEqual({ patch: {}, missing: [] })
})
