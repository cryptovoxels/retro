// ABOUTME: UGC Spaces upload/head for rendered thumbs. Same bucket as radio UGC.

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { thumbKey, wearableThumbUrl } from '../../common/renderable/thumb-url'

const BUCKET = 'voxels-ugc'
const REGION = 'syd1'
const ENDPOINT = 'https://syd1.digitaloceanspaces.com'

function client() {
  const accessKeyId = process.env.UGC_ACCESS || ''
  const secretAccessKey = process.env.UGC_SECRET || ''
  if (!accessKeyId || !secretAccessKey) throw new Error('UGC_ACCESS / UGC_SECRET not set')
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  })
}

export function ugcConfigured() {
  return !!(process.env.UGC_ACCESS && process.env.UGC_SECRET)
}

export function wearableCdnUrl(uuid: string) {
  return wearableThumbUrl(uuid)
}

export async function hasWearableThumb(uuid: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: thumbKey('wearable', uuid) }))
    return true
  } catch {
    return false
  }
}

export async function uploadWearableThumb(uuid: string, body: Buffer): Promise<string> {
  const key = thumbKey('wearable', uuid)
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
      ACL: 'public-read',
    }),
  )
  return wearableThumbUrl(uuid)
}
