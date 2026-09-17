import { PutObjectCommand } from '@aws-sdk/client-s3'
import { parcelUgcKey, parcelUgcUrl } from '../../common/helpers/ugc-upload-keys'
import { B, C, kbSize, R, say, truncated, vibe } from '../../common/helpers/parcel-compile'
import { ugcClient, UGC_BUCKET, ugcExists } from '../../server/lib/ugc'

export async function serverUpload(parcelId: number, name: string, bytes: Uint8Array, contentType: string): Promise<string | null> {
  const key = parcelUgcKey(parcelId, name)
  const loc = parcelUgcUrl(parcelId, name)
  say(`  ${C[11]}${B}📤 PUT${R} ${name} ${B}[${kbSize(bytes.byteLength)}]${R} ${vibe(bytes.byteLength)}`)
  if (await ugcExists(key)) {
    say(`  ${C[3]}📤 already there ${truncated(key)} 💅${R}`)
    return loc
  }

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
    say(`  ${C[2]}${B}📤 landed${R} ${loc} ${vibe(parcelId)}`)
    return loc
  } catch (e) {
    say(`  ${C[0]}${B}📤 PUT died${R} ${name} ${e} 😭💔`)
    return null
  }
}
