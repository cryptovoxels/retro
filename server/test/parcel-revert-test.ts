import { expect, it, vi } from 'vitest'
import Parcel from '../parcel'
import db from '../pg'

vi.mock('../auth-parcel', () => ({ default: async () => 'Owner' }))
vi.mock('../pg', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }))

it('replaces the build with the selected parcel version', async () => {
  const parcel = new Parcel({ id: 7499, content: { voxels: 'new', tileset: 'new' } })
  vi.mocked(db.query).mockResolvedValue({ rows: [{ content: { voxels: 'old', settings: {} } }] } as any)
  const save = vi.spyOn(parcel, 'save').mockResolvedValue(true)
  const notify = vi.spyOn(parcel, 'broadcastMeta').mockImplementation(() => {})
  expect(await parcel.revert(123)).toEqual({ success: true })
  expect(db.query).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('where id = $1 and parcel_id = $2'), [123, 7499])
  expect(parcel.content).toEqual({ voxels: 'old' })
  expect(save).toHaveBeenCalledOnce()
  expect(notify).toHaveBeenCalledOnce()
})

it('leaves the build alone when the version is missing', async () => {
  const parcel = new Parcel({ id: 7499, content: { voxels: 'current' } })
  vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
  const save = vi.spyOn(parcel, 'save')
  expect(await parcel.revert(123)).toEqual({ success: false })
  expect(parcel.content).toEqual({ voxels: 'current' })
  expect(save).not.toHaveBeenCalled()
})

it('returns the failed restore to the edit page', async () => {
  const { revertParcel } = await import('../handlers/update-parcel')
  const parcel = new Parcel({ id: 7499 })
  const load = vi.spyOn(Parcel, 'load').mockResolvedValue(parcel)
  vi.spyOn(parcel, 'revert').mockResolvedValue({ success: false })
  const json = vi.fn()
  try {
    await revertParcel({ params: { id: '7499' }, body: { parcel_version_id: 123 } } as any, { json } as any)
    expect(json).toHaveBeenCalledWith({ success: false })
  } finally {
    load.mockRestore()
  }
})
