import { PutObjectCommand } from '@aws-sdk/client-s3'
import { parcelUgcKey, parcelUgcUrl } from '../../common/helpers/ugc-upload-keys'
import { ugcClient, UGC_BUCKET, ugcExists } from '../../server/lib/ugc'

export async function serverUpload(parcelId: number, name: string, bytes: Uint8Array, contentType: string): Promise<string | null> {
  const key = parcelUgcKey(parcelId, name)
  if (await ugcExists(key)) return parcelUgcUrl(parcelId, name)

  await ugcClient().send(
    new PutObjectCommand({
      Bucket: UGC_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ACL: 'public-read',
    }),
  )
  return parcelUgcUrl(parcelId, name)
}
