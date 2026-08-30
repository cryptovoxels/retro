import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const UGC_BUCKET = 'voxels-ugc'
export const UGC_REGION = 'syd1'
export const UGC_ENDPOINT = 'https://syd1.digitaloceanspaces.com'

export function ugcConfigured() {
  return !!(process.env.UGC_ACCESS && process.env.UGC_SECRET)
}

export function ugcClient() {
  const accessKeyId = process.env.UGC_ACCESS || ''
  const secretAccessKey = process.env.UGC_SECRET || ''
  if (!accessKeyId || !secretAccessKey) throw new Error('UGC_ACCESS / UGC_SECRET not set')
  return new S3Client({
    region: UGC_REGION,
    endpoint: UGC_ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
    // DO Spaces chokes on the SDK's default crc32: it bakes x-amz-checksum-crc32
    // of an empty body into the presigned URL, so the real PUT fails the digest.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  })
}

export async function ugcExists(key: string) {
  try {
    await ugcClient().send(new HeadObjectCommand({ Bucket: UGC_BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

export async function presignPut(key: string, contentType: string, contentLength: number) {
  const command = new PutObjectCommand({
    Bucket: UGC_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    ACL: 'public-read',
  })
  return getSignedUrl(ugcClient(), command, {
    expiresIn: 600,
    unhoistableHeaders: new Set(['x-amz-acl']),
  })
}
