import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extForValid, type Validator } from './validate'

const MAX_BYTES = parseInt(process.env.MAX_BYTES || String(100 * 1024 * 1024), 10)

export function storePath(storeDir: string, hash: string, ext: string): string {
  const e = ext.startsWith('.') ? ext : '.' + ext
  return path.join(storeDir, hash[0], hash[1], hash[2], hash[3], `${hash}${e}`)
}

export function findExistingBlob(storeDir: string, hash: string): string | null {
  const dir = path.join(storeDir, hash[0], hash[1], hash[2], hash[3])
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(hash))
  return files.length ? path.join(dir, files[0]) : null
}

export function readBlobHead(filePath: string, n = 64): Buffer {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(n)
    const read = fs.readSync(fd, buf, 0, n, 0)
    return buf.subarray(0, read)
  } finally {
    fs.closeSync(fd)
  }
}

async function fetchOne(
  url: string,
  storeDir: string,
  isValid: Validator,
): Promise<{ hash: string; path: string; bytes: number; ext: string }> {
  const timeout = AbortSignal.timeout(parseInt(process.env.FETCH_TIMEOUT_MS || '30000', 10))
  const res = await fetch(url, {
    method: 'GET',
    signal: timeout,
    headers: { 'User-Agent': 'VoxelsWorldDump/1.0' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (!res.body) throw new Error('no body')

  const cl = parseInt(res.headers.get('content-length') || '', 10)
  if (cl > MAX_BYTES) throw new Error(`too large (${cl} > ${MAX_BYTES})`)

  const hasher = createHash('sha256')
  const tmpDir = path.join(storeDir, '.tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const tmp = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.part`)

  const nodeStream = Readable.fromWeb(res.body as any)
  let bytes = 0
  let head: Buffer | null = null
  let oversized = false

  nodeStream.on('data', (chunk: Buffer) => {
    hasher.update(chunk)
    bytes += chunk.length
    if (bytes > MAX_BYTES) {
      oversized = true
      nodeStream.destroy(new Error(`too large (> ${MAX_BYTES})`))
      return
    }
    if (!head) head = chunk
    else if (head.length < 64) head = Buffer.concat([head, chunk]).subarray(0, 64)
  })

  try {
    await pipeline(nodeStream, fs.createWriteStream(tmp))
  } catch (err) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    if (oversized || (err as Error)?.message?.includes('too large')) {
      throw new Error(`too large (> ${MAX_BYTES})`)
    }
    throw err
  }

  if (!head || !isValid(head)) {
    fs.unlinkSync(tmp)
    throw new Error('invalid content')
  }

  const ext = extForValid(head)
  const hash = hasher.digest('hex')
  const dest = storePath(storeDir, hash, ext)
  fs.mkdirSync(path.dirname(dest), { recursive: true })

  const existing = findExistingBlob(storeDir, hash)
  if (existing) {
    fs.unlinkSync(tmp)
    return { hash, path: existing, bytes, ext: path.extname(existing) || ext }
  }

  fs.renameSync(tmp, dest)
  return { hash, path: dest, bytes, ext }
}

/** Try primary url then fallbacks. Only writes to CAS if isValid(head) passes. */
export async function download(
  url: string,
  fallbacks: string[],
  isValid: Validator,
  storeDir: string,
): Promise<{ hash: string; path: string; bytes: number; ext: string; tried: { url: string; error: string }[] }> {
  const urls = [url, ...fallbacks].filter(Boolean)
  const tried: { url: string; error: string }[] = []
  const retries = parseInt(process.env.RETRIES || '2', 10) || 2

  for (const u of urls) {
    let lastErr = ''
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await fetchOne(u, storeDir, isValid)
        return { ...result, tried }
      } catch (err: any) {
        lastErr = err?.message || String(err)
        if (lastErr === 'invalid content' || lastErr.startsWith('too large')) break
        if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
      }
    }
    tried.push({ url: u, error: lastErr || 'failed' })
  }

  const err = new Error(tried.map((t) => `${t.url} -> ${t.error}`).join('; ')) as Error & {
    tried: { url: string; error: string }[]
  }
  err.tried = tried
  throw err
}
