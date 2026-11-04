const sharp = require('sharp')
const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const encode = promisify(execFile)
sharp.concurrency(1)
sharp.cache(false)
const storage = new S3Client({
  endpoint: process.env.TEXTURE_STORAGE_ENDPOINT,
  region: process.env.TEXTURE_STORAGE_REGION,
  credentials: { accessKeyId: process.env.TEXTURE_STORAGE_KEY, secretAccessKey: process.env.TEXTURE_STORAGE_SECRET },
  requestChecksumCalculation: 'WHEN_REQUIRED',
})
const headers = { 'Access-Control-Expose-Headers': 'Retry-After', 'Cache-Control': 'no-store' }

exports.main = async ({ key, width = 256, height = 256, fit = 'cover', format = 'astc' }) => {
  width = Number(width)
  height = Number(height)
  if (
    typeof key !== 'string' ||
    !/^parcel\/\d+\/[A-Za-z0-9_-]+\.(png|jpe?g|webp|avif)$/i.test(key) ||
    ![128, 256, 512].includes(width) ||
    ![128, 256, 512].includes(height) ||
    !['cover', 'contain', 'fill'].includes(fit) ||
    format !== 'astc'
  ) {
    return { statusCode: 400, headers, body: 'Expected a UGC image key, width/height 128, 256 or 512, fit cover/contain/fill, format astc' }
  }
  const destination = `${key}/width=${width},height=${height},fit=${fit},format=${format}.ktx`
  const object = { Bucket: process.env.TEXTURE_STORAGE_BUCKET, Key: destination }
  const location = `https://texture.voxels.com/${destination.split('/').map(encodeURIComponent).join('/')}`
  const cached = { statusCode: 302, headers: { ...headers, Location: location }, body: '' }
  let directory
  try {
    try {
      await storage.send(new HeadObjectCommand(object), { abortSignal: AbortSignal.timeout(5000) })
      return cached
    } catch (error) {
      if (error.$metadata?.httpStatusCode !== 404) throw error
    }
    const response = await fetch(`https://ugc.voxels.com/${key}`, { redirect: 'error', signal: AbortSignal.timeout(10000) })
    if (!response.ok) return { statusCode: response.status === 404 ? 404 : 503, headers: { ...headers, 'Retry-After': '30' }, body: `UGC returned ${response.status}` }
    const chunks = []
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.length
      if (bytes > 16 * 1024 * 1024) return { statusCode: 413, headers, body: 'UGC image exceeds 16 MiB' }
      chunks.push(chunk)
    }
    directory = await mkdtemp(join(tmpdir(), 'ugc-texture-'))
    const input = join(directory, 'input.png')
    const output = join(directory, 'output.ktx')
    await sharp(Buffer.concat(chunks), { pages: 1, limitInputPixels: 16 * 1024 * 1024 })
      .timeout({ seconds: 10 })
      .rotate()
      .resize(width, height, { fit, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .flip()
      .png()
      .toFile(input)
    await encode(join(__dirname, 'PVRTexToolCLI'), ['-i', input, '-o', output, '-f', 'ASTC_4x4', '-q', 'astcfast', '-j', '1', '-m', String(Math.log2(Math.max(width, height)) + 1)], { timeout: 10000, killSignal: 'SIGKILL' })
    await storage.send(new PutObjectCommand({ ...object, Body: await readFile(output), ContentType: 'image/ktx', CacheControl: 'public, max-age=31536000, immutable', ACL: 'public-read' }), { abortSignal: AbortSignal.timeout(5000) })
    return cached
  } catch (error) {
    console.error(error.name, error.$metadata?.httpStatusCode || '')
    return { statusCode: 503, headers: { ...headers, 'Retry-After': '30' }, body: 'Texture compression unavailable' }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}
