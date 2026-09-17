// ABOUTME: Rehost parcel feature URLs to UGC, sniff bytes, encode drafts. Parallel via optional farm.

import { contentName, isParcelUgc } from './ugc-upload-keys'
import { FeatureRecord } from '../messages/feature'
import { dropboxDirect, sniffBytes, type SniffKind, type SniffResult } from './magic'

export type CompilePatch = {
  features?: Record<string, FeatureRecord>
  tileset?: string | false
}

export type UploadResult = { location: string; existed?: boolean }
export type CompileUpload = (name: string, bytes: Uint8Array, contentType: string, contentEncoding?: string) => Promise<UploadResult | null>

export type CompilePools = {
  download<T>(fn: (slot: number) => Promise<T>): Promise<T>
  upload<T>(fn: (slot: number) => Promise<T>): Promise<T>
}

export type CompileBoardView = {
  set(slot: number, row: { parcelId: number; url: string; phase: 'GET' | 'PUT' | 'HAVE' | 'FAIL' | 'DIG'; got: number; total: number; detail?: string }): void
  idle(slot: number): void
  bump(partial: { done?: number; total?: number; bytes?: number; drafts?: number; fail?: number; uploads?: number; dug?: number }): void
  logDone?(line: string): void
}

export type CompileResult = {
  patch: CompilePatch
  missing: string[]
}

const LOUD = typeof process !== 'undefined' && !!(process as any).versions?.node
const R = '\x1b[0m'
const B = '\x1b[1m'
const C = ['\x1b[31m', '\x1b[32m', '\x1b[33m', '\x1b[34m', '\x1b[35m', '\x1b[36m', '\x1b[91m', '\x1b[92m', '\x1b[93m', '\x1b[94m', '\x1b[95m', '\x1b[96m']
const HEARTS = ['❤️', '🧡', '💛', '💚', '💙', '💜', '💖', '💗', '💕', '💞']
const FACES = ['😘', '😍', '🤩', '🥳', '😎', '🤠', '😻', '🫶', '✨', '🔥']

function say(msg: string) {
  if (!LOUD) return
  process.stdout.write(msg + '\n')
}

function truncated(url: string, n = 72) {
  if (url.length <= n) return url
  return url.slice(0, n - 3) + '...'
}

function kbSize(n: number) {
  if (n < 1024) return n + 'b'
  if (n < 1024 * 1024) return Math.round(n / 1024) + 'kb'
  return (n / (1024 * 1024)).toFixed(1) + 'mb'
}

function paint(i: number) {
  return C[Math.abs(i) % C.length]
}

function vibe(i: number) {
  return FACES[Math.abs(i) % FACES.length] + ' ' + HEARTS[Math.abs(i + 3) % HEARTS.length]
}

export { say, truncated, kbSize, vibe, paint, B, R, C }

type CompileStat = {
  drafts: number
  patched: number
  fetches: number
  fetchFail: number
  bytes: number
  uploads: number
  skipped: number
  dug: number
}

function emptyStat(): CompileStat {
  return { drafts: 0, patched: 0, fetches: 0, fetchFail: 0, bytes: 0, uploads: 0, skipped: 0, dug: 0 }
}

// dig a dead url out of an old cache bucket; server only
export type CompileHoard = (url: string, kind: SniffKind) => Promise<{ bytes: Uint8Array; contentType: string; key: string } | null>

function resolveUgc(url?: string) {
  if (!url) return url
  return url.startsWith('ugc://') ? 'https://ugc.voxels.com/' + url.slice(6) : url
}

function tidyURL(urlCandidate: any): string | undefined {
  if (!urlCandidate) return undefined
  const trim = (v: any) => (typeof v === 'string' ? v.trim() : v)
  if (typeof urlCandidate == 'string') return trim(urlCandidate)
  if (Array.isArray(urlCandidate) && urlCandidate.length > 0) return tidyURL(urlCandidate[0])
  if (urlCandidate.url) return trim(urlCandidate.url)
  return undefined
}

function shouldSkip(url: string | undefined): boolean {
  if (!url) return true
  const u = url.toLowerCase()
  if (u.startsWith('ugc://')) return true
  if (u.match(/youtube\.com|youtu\.be/)) return true
  if (u.match(/twitch\.tv\//)) return true
  if (u.match(/cryptovoxels\.com\/play|voxels\.com\/play/)) return true
  if (u.match(/opensea\.io\/(assets|item)\//) && !u.match(/storage\.opensea/)) return true
  // hls playlists are streams, not files
  if (u.match(/\.m3u8(\?|$)/)) return true
  return false
}

function absoluteUrl(raw: string): string | null {
  let url = tidyURL(raw)
  if (!url) return null
  if (url.startsWith('//')) url = 'https:' + url
  // relative /uploads/* (tilesets etc) live on the image host, same as tilesetRuntimeUrl
  if (url.startsWith('/uploads/')) url = (process.env.IMG_HOST || 'https://img.cryptovoxels.com').replace(/\/$/, '') + url
  else if (url.startsWith('/')) url = (process.env.ASSET_PATH || 'https://www.voxels.com').replace(/\/$/, '') + url
  if (url.includes('dropbox.com')) url = dropboxDirect(url)
  try {
    return new URL(url).toString()
  } catch {
    return null
  }
}

function kindFor(featureType: string | undefined, field: string): SniffKind {
  if (field === 'previewUrl') return 'image'
  if (field === 'assetUrl') return 'video'
  if (featureType === 'audio') return 'audio'
  if (featureType === 'video') return 'video'
  if (featureType === 'vox-model' || featureType === 'megavox' || featureType === 'ride' || featureType === 'vox') return 'vox'
  return 'image'
}

const URL_FIELDS = ['url', 'previewUrl', 'assetUrl'] as const

type Fetched = { bytes: Uint8Array; contentType: string; status: number } | { error: string; status?: number }

export type CompileDraft = {
  encodeImage?: (url: string, bytes?: Uint8Array) => Promise<string | null>
  encodeVox?: (buf: ArrayBuffer) => Promise<string | null>
  encodeVoxelbr?: (buf: ArrayBuffer) => Promise<{ raw: Uint8Array; br: Uint8Array } | null>
}

type JobCtx = {
  parcelId: number
  upload: CompileUpload
  pools?: CompilePools
  board?: CompileBoardView
  hoard?: CompileHoard
  draft?: CompileDraft
  missing: string[]
  stat: CompileStat
  // same URL on ten features at once = one GET (in-flight only, see memoFetch)
  fetchMemo: Map<string, Promise<Fetched>>
  // and one sniff, one dig, one PUT
  rehostMemo: Map<string, Promise<RehostResult>>
}

const FETCH_TIMEOUT_MS = 30000
// everything is buffered in ram and 32 parcels run at once; a 200mb video per feature oom-killed an 8gb box
const MAX_BYTES = 100 * 1024 * 1024
const TOO_BIG = { error: 'too big (>100mb)' }

async function streamFetch(url: string, onProgress?: (got: number, total: number) => void): Promise<Fetched> {
  try {
    const res = await fetch(resolveUgc(url) || url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return { error: String(res.status), status: res.status }
    const total = parseInt(res.headers.get('content-length') || '0', 10) || 0
    if (total > MAX_BYTES) return TOO_BIG
    const contentType = res.headers.get('content-type') || ''
    if (!res.body || !onProgress) {
      const buf = await res.arrayBuffer()
      if (buf.byteLength > MAX_BYTES) return TOO_BIG
      onProgress?.(buf.byteLength, buf.byteLength || total)
      return { bytes: new Uint8Array(buf), contentType, status: res.status }
    }
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        got += value.byteLength
        if (got > MAX_BYTES) {
          void reader.cancel()
          return TOO_BIG
        }
        onProgress(got, total)
      }
    }
    const bytes = new Uint8Array(got)
    let off = 0
    for (const c of chunks) {
      bytes.set(c, off)
      off += c.byteLength
    }
    return { bytes, contentType, status: res.status }
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'TimeoutError' ? 'timeout' : e.message) : 'fetch boom'
    return { error: msg.replace(/^TypeError: /, '') }
  }
}

function memoFetch(ctx: JobCtx, url: string, onProgress?: (got: number, total: number) => void): Promise<Fetched> {
  const hit = ctx.fetchMemo.get(url)
  if (hit) return hit
  const p = streamFetch(url, onProgress)
  ctx.fetchMemo.set(url, p)
  // dedupe in-flight only; a settled entry would pin the body in ram for the rest of the parcel
  void p.finally(() => ctx.fetchMemo.delete(url))
  return p
}

async function withDownload<T>(ctx: JobCtx, fn: (slot: number) => Promise<T>): Promise<T> {
  if (ctx.pools) return ctx.pools.download(fn)
  return fn(0)
}

async function withUpload<T>(ctx: JobCtx, fn: (slot: number) => Promise<T>): Promise<T> {
  if (ctx.pools) return ctx.pools.upload(fn)
  return fn(0)
}

function markMissing(ctx: JobCtx, rawUrl: string, reason: string) {
  if (!ctx.missing.includes(rawUrl)) ctx.missing.push(rawUrl)
  ctx.stat.fetchFail++
  ctx.board?.bump({ fail: 1 })
  if (ctx.board?.logDone) ctx.board.logDone(`#${ctx.parcelId} FAIL ${truncated(rawUrl)} ${reason}`)
  else say(`  ${C[0]}FAIL ${truncated(rawUrl)} ${reason}${R}`)
}

// no bytes past this point: holding bodies until the parcel finished oom-killed an 8gb box three times
type RehostOk = { location: string; ext: string; base: string; draft?: string; voxelbr?: string }
type RehostResult = RehostOk | null

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

function setDraft(ctx: JobCtx, desc: any, d: string) {
  desc.draft = d
  ctx.stat.drafts++
  ctx.board?.bump({ drafts: 1 })
}

function wantsDraft(type: string | undefined) {
  return type === 'image' || type === 'nft-image' || type === 'vox-model' || type === 'megavox' || type === 'ride'
}

function isVoxType(type: string | undefined) {
  return type === 'vox-model' || type === 'megavox' || type === 'ride'
}

async function putVoxelbr(ctx: JobCtx, bytes: Uint8Array): Promise<string | undefined> {
  if (!ctx.draft?.encodeVoxelbr) return undefined
  const packed = await ctx.draft.encodeVoxelbr(toArrayBuffer(bytes))
  if (!packed) return undefined
  const base = await contentName(packed.raw)
  const name = `${base}.voxelbr`
  const uploaded = await withUpload(ctx, async (slot) => {
    ctx.board?.set(slot, { parcelId: ctx.parcelId, url: name, phase: 'PUT', got: 0, total: packed.br.byteLength })
    const loc = await ctx.upload(name, packed.br, 'application/octet-stream', 'br')
    if (!loc) {
      ctx.board?.set(slot, { parcelId: ctx.parcelId, url: name, phase: 'FAIL', got: 0, total: 0, detail: 'upload' })
      await new Promise((res) => setTimeout(res, 80))
      ctx.board?.idle(slot)
      return null
    }
    ctx.board?.set(slot, {
      parcelId: ctx.parcelId,
      url: name,
      phase: loc.existed ? 'HAVE' : 'PUT',
      got: packed.br.byteLength,
      total: packed.br.byteLength,
    })
    await new Promise((res) => setTimeout(res, 40))
    ctx.board?.idle(slot)
    return loc
  })
  if (!uploaded) return undefined
  ctx.stat.uploads++
  ctx.board?.bump({ uploads: 1 })
  return uploaded.location
}

function rehostOne(ctx: JobCtx, rawUrl: string, kind: SniffKind): Promise<RehostResult> {
  const key = `${kind} ${rawUrl}`
  let p = ctx.rehostMemo.get(key)
  if (!p) {
    p = rehostUncached(ctx, rawUrl, kind)
    ctx.rehostMemo.set(key, p)
  }
  return p
}

async function rehostUncached(ctx: JobCtx, rawUrl: string, kind: SniffKind): Promise<RehostResult> {
  if (isParcelUgc(rawUrl, ctx.parcelId) || shouldSkip(rawUrl)) {
    ctx.stat.skipped++
    return null
  }
  const sourceUrl = absoluteUrl(rawUrl)
  if (!sourceUrl) {
    markMissing(ctx, rawUrl, 'bad url')
    return null
  }

  const fetched = await withDownload(ctx, async (slot) => {
    ctx.board?.set(slot, { parcelId: ctx.parcelId, url: sourceUrl, phase: 'GET', got: 0, total: 0 })
    const r = await memoFetch(ctx, sourceUrl, (got, total) => {
      ctx.board?.set(slot, { parcelId: ctx.parcelId, url: sourceUrl, phase: 'GET', got, total })
    })
    ctx.board?.idle(slot)
    return r
  })

  let bytes: Uint8Array = 'error' in fetched ? new Uint8Array() : fetched.bytes
  let sniff: SniffResult = 'error' in fetched ? { ok: false, reason: fetched.error } : sniffBytes(bytes, fetched.contentType, kind)

  // origin dead or lying: dig in the old herring caches, keyed by the url spelling the client used back then
  if (sniff.ok === false && ctx.hoard) {
    const reason = sniff.reason
    const dug = await withDownload(ctx, async (slot) => {
      ctx.board?.set(slot, { parcelId: ctx.parcelId, url: sourceUrl, phase: 'DIG', got: 0, total: 0, detail: reason })
      for (const u of new Set([rawUrl, sourceUrl])) {
        const h = await ctx.hoard!(u, kind)
        if (!h) continue
        const s = sniffBytes(h.bytes, h.contentType, kind)
        if (!s.ok) continue
        ctx.board?.set(slot, { parcelId: ctx.parcelId, url: h.key, phase: 'DIG', got: h.bytes.byteLength, total: h.bytes.byteLength })
        ctx.board?.idle(slot)
        return { bytes: h.bytes, sniff: s }
      }
      ctx.board?.idle(slot)
      return null
    })
    if (dug) {
      bytes = dug.bytes
      sniff = dug.sniff
      ctx.stat.dug++
      ctx.board?.bump({ dug: 1 })
    }
  }

  if (sniff.ok === false) {
    markMissing(ctx, rawUrl, sniff.reason)
    return null
  }
  const ok = sniff

  ctx.stat.fetches++
  ctx.stat.bytes += bytes.byteLength
  ctx.board?.bump({ done: 1, bytes: bytes.byteLength })

  const base = await contentName(bytes)
  const name = `${base}.${ok.ext}`
  const uploaded = await withUpload(ctx, async (slot) => {
    ctx.board?.set(slot, { parcelId: ctx.parcelId, url: name, phase: 'PUT', got: 0, total: bytes.byteLength })
    const loc = await ctx.upload(name, bytes, ok.contentType)
    if (!loc) {
      ctx.board?.set(slot, { parcelId: ctx.parcelId, url: name, phase: 'FAIL', got: 0, total: 0, detail: 'upload' })
      await new Promise((res) => setTimeout(res, 80))
      ctx.board?.idle(slot)
      return null
    }
    ctx.board?.set(slot, {
      parcelId: ctx.parcelId,
      url: name,
      phase: loc.existed ? 'HAVE' : 'PUT',
      got: bytes.byteLength,
      total: bytes.byteLength,
    })
    await new Promise((res) => setTimeout(res, 40))
    ctx.board?.idle(slot)
    return loc
  })

  if (!uploaded) {
    markMissing(ctx, rawUrl, 'upload failed')
    return null
  }

  ctx.stat.uploads++
  ctx.board?.bump({ uploads: 1 })

  // draft + voxelbr now, while we still have the body, then let it go
  let draft: string | undefined
  let voxelbr: string | undefined
  if (kind === 'image' && ctx.draft?.encodeImage) draft = (await ctx.draft.encodeImage('', bytes)) || undefined
  if (kind === 'vox') {
    if (ctx.draft?.encodeVox) draft = (await ctx.draft.encodeVox(toArrayBuffer(bytes))) || undefined
    voxelbr = await putVoxelbr(ctx, bytes)
  }
  return { location: uploaded.location, ext: ok.ext, base, draft, voxelbr }
}

function yoCompile(parcelId: number, total: number, stat: CompileStat, board?: CompileBoardView) {
  const line = `Yo Compile ${stat.drafts}/${total} features get a draft  patched ${stat.patched}/${total}  dug ${stat.dug}  fail ${stat.fetchFail}  ${kbSize(stat.bytes)}`
  if (board?.logDone) {
    board.logDone(`#${parcelId} ${line}`)
    return
  }
  const c = paint(parcelId)
  say('')
  say(`${c}${B}   ___ ___  __  __ ___ ___ _    ___ ${R}`)
  say(`${c}${B}  / __/ _ \\|  \\/  | _ \\_ _| |  | __|${R}`)
  say(`${c}${B} | (_| (_) | |\\/| |  _/| || |__| _| ${R}`)
  say(`${c}${B}  \\___\\___/|_|  |_|_| |___|____|___|${R}`)
  say(`${c}${B}  ${line}  ${vibe(parcelId)}${R}`)
  say('')
}

export async function compileParcelContent(
  parcelId: number,
  features: FeatureRecord[],
  tileset: string | undefined,
  upload: CompileUpload,
  draft?: CompileDraft,
  opts?: {
    pools?: CompilePools
    board?: CompileBoardView
    hoard?: CompileHoard
  },
): Promise<CompileResult> {
  const out: Record<string, FeatureRecord> = {}
  let tilesetOut: string | false | undefined
  const n = features.length
  const stat = emptyStat()
  const missing: string[] = []
  const ctx: JobCtx = { parcelId, upload, pools: opts?.pools, board: opts?.board, hoard: opts?.hoard, draft, missing, stat, fetchMemo: new Map(), rehostMemo: new Map() }

  ctx.board?.bump({ total: 0 })

  type UrlJob = {
    uuid?: string
    field?: (typeof URL_FIELDS)[number]
    rawUrl: string
    kind: SniffKind
    isTileset?: boolean
  }

  const jobs: UrlJob[] = []

  for (const f of features) {
    if (!f.uuid) continue
    for (const field of URL_FIELDS) {
      const raw = tidyURL((f as any)[field])
      if (!raw || shouldSkip(raw) || isParcelUgc(raw, parcelId)) continue
      jobs.push({
        uuid: f.uuid,
        field,
        rawUrl: raw,
        kind: kindFor(f.type, field),
      })
    }
  }

  if (tileset && !isParcelUgc(tileset, parcelId) && !shouldSkip(tileset)) {
    jobs.push({
      rawUrl: tileset,
      kind: 'image',
      isTileset: true,
    })
  }

  ctx.board?.bump({ total: jobs.length })

  const descs = new Map<string, FeatureRecord & { draft?: string }>()
  for (const f of features) {
    if (f.uuid) descs.set(f.uuid, { ...f })
  }

  await Promise.all(
    jobs.map(async (job) => {
      const result = await rehostOne(ctx, job.rawUrl, job.kind)
      if (!result) return

      if (job.isTileset) {
        tilesetOut = result.location
        return
      }

      if (!job.uuid || !job.field) return
      const desc = descs.get(job.uuid)
      if (!desc) return
      ;(desc as any)[job.field] = result.location
      if (job.field === 'url' && result.draft && wantsDraft(desc.type) && result.draft !== (desc as any).draft) setDraft(ctx, desc, result.draft)
      // url change without a fresh voxelbr must kill the stale one
      if (job.field === 'url' && isVoxType(desc.type)) (desc as any).voxelbr = result.voxelbr ?? null
    }),
  )

  // backfill: url already parked on ugc from an earlier pass but draft/voxelbr missing or old format
  await Promise.all(
    features.map(async (f) => {
      if (!f.uuid) return
      const desc = descs.get(f.uuid)!
      const descUrl = tidyURL((desc as any).url)
      const isVox = isVoxType(f.type)
      const oldDraft = (desc as any).draft as string | undefined
      // vox drafts grew 3 size bytes (67 bytes = 92 b64 chars); shorter ones are the unsized format, redo them
      const needDraft = !oldDraft || (isVox && oldDraft.length !== 92)
      const needVoxelbr = isVox && !(desc as any).voxelbr

      if (draft && (needDraft || needVoxelbr) && wantsDraft(f.type) && descUrl?.startsWith('ugc://')) {
        if (isVox) {
          const fetched = await memoFetch(ctx, resolveUgc(descUrl) || '')
          if (!('error' in fetched)) {
            if (needDraft && draft.encodeVox) {
              const d = await draft.encodeVox(toArrayBuffer(fetched.bytes))
              if (d) setDraft(ctx, desc, d)
            }
            if (needVoxelbr) {
              const location = await putVoxelbr(ctx, fetched.bytes)
              if (location) (desc as any).voxelbr = location
            }
          }
        } else if (needDraft && draft.encodeImage) {
          const d = await draft.encodeImage(resolveUgc(descUrl) || '')
          if (d) setDraft(ctx, desc, d)
        }
      }

      for (const field of [...URL_FIELDS, 'draft', 'voxelbr']) {
        if ((desc as any)[field] !== (f as any)[field]) {
          out[f.uuid] = desc
          stat.patched++
          return
        }
      }
    }),
  )

  const patch: CompilePatch = {}
  if (Object.keys(out).length) patch.features = out
  if (tilesetOut !== undefined) patch.tileset = tilesetOut
  yoCompile(parcelId, n, stat, ctx.board)
  return { patch, missing }
}

export function leftoverUrls(parcelId: number, features: FeatureRecord[], tileset?: string): string[] {
  const out: string[] = []
  for (const f of features) {
    for (const field of URL_FIELDS) {
      const raw = tidyURL((f as any)[field])
      if (!raw || shouldSkip(raw) || isParcelUgc(raw, parcelId)) continue
      out.push(raw)
    }
  }
  const t = tidyURL(tileset)
  if (t && !shouldSkip(t) && !isParcelUgc(t, parcelId)) out.push(t)
  return out
}

export function tilesetRuntimeUrl(tileset: string): string {
  if (tileset.startsWith('ugc://')) return resolveUgc(tileset) || tileset
  if (tileset.startsWith('/')) return (process.env.IMG_HOST || '').replace(/\/$/, '') + tileset
  return tileset
}

export function isUgcTextureUrl(url: string | null | undefined) {
  if (!url) return false
  return url.startsWith('ugc://') || url.includes('ugc.voxels.com/')
}
