// ABOUTME: Stream HTTP/S3 bodies to a temp file; only load into ram if under MAX_BYTES.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { MAX_BYTES, type CompileFetched } from '../../common/helpers/parcel-compile'

const FETCH_TIMEOUT_MS = 30000
const TOO_BIG: CompileFetched = { error: 'too big (>20mb)' }

type Body = Readable | ReadableStream | AsyncIterable<Uint8Array>

function asReadable(body: Body): Readable {
  if (body instanceof Readable) return body
  return Readable.fromWeb(body as any)
}

async function withTempFile<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'compile-'))
  const tmp = path.join(dir, 'body')
  try {
    return await fn(tmp)
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Stream a body to disk. Returns bytes only when the whole file is <= MAX_BYTES. */
export async function readBounded(body: Body, onProgress?: (got: number, total: number) => void, total = 0): Promise<CompileFetched> {
  return withTempFile(async (tmp) => {
    const src = asReadable(body)
    let got = 0
    let oversized = false

    src.on('data', (chunk: Buffer | Uint8Array) => {
      got += chunk.byteLength
      if (got > MAX_BYTES) {
        oversized = true
        src.destroy(new Error('too big'))
        return
      }
      onProgress?.(got, total)
    })

    try {
      await pipeline(src, fs.createWriteStream(tmp))
    } catch (e) {
      if (oversized || (e instanceof Error && e.message.includes('too big'))) return TOO_BIG
      const msg = e instanceof Error ? e.message : 'stream boom'
      return { error: msg }
    }

    if (got > MAX_BYTES) return TOO_BIG
    const buf = await fs.promises.readFile(tmp)
    return { bytes: new Uint8Array(buf), contentType: '', status: 200 }
  })
}

export async function diskFetch(url: string, onProgress?: (got: number, total: number) => void): Promise<CompileFetched> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${MAX_BYTES - 1}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      await res.body?.cancel()
      return { error: String(res.status), status: res.status }
    }
    const rangeSize = parseInt(res.headers.get('content-range')?.split('/').pop() || '', 10)
    if ((res.status === 206 && !rangeSize) || rangeSize > MAX_BYTES) {
      await res.body?.cancel()
      return TOO_BIG
    }
    const total = parseInt(res.headers.get('content-length') || '0', 10) || 0
    if (total > MAX_BYTES) {
      await res.body?.cancel()
      return TOO_BIG
    }
    const contentType = res.headers.get('content-type') || ''
    if (!res.body) {
      const buf = await res.arrayBuffer()
      if (buf.byteLength > MAX_BYTES) return TOO_BIG
      onProgress?.(buf.byteLength, buf.byteLength || total)
      return { bytes: new Uint8Array(buf), contentType, status: res.status }
    }
    const loaded = await readBounded(res.body, onProgress, total)
    if ('error' in loaded) return loaded
    return { bytes: loaded.bytes, contentType, status: res.status }
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'TimeoutError' ? 'timeout' : e.message) : 'fetch boom'
    return { error: msg.replace(/^TypeError: /, '') }
  }
}
