// put one file in the UGC bucket, public, cached forever (keys should carry a version or hash)
//
//   npx tsx scripts/upload-ugc.ts path/to/file.png tilesets/file.png

import 'dotenv/config'
import { readFileSync } from 'fs'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { UGC_BUCKET, ugcClient } from '../server/lib/ugc'
import { UGC_CACHE } from '../common/helpers/ugc-upload-keys'

const [file, key] = process.argv.slice(2)
if (!file || !key) {
  console.error('usage: upload-ugc.ts <file> <key>')
  process.exit(1)
}
const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', vox: 'application/octet-stream' }
ugcClient()
  .send(new PutObjectCommand({ Bucket: UGC_BUCKET, Key: key, Body: readFileSync(file), ContentType: types[key.split('.').pop()!] || 'application/octet-stream', CacheControl: UGC_CACHE, ACL: 'public-read' }))
  .then(() => console.log(`https://ugc.voxels.com/${key}`))
