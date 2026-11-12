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

async function gifSheet(source, fit) {
  const metadata = await sharp(source, { pages: 1, limitInputPixels: 64 * 1024 * 1024 }).metadata()
  const delays = Array.from({ length: metadata.pages || 1 }, (_, i) => metadata.delay?.[i] || 100)
  const duration = delays.reduce((sum, delay) => sum + delay, 0)
  const tiles = []
  let frame = 0
  let end = delays[0]
  for (let i = 0; i < 16; i++) {
    while (frame < delays.length - 1 && (i * duration) / 16 >= end) end += delays[++frame]
    // Decode only the sampled page. A full animated image can be hundreds of megapixels.
    const input = await sharp(source, { page: frame, pages: 1, limitInputPixels: 64 * 1024 * 1024 })
      .timeout({ seconds: 10 })
      .resize(128, 128, { fit, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    tiles.push({ input, left: (i % 4) * 128, top: Math.floor(i / 4) * 128 })
  }
  const sheet = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles)
    .png()
    .toBuffer()
  return { sheet, frames: JSON.stringify({ frames: 16, duration, columns: 4, rows: 4 }) }
}
exports.gifSheet = gifSheet

async function compress({ key, width = 256, height = 256, fit = 'cover', format = 'astc' }) {
  width = Number(width)
  height = Number(height)
  if (
    typeof key !== 'string' ||
    !/^parcel\/\d+\/[A-Za-z0-9_-]+\.(png|jpe?g|webp|avif|gif)$/i.test(key) ||
    ![128, 256, 512].includes(width) ||
    ![128, 256, 512].includes(height) ||
    !['cover', 'contain', 'fill'].includes(fit) ||
    format !== 'astc'
  ) {
    return { statusCode: 400, headers, body: 'Expected a UGC image key, width/height 128, 256 or 512, fit cover/contain/fill, format astc' }
  }
  const gif = /\.gif$/i.test(key)
  if (gif) width = height = 512
  const destination = `${key}/width=${width},height=${height},fit=${fit},format=${format}${gif ? ',sheet=4x4-v1' : ''}.ktx`
  const object = { Bucket: process.env.TEXTURE_STORAGE_BUCKET, Key: destination }
  const location = `https://texture.voxels.com/${destination.split('/').map(encodeURIComponent).join('/')}`
  // CDN CORS does not expose object metadata, so carry timing through the redirect URL.
  const cached = (metadata) => ({ statusCode: 302, headers: { ...headers, Location: location + (metadata?.frames ? `?frames=${encodeURIComponent(metadata.frames)}` : '') }, body: '' })
  let directory
  try {
    try {
      const existing = await storage.send(new HeadObjectCommand(object), { abortSignal: AbortSignal.timeout(5000) })
      return cached(existing.Metadata)
    } catch (error) {
      if (error.$metadata?.httpStatusCode !== 404) throw error
    }
    const response = await fetch(`https://ugc.voxels.com/${key}`, { redirect: 'error', signal: AbortSignal.timeout(10000) })
    if (!response.ok) return { statusCode: response.status === 404 ? 404 : 503, headers: { ...headers, 'Retry-After': '30' }, body: `UGC returned ${response.status}` }
    if (Number(response.headers.get('content-length')) > 128 * 1024 * 1024) {
      await response.body.cancel()
      return { statusCode: 413, headers, body: 'UGC image exceeds 128 MiB' }
    }
    const chunks = []
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.length
      if (bytes > 128 * 1024 * 1024) return { statusCode: 413, headers, body: 'UGC image exceeds 128 MiB' }
      chunks.push(chunk)
    }
    directory = await mkdtemp(join(tmpdir(), 'ugc-texture-'))
    const input = join(directory, 'input.png')
    const output = join(directory, 'output.ktx')
    let source = Buffer.concat(chunks)
    let metadata
    if (gif) {
      const { sheet, frames } = await gifSheet(source, fit)
      source = sheet
      metadata = { frames, 'original-format': JSON.stringify('gif') }
    }
    await sharp(source, { pages: 1, limitInputPixels: 64 * 1024 * 1024 })
      .timeout({ seconds: 10 })
      .rotate()
      .resize(width, height, { fit, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .flip()
      .png()
      .toFile(input)
    await encode(join(__dirname, 'PVRTexToolCLI'), ['-i', input, '-o', output, '-f', 'ASTC_4x4', '-q', 'astcfast', '-j', '1', '-m', String(Math.log2(Math.max(width, height)) + 1)], { timeout: 10000, killSignal: 'SIGKILL' })
    await storage.send(new PutObjectCommand({ ...object, Body: await readFile(output), Metadata: metadata, ContentType: 'image/ktx', CacheControl: 'public, max-age=31536000, immutable', ACL: 'public-read' }), {
      abortSignal: AbortSignal.timeout(5000),
    })
    return cached(metadata)
  } catch (error) {
    console.error(error.name, error.$metadata?.httpStatusCode || '')
    return { statusCode: 503, headers: { ...headers, 'Retry-After': '30' }, body: 'Texture compression unavailable' }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}

exports.main = async (args) => {
  const start = Date.now()
  let status = 500
  try {
    const response = await compress(args)
    status = response.statusCode
    return response
  } finally {
    console.log(
      JSON.stringify({
        event: 'http_request',
        at: new Date().toISOString(),
        service: 'function',
        route: '/textures/compress',
        id: process.env.__OW_ACTIVATION_ID || require('node:crypto').randomUUID(),
        deploy: process.env.REQUEST_DEPLOY || 'unknown',
        method: args.__ow_method?.toUpperCase() || 'GET',
        status,
        aborted: false,
        ms: Date.now() - start,
        asset: typeof args.key === 'string' && /^parcel\/\d+\/[\w-]+\.(png|jpe?g|webp|avif|gif)$/i.test(args.key) ? args.key : undefined,
      }),
    )
  }
}
