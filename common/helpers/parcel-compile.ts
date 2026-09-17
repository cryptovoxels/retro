// ABOUTME: Rehost parcel feature URLs to UGC, sniff bytes, encode drafts. Parallel via optional farm.

import { isParcelUgc } from './ugc-upload-keys'
import { KTX_SUFFIXES, textureBucketUrl, textureHash, textureHashOptions } from './texture-hash'
import { FeatureRecord } from '../messages/feature'
import { dropboxDirect, sniffBytes, type SniffKind } from './magic'

export type CompilePatch = {
  features?: Record<string, FeatureRecord>
  tileset?: string | false
}

export type UploadResult = { location: string; existed?: boolean }
export type CompileUpload = (name: string, bytes: Uint8Array, contentType: string) => Promise<UploadResult | null>

export type CompilePools = {
  download<T>(fn: (slot: number) => Promise<T>): Promise<T>
  upload<T>(fn: (slot: number) => Promise<T>): Promise<T>
}

export type CompileBoardView = {
  set(slot: number, row: { parcelId: number; url: string; phase: 'GET' | 'PUT' | 'KTX' | 'HAVE' | 'FAIL'; got: number; total: number; detail?: string }): void
  idle(slot: number): void
  bump(partial: { done?: number; total?: number; bytes?: number; drafts?: number; fail?: number; uploads?: number }): void
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
  ktx: number
}

function emptyStat(): CompileStat {
  return { drafts: 0, patched: 0, fetches: 0, fetchFail: 0, bytes: 0, uploads: 0, skipped: 0, ktx: 0 }
}

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
  return false
}

function absoluteUrl(raw: string): string | null {
  let url = tidyURL(raw)
  if (!url) return null
  if (url.startsWith('//')) url = 'https:' + url
  if (url.startsWith('/')) url = (process.env.ASSET_PATH || 'https://www.voxels.com').replace(/\/$/, '') + url
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

type JobCtx = {
  parcelId: number
  upload: CompileUpload
  pools?: CompilePools
  board?: CompileBoardView
  missing: string[]
  stat: CompileStat
}

async function streamFetch(
  url: string,
  onProgress?: (got: number, total: number) => void,
): Promise<{ bytes: Uint8Array; contentType: string; status: number } | { error: string; status?: number }> {
  try {
    const res = await fetch(resolveUgc(url) || url)
    if (!res.ok) return { error: String(res.status), status: res.status }
    const total = parseInt(res.headers.get('content-length') || '0', 10) || 0
    const contentType = res.headers.get('content-type') || ''
    if (!res.body || !onProgress) {
      const buf = await res.arrayBuffer()
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
    return { error: e instanceof Error ? e.message : 'fetch boom' }
  }
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

type RehostOk = { location: string; bytes: Uint8Array; ext: string }
type RehostResult = RehostOk | null

async function rehostOne(
  ctx: JobCtx,
  rawUrl: string,
  fileName: string,
  kind: SniffKind,
  phase: 'GET' | 'KTX' = 'GET',
): Promise<RehostResult> {
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
    ctx.board?.set(slot, { parcelId: ctx.parcelId, url: sourceUrl, phase, got: 0, total: 0 })
    const r = await streamFetch(sourceUrl, (got, total) => {
      ctx.board?.set(slot, { parcelId: ctx.parcelId, url: sourceUrl, phase, got, total })
    })
    if ('error' in r) {
      ctx.board?.set(slot, { parcelId: ctx.parcelId, url: sourceUrl, phase: 'FAIL', got: 0, total: 0, detail: r.error })
      await new Promise((res) => setTimeout(res, 80))
      ctx.board?.idle(slot)
      return r
    }
    ctx.board?.set(slot, { parcelId: ctx.parcelId, url: sourceUrl, phase, got: r.bytes.byteLength, total: r.bytes.byteLength })
    ctx.board?.idle(slot)
    return r
  })

  if ('error' in fetched) {
    markMissing(ctx, rawUrl, fetched.error)
    return null
  }

  const sniff = sniffBytes(fetched.bytes, fetched.contentType, kind)
  if (!sniff.ok) {
    const reason = sniff.reason
    await withDownload(ctx, async (slot) => {
      ctx.board?.set(slot, { parcelId: ctx.parcelId, url: sourceUrl, phase: 'FAIL', got: 0, total: 0, detail: reason })
      await new Promise((res) => setTimeout(res, 80))
      ctx.board?.idle(slot)
    })
    markMissing(ctx, rawUrl, reason)
    return null
  }

  ctx.stat.fetches++
  ctx.stat.bytes += fetched.bytes.byteLength
  ctx.board?.bump({ done: 1, bytes: fetched.bytes.byteLength })

  const name = `${fileName}.${sniff.ext}`
  const uploaded = await withUpload(ctx, async (slot) => {
    ctx.board?.set(slot, { parcelId: ctx.parcelId, url: name, phase: kind === 'ktx' ? 'KTX' : 'PUT', got: 0, total: fetched.bytes.byteLength })
    const loc = await ctx.upload(name, fetched.bytes, sniff.contentType)
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
      got: fetched.bytes.byteLength,
      total: fetched.bytes.byteLength,
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
  if (kind === 'ktx') ctx.stat.ktx++
  return { location: uploaded.location, bytes: fetched.bytes, ext: sniff.ext }
}

async function copyKtx(ctx: JobCtx, baseName: string, sourceUrl: string, transparent: boolean, stretch: boolean) {
  const opts = textureHashOptions(transparent, stretch, /\.gif/i.test(sourceUrl))
  const hash = textureHash(sourceUrl, opts)
  const bucketHost = process.env.TEXTURE_BUCKET || 'https://textures.sfo2.cdn.digitaloceanspaces.com'

  await Promise.all(
    KTX_SUFFIXES.map(async (suffix) => {
      const bucketUrl = textureBucketUrl(hash, suffix, bucketHost)
      const sidecarName = `${baseName}_medium${suffix}`

      const fetched = await withDownload(ctx, async (slot) => {
        ctx.board?.set(slot, { parcelId: ctx.parcelId, url: bucketUrl, phase: 'KTX', got: 0, total: 0 })
        const r = await streamFetch(bucketUrl, (got, total) => {
          ctx.board?.set(slot, { parcelId: ctx.parcelId, url: bucketUrl, phase: 'KTX', got, total })
        })
        ctx.board?.idle(slot)
        return r
      })
      if ('error' in fetched) return
      const sniff = sniffBytes(fetched.bytes, fetched.contentType, 'ktx')
      if (!sniff.ok) return

      await withUpload(ctx, async (slot) => {
        ctx.board?.set(slot, { parcelId: ctx.parcelId, url: sidecarName, phase: 'PUT', got: 0, total: fetched.bytes.byteLength })
        const loc = await ctx.upload(sidecarName, fetched.bytes, 'image/ktx')
        ctx.board?.idle(slot)
        if (loc) {
          ctx.stat.ktx++
          ctx.stat.uploads++
          ctx.board?.bump({ uploads: 1 })
        }
        return loc
      })
    }),
  )
}

function yoCompile(parcelId: number, total: number, stat: CompileStat, board?: CompileBoardView) {
  const line = `Yo Compile ${stat.drafts}/${total} features get a draft  patched ${stat.patched}/${total}  fail ${stat.fetchFail}  ${kbSize(stat.bytes)}`
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
  draft?: {
    encodeImage?: (url: string) => Promise<string | null>
    encodeVox?: (buf: ArrayBuffer) => Promise<string | null>
  },
  opts?: {
    pools?: CompilePools
    board?: CompileBoardView
  },
): Promise<CompileResult> {
  const out: Record<string, FeatureRecord> = {}
  let tilesetOut: string | false | undefined
  const n = features.length
  const stat = emptyStat()
  const missing: string[] = []
  const ctx: JobCtx = { parcelId, upload, pools: opts?.pools, board: opts?.board, missing, stat }
  const bytesByUuid = new Map<string, Uint8Array>()

  ctx.board?.bump({ total: 0 })

  type UrlJob = {
    uuid?: string
    field?: (typeof URL_FIELDS)[number]
    rawUrl: string
    fileName: string
    kind: SniffKind
    rasterOpts?: { transparent: boolean; stretch: boolean }
    isTileset?: boolean
  }

  const jobs: UrlJob[] = []

  for (const f of features) {
    if (!f.uuid) continue
    for (const field of URL_FIELDS) {
      const raw = tidyURL((f as any)[field])
      if (!raw || shouldSkip(raw) || isParcelUgc(raw, parcelId)) continue
      const isRaster = f.type === 'image' || f.type === 'nft-image' || f.type === 'cube' || f.type === 'portal' || field !== 'url'
      jobs.push({
        uuid: f.uuid,
        field,
        rawUrl: raw,
        fileName: `${f.uuid}-${field}`,
        kind: kindFor(f.type, field),
        rasterOpts: isRaster ? { transparent: !!(f as any).transparent, stretch: !!(f as any).stretch } : undefined,
      })
    }
  }

  if (tileset && !isParcelUgc(tileset, parcelId) && !shouldSkip(tileset)) {
    jobs.push({
      rawUrl: tileset,
      fileName: 'tileset',
      kind: 'image',
      isTileset: true,
      rasterOpts: { transparent: false, stretch: false },
    })
  }

  ctx.board?.bump({ total: jobs.length })

  const descs = new Map<string, FeatureRecord & { draft?: string }>()
  for (const f of features) {
    if (f.uuid) descs.set(f.uuid, { ...f })
  }

  await Promise.all(
    jobs.map(async (job) => {
      const result = await rehostOne(ctx, job.rawUrl, job.fileName, job.kind)
      if (!result) return

      if (job.isTileset) {
        tilesetOut = result.location
        if (job.rasterOpts) await copyKtx(ctx, 'tileset', absoluteUrl(job.rawUrl) || job.rawUrl, false, false)
        return
      }

      if (!job.uuid || !job.field) return
      const desc = descs.get(job.uuid)
      if (!desc) return
      ;(desc as any)[job.field] = result.location
      if (job.field === 'url') bytesByUuid.set(job.uuid, result.bytes)
      if (job.rasterOpts && (result.ext === 'png' || result.ext === 'jpg' || result.ext === 'jpeg' || result.ext === 'webp' || result.ext === 'gif')) {
        await copyKtx(ctx, job.fileName, absoluteUrl(job.rawUrl) || job.rawUrl, job.rasterOpts.transparent, job.rasterOpts.stretch)
      }
    }),
  )

  // drafts
  for (const f of features) {
    if (!f.uuid) continue
    const desc = descs.get(f.uuid)!
    let changed = false

    for (const field of URL_FIELDS) {
      if ((desc as any)[field] !== (f as any)[field] && (desc as any)[field]) changed = true
    }

    if (draft?.encodeImage && (f.type === 'image' || f.type === 'nft-image')) {
      const imgUrl = resolveUgc(tidyURL((desc as any).url) || tidyURL(f.url))
      if (imgUrl) {
        const d = await draft.encodeImage(imgUrl)
        if (d && d !== (desc as any).draft) {
          ;(desc as any).draft = d
          changed = true
          stat.drafts++
          ctx.board?.bump({ drafts: 1 })
        }
      }
    }

    if (draft?.encodeVox && (f.type === 'vox-model' || f.type === 'megavox' || f.type === 'ride')) {
      const cached = bytesByUuid.get(f.uuid)
      let buf: ArrayBuffer | null = null
      if (cached) {
        buf = cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength) as ArrayBuffer
      } else {
        const voxUrl = resolveUgc(tidyURL((desc as any).url) || tidyURL(f.url))
        if (voxUrl) {
          const fetched = await streamFetch(voxUrl)
          if (!('error' in fetched)) {
            const b = fetched.bytes
            buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
          }
        }
      }
      if (buf) {
        const d = await draft.encodeVox(buf)
        if (d && d !== (desc as any).draft) {
          ;(desc as any).draft = d
          changed = true
          stat.drafts++
          ctx.board?.bump({ drafts: 1 })
        }
      }
    }

    if (changed) {
      out[f.uuid] = desc
      stat.patched++
    }
  }

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

export function ugcKtxUrl(srcURL: string, format: string): string | null {
  const resolved = resolveUgc(srcURL)
  if (!resolved || (!srcURL.startsWith('ugc://') && !resolved.includes('ugc.voxels.com/'))) return null
  const dot = resolved.lastIndexOf('.')
  if (dot < 0) return null
  return resolved.slice(0, dot) + `_medium${format}`
}

export function isUgcTextureUrl(url: string | null | undefined) {
  if (!url) return false
  return url.startsWith('ugc://') || url.includes('ugc.voxels.com/')
}
