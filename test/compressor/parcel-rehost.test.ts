import { beforeEach, expect, it, vi } from 'vitest'

const { compile, load, query, release } = vi.hoisted(() => ({ compile: vi.fn(), load: vi.fn(), query: vi.fn(), release: vi.fn() }))
vi.mock('../../common/helpers/parcel-compile', () => ({ compileParcelContent: compile }))
vi.mock('../../server/parcel', () => ({ default: { load } }))
vi.mock('../../server/pg', () => ({ default: { connect: async () => ({ query, release }) } }))
vi.mock('../../compiler/src/download', () => ({ diskFetch: vi.fn() }))
vi.mock('../../compiler/src/drafts', () => ({ encodeImageDraft: vi.fn(), encodeVoxDraft: vi.fn() }))
vi.mock('../../compiler/src/hoard', () => ({ hoardEnabled: () => false, hoardFetch: vi.fn() }))
vi.mock('../../compiler/src/upload', () => ({ serverUpload: vi.fn() }))
vi.mock('../../compiler/src/voxelbr', () => ({ encodeVoxelbr: vi.fn() }))
import { compileOne, rehostParcel } from '../../compiler/src/parcel'

beforeEach(() => {
  vi.clearAllMocks()
  load.mockResolvedValue({ owner: 'owner', content: { features: [{ uuid: 'image', url: 'ugc://parcel/4724/image.png', draft: 'A'.repeat(64) }] } })
  compile.mockResolvedValue({ patch: {}, missing: [] })
  query.mockImplementation(async (sql: string) => (sql.includes('pg_try_advisory_lock') ? { rows: [{ locked: true }] } : { rowCount: 1 }))
})

it('repeated rehost calls never save unchanged content', async () => {
  for (let i = 0; i < 5; i++) expect(await compileOne(4724)).toEqual({ changed: false, missing: [] })
  expect(query.mock.calls.filter(([sql]) => sql.includes('set content'))).toHaveLength(0)
  expect(release).toHaveBeenCalledTimes(5)
})

it('does not start another compiler while the parcel is locked', async () => {
  query.mockResolvedValueOnce({ rows: [{ locked: false }] })
  expect(await compileOne(4724)).toMatchObject({ running: true, changed: false })
  expect(compile).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledOnce()
})

it('does not overwrite a concurrent edit', async () => {
  compile.mockResolvedValue({ patch: { tileset: 'ugc://parcel/4724/atlas.png' }, missing: [] })
  query.mockImplementation(async (sql: string) => (sql.includes('pg_try_advisory_lock') ? { rows: [{ locked: true }] } : { rowCount: 0 }))
  expect(await compileOne(4724)).toMatchObject({ changed: false, conflict: true })
  const save = query.mock.calls.find(([sql]) => sql.includes('set content'))!
  expect(save[0]).toContain('content::jsonb = $3::jsonb')
  expect(JSON.parse(save[1][2]).tileset).toBeUndefined()
})

it('releases the parcel lock after a download failure', async () => {
  compile.mockRejectedValueOnce(new Error('download failed'))
  await expect(compileOne(4724)).rejects.toThrow('download failed')
  expect(query.mock.calls[query.mock.calls.length - 1]?.[0]).toContain('pg_advisory_unlock')
  expect(release).toHaveBeenCalledOnce()
})

it('shares a running web task between repeated clicks', async () => {
  let finish!: (result: any) => void
  compile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const first = rehostParcel(4724)
  const second = rehostParcel(4724)
  expect(first).toBe(second)
  await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce())
  finish({ patch: {}, missing: [] })
  await Promise.all([first, second])
  expect(load).toHaveBeenCalledOnce()
})
