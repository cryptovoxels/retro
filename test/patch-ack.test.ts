import { expect, it, vi } from 'vitest'

vi.mock('../server/controllers/guest-passes', () => ({ revokeGuestPassesForFeature: vi.fn() }))
vi.mock('../server/controllers/livekit', () => ({ livekitService: {} }))
vi.mock('../server/lib/logger', () => ({ default: { debug: vi.fn(), error: vi.fn() } }))
vi.mock('../server/pg', () => ({ default: {} }))
vi.mock('../server/parcel', () => ({ AbstractParcel: class {} }))

import { PatchSet } from '../server/grid/PatchSet'

function setup(save: () => Promise<boolean>) {
  const sent: any[] = []
  const parcel: any = { content: {}, save, getFeatureByUuid: () => undefined }
  const set = new PatchSet(
    async () => parcel,
    () => {},
    (m) => sent.push(m),
  )
  return { set, sent, parcel }
}

it('acks after the parcel saves', async () => {
  vi.useFakeTimers()
  const { set, sent, parcel } = setup(async () => true)
  set.add(9159, { features: { a: { uuid: 'a', type: 'cube' } } }, 'p1')
  set.add(9159, { tileset: 'x' })
  await vi.advanceTimersByTimeAsync(1100)
  expect(parcel.content.features).toHaveLength(1)
  expect(sent).toEqual([{ type: 'patch-ack', parcelId: 9159, patchId: 'p1' }])
  expect(set.pendingPatchMessages).toHaveLength(0)
  vi.useRealTimers()
})

it('acks with an error when the save throws', async () => {
  vi.useFakeTimers()
  const { set, sent } = setup(async () => {
    throw new Error('db down')
  })
  set.add(9159, { tileset: 'x' }, 'p2')
  await vi.advanceTimersByTimeAsync(1100)
  expect(sent).toEqual([{ type: 'patch-ack', parcelId: 9159, patchId: 'p2', error: 'db down' }])
  expect(set.pendingPatchMessages).toHaveLength(0)
  vi.useRealTimers()
})
