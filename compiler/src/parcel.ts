import { compileParcelContent, type CompilePools, type CompileBoardView } from '../../common/helpers/parcel-compile'
import Parcel from '../../server/parcel'
import db from '../../server/pg'
import { diskFetch } from './download'
import { encodeImageDraft, encodeVoxDraft } from './drafts'
import { hoardEnabled, hoardFetch } from './hoard'
import { serverUpload } from './upload'
import { encodeVoxelbr } from './voxelbr'
import { createFarm } from './farm'

const farm = createFarm(1, 4)
const webPools: CompilePools = { download: (fn) => farm.downloaders.run(fn), upload: (fn) => farm.uploaders.run(fn) }

const rehosts = new Map<number, ReturnType<typeof compileOne>>()

export function rehostParcel(id: number) {
  if (!rehosts.has(id)) {
    const job = farm.compilers.run(() => compileOne(id)).finally(() => rehosts.delete(id))
    rehosts.set(id, job)
  }
  return rehosts.get(id)!
}

export async function compileOne(id: number, { pools = webPools, board, reprocess = false }: { pools?: CompilePools; board?: CompileBoardView & { addParcel(id: number): void; removeParcel(id: number): void }; reprocess?: boolean } = {}) {
  const client = await db.connect()
  let locked = false
  try {
    // Shared by the web servers and compiler so repeated clicks never run the same parcel twice.
    locked = (await client.query('select pg_try_advisory_lock(749, $1) as locked', [id])).rows[0].locked
    if (!locked) return { running: true, changed: false, missing: [] as string[] }
    board?.addParcel(id)
    const parcel = await Parcel.load(id)
    if (!parcel?.content) return { changed: false, missing: [] as string[] }
    const before = JSON.stringify(parcel.content)
    const { patch, missing } = await compileParcelContent(
      id,
      (parcel.content.features || []).filter((f: any) => f?.uuid),
      parcel.content.tileset,
      reprocess ? async () => null : (name, bytes, type, encoding) => serverUpload(id, name, bytes, type, encoding),
      { encodeImage: encodeImageDraft, encodeVox: encodeVoxDraft, encodeVoxelbr: reprocess ? undefined : encodeVoxelbr },
      { pools, board, fetch: diskFetch, hoard: !reprocess && hoardEnabled() ? hoardFetch : undefined, reprocess },
    )
    for (const f of parcel.content.features || []) {
      if (f?.uuid && patch.features?.[f.uuid]) Object.assign(f, patch.features[f.uuid])
    }
    if (patch.tileset !== undefined) parcel.content.tileset = patch.tileset
    if (!reprocess) {
      if (missing.length) parcel.content.missing = missing.sort()
      else delete parcel.content.missing
    }
    const after = JSON.stringify(parcel.content)
    const changed = before !== after
    // Do not overwrite edits made while assets were downloading, or save a new version on a no-op.
    const saved = changed
      ? await client.query(
          `update properties set content = $2::text::json, updated_at = now(), compiled_at = now(),
           memoized_hash = encode(digest($2::text, 'sha1'), 'hex')
           where id = $1 and content::jsonb = $3::jsonb and lower(owner) = lower($4)`,
          [id, after, before, parcel.owner],
        )
      : await client.query('update properties set compiled_at = now() where id = $1 and content::jsonb = $2::jsonb and (compiled_at is null or compiled_at < updated_at)', [id, before])
    if (changed && !saved.rowCount) return { changed: false, conflict: true, missing }
    board?.logDone?.(`#${id} ${changed ? 'saved' : 'nothing to do'}  missing ${missing.length}`)
    return { changed, missing }
  } finally {
    try {
      if (locked) {
        board?.removeParcel(id)
        await client.query('select pg_advisory_unlock(749, $1)', [id])
      }
    } finally {
      client.release()
    }
  }
}
