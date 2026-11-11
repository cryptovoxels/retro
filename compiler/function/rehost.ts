import { compileParcelContent } from '../../common/helpers/parcel-compile'
import { diskFetch } from '../src/download'
import { encodeImageDraft, encodeVoxDraft } from '../src/drafts'
import { createFarm } from '../src/farm'
import { hoardEnabled, hoardFetch } from '../src/hoard'
import { serverUpload } from '../src/upload'
import { encodeVoxelbr } from '../src/voxelbr'

export async function main({ id, features, tileset, reprocess = false }: any) {
  if (!Number.isInteger(id) || id <= 0 || !Array.isArray(features) || features.length > 8) return { statusCode: 400, body: 'Invalid parcel or batch' }
  const farm = createFarm(1, 4)
  const body = await compileParcelContent(
    id,
    features,
    tileset,
    reprocess ? async () => null : (name, bytes, type, encoding) => serverUpload(id, name, bytes, type, encoding),
    { encodeImage: encodeImageDraft, encodeVox: encodeVoxDraft, encodeVoxelbr: reprocess ? undefined : encodeVoxelbr },
    { pools: { download: (fn) => farm.downloaders.run(fn), upload: (fn) => farm.uploaders.run(fn) }, fetch: diskFetch, hoard: !reprocess && hoardEnabled() ? hoardFetch : undefined, reprocess },
  )
  return { body }
}
