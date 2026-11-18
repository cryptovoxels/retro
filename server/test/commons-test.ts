import test from 'tape'
import { commonsBuild, patchCommons } from '../../common/voxels/commons'
import { getBufferFromVoxels, getVoxelsFromBuffer } from '../../common/voxels/helpers'
import { sendMint } from '../../web/src/helpers/mint-parcel'

test('island owners can change shared additions without altering the base', (t) => {
  const voxels = getVoxelsFromBuffer(Uint16Array.of(7, 0, 0, 0, 0, 0, 0, 0).buffer)
  const content = { features: [{ uuid: 'fire', type: 'vox-model' }], voxels, palette: ['#fff'] }
  const row = { is_common: true, x1: 0, y1: 0, z1: 0, x2: 1, y2: 1, z2: 1, content, commons: null as any }
  const original = JSON.stringify(content)
  t.equal(commonsBuild(row), content)
  row.commons = patchCommons(row, { features: { seat: { type: 'seat' } }, voxels: { positions: [[0, 0, 1]], value: 8 } })
  row.commons = patchCommons(row, { features: { seat: { position: [1, 2, 3] } } })
  const build = commonsBuild(row)
  t.deepEqual(build.features, [...content.features, { uuid: 'seat', type: 'seat', position: [1, 2, 3] }])
  t.deepEqual([...getBufferFromVoxels({ fieldShape: [2, 2, 2], voxels: build.voxels })!.data], [7, 8, 0, 0, 0, 0, 0, 0])
  t.throws(() => patchCommons(row, { features: { fire: null } }))
  t.throws(() => patchCommons(row, { features: { fire: { type: 'image' } } }))
  t.throws(() => patchCommons(row, { voxels: { positions: [[0, 0, 0]], value: 0 } }))
  t.throws(() => patchCommons(row, { voxels: { positions: [[0, -1, 2]], value: 1 } }))
  t.throws(() => patchCommons(row, { palette: [] }))
  row.commons = patchCommons(row, { features: { seat: null }, voxels: { positions: [[0, 0, 1]], value: 0 } })
  t.deepEqual(commonsBuild(row), content)
  t.equal(JSON.stringify(row.content), original)
  t.end()
})

test('the transaction helper rejects commons and unknown mint status', (t) => {
  const contract = { mint: () => t.fail('sent a mint transaction') } as any
  t.throws(() => sendMint(contract, { is_common: true } as any), /non-common/)
  t.throws(() => sendMint(contract, {} as any), /non-common/)
  t.end()
})
