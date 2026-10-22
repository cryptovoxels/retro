// ABOUTME: Quiet UGC put for compiler - board owns the progress UI.

import sharp from 'sharp'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { contentName, parcelUgcKey, parcelUgcUrl, UGC_CACHE } from '../../common/helpers/ugc-upload-keys'
import type { UploadResult } from '../../common/helpers/parcel-compile'
import { ugcClient, UGC_BUCKET, ugcExists } from '../../server/lib/ugc'

export async function serverUpload(parcelId: number, name: string, bytes: Uint8Array, contentType: string, contentEncoding?: string): Promise<UploadResult | null> {
  try {
    if (contentType.startsWith('image/')) {
      const image = sharp(bytes, { animated: true })
      const meta = await image.metadata()
      if ((meta.width || 0) > 1024 || (meta.pageHeight || meta.height || 0) > 1024) {
        const resized = await image.resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).toBuffer({ resolveWithObject: true })
        bytes = resized.data
        contentType = `image/${resized.info.format}`
        name = `${await contentName(bytes)}.${resized.info.format === 'jpeg' ? 'jpg' : resized.info.format}`
      }
    }
    const key = parcelUgcKey(parcelId, name)
    const location = parcelUgcUrl(parcelId, name)
    if (await ugcExists(key)) return { location, existed: true }

    await ugcClient().send(
      new PutObjectCommand({
        Bucket: UGC_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        CacheControl: UGC_CACHE,
        ACL: 'public-read',
        ...(contentEncoding ? { ContentEncoding: contentEncoding } : {}),
      }),
    )
    return { location, existed: false }
  } catch (e) {
    console.error(`[upload] ${name}`, e instanceof Error ? e.message : e)
    return null
  }
}
