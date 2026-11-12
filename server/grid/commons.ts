import { patchCommons } from '../../common/voxels/commons'
import db from '../pg'
import { revokeGuestPassesForFeature } from '../controllers/guest-passes'
import { livekitService } from '../controllers/livekit'

// One locked row per edit so two island owners can build at the same time.
export async function saveCommons(id: number, patch: any) {
  const client = await db.connect()
  try {
    await client.query('begin')
    const result = await client.query('select content, commons, x1, x2, y1, y2, z1, z2 from properties where id = $1 and is_common for update', [id])
    const row = result.rows[0]
    if (!row) throw new Error('Common parcel missing')
    const layer = patchCommons(row, patch)
    await client.query('update properties set commons = $2, updated_at = now(), memoized_hash = md5(random()::text) where id = $1', [id, JSON.stringify(layer)])
    await client.query('commit')
    for (const feature of row.commons?.features || []) {
      if (feature.type === 'showbox' && patch.features?.[feature.uuid] === null) {
        revokeGuestPassesForFeature(db, livekitService, id, feature.uuid).catch(() => {})
      }
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
