// ABOUTME: Configuration for the texture compressor service.
// ABOUTME: Manages S3/Spaces client and file paths.

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '..', '.env') })
import path from 'path'
import { S3Client } from '@aws-sdk/client-s3'
import * as fs from 'fs'

interface Space {
  region: string
  name: string
  key: string
  secret: string
  cdn_host: string
  client(): S3Client
}

interface Config {
  space: Space
  cacheDir(name?: string): string
  s3Prefix(): string
  setCacheDir(name: string): void
}

let scratchDir = process.env.CACHE_DIR || '/tmp/generated'
if (!fs.existsSync(scratchDir)) {
  fs.mkdirSync(scratchDir, { recursive: true })
}

const s3Client = new S3Client({
  endpoint: process.env.TEXTURE_STORAGE_ENDPOINT,
  region: process.env.TEXTURE_STORAGE_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.TEXTURE_STORAGE_KEY || '',
    secretAccessKey: process.env.TEXTURE_STORAGE_SECRET || '',
  },
  forcePathStyle: true,
})

const values: Config = {
  space: {
    region: process.env.TEXTURE_STORAGE_REGION || '',
    name: process.env.TEXTURE_STORAGE_BUCKET || '',
    key: process.env.TEXTURE_STORAGE_KEY || '',
    secret: process.env.TEXTURE_STORAGE_SECRET || '',
    cdn_host: process.env.TEXTURE_CDN_HOST || 'https://texture.voxels.com',
    client(): S3Client {
      return s3Client
    },
  },
  cacheDir(filename?: string): string {
    return !filename ? scratchDir : path.join(scratchDir, filename)
  },
  setCacheDir(dir: string) {
    scratchDir = dir
  },
  s3Prefix() {
    return 'compressed'
  },
}

export default values
