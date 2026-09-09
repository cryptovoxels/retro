import { clientUpload, compileParcelContent } from '../common/helpers/parcel-compile'
import { encodeImageDraft, encodeVoxDraft } from './features/feature-draft'
import type Parcel from './parcel'

export async function runCompile(parcel: Parcel) {
  if (!parcel.canEdit || typeof parcel.id !== 'number') return

  const upload = (name: string, bytes: Uint8Array, contentType: string) => clientUpload(parcel.id as number, name, bytes, contentType)

  const patch = await compileParcelContent(
    parcel.id as number,
    parcel.featuresList.map((f) => f.description),
    parcel.tileset,
    upload,
    {
      encodeImage: encodeImageDraft,
      encodeVox: encodeVoxDraft,
    },
  )

  if (patch.features) {
    for (const [uuid, desc] of Object.entries(patch.features)) {
      const f = parcel.featuresList.find((x) => x.uuid === uuid)
      if (f) Object.assign(f.description, desc)
    }
    const features: Record<string, any> = {}
    for (const [uuid, desc] of Object.entries(patch.features)) features[uuid] = desc
    parcel.sendPatch({ features })
  }

  if (patch.tileset !== undefined) {
    parcel.setTileset(patch.tileset || false)
  }
}
