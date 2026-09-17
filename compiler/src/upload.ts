// ABOUTME: Quiet UGC put for compiler - board owns the progress UI.

import { PutObjectCommand } from '@aws-sdk/client-s3'
import { parcelUgcKey, parcelUgcUrl } from '../../common/helpers/ugc-upload-keys'
import type { UploadResult } from '../../common/helpers/parcel-compile'
import { ugcClient, UGC_BUCKET, ugcExists } from '../../server/lib/ugc'

export async function serverUpload(parcelId: number, name: string, bytes: Uint8Array, contentType: string): Promise<UploadResult | null> {
  const key = parcelUgcKey(parcelId, name)
  const location = parcelUgcUrl(parcelId, name)
  if (await ugcExists(key)) return { location, existed: true }

  try {
    await ugcClient().send(
      new PutObjectCommand({
        Bucket: UGC_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ACL: 'public-read',
      }),
    )
    return { location, existed: false }
  } catch {
    return null
  }
}
