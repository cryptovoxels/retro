// ABOUTME: Core of the UGC -> single bucket migration. Downloads parcel assets, converts images to
// ABOUTME: ETC1S .ktx2 + .webp, bakes far-LOD placeholders, uploads to voxels-ugc, rewrites the scene JSON.

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { nearestPaletteIndex } from '../../common/vox-palette'

const BUCKET = 'voxels-ugc'
const REGION = 'syd1'
const ENDPOINT = 'https://syd1.digitaloceanspaces.com'
const PUBLIC_HOST = 'https://ugc.crvox.com'
const IMG_HOST = process.env.IMG_HOST || 'https://img.cryptovoxels.com'
const CAP = 100 * 1024 * 1024 // 100MB

type Cfg = { dryRun: boolean; manifestPath: string }
let CFG: Cfg = { dryRun: true, manifestPath: '' }
export const configure = (c: Cfg) => (CFG = c)

let _s3: S3Client | null = null
const s3 = () => {
  if (!_s3) {
    const id = process.env.UGC_ACCESS_KEY_ID
    const secret = process.env.UGC_SECRET
    if (!id || !secret) throw new Error('UGC_ACCESS_KEY_ID and UGC_SECRET required')
    _s3 = new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      credentials: { accessKeyId: id, secretAccessKey: secret },
      forcePathStyle: false,
    })
  }
  return _s3
}

const record = (e: any) => {
  if (CFG.manifestPath) fs.appendFileSync(CFG.manifestPath, JSON.stringify(e) + '\n')
}

// --- url helpers ---

const clean = (u: any): string | undefined => {
  if (!u) return undefined
  if (typeof u === 'string') return u.trim()
  if (Array.isArray(u) && u.length) return clean(u[0])
  if (u.url) return clean(u.url)
  return undefined
}
const migrated = (s: string) => s.startsWith(PUBLIC_HOST)
const isOpensea = (s: string) => /opensea\.io/i.test(s) || s.startsWith('ethereum:')
const usable = (s?: string): s is string => !!s && /^(https?:|ipfs:)/i.test(s) && !migrated(s)
const resolveSrc = (s: string) => (s.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${s.slice(7)}` : s)
const sha = (s: string) => crypto.createHash('sha1').update(s).digest('hex')
const publicUrl = (key: string) => `${PUBLIC_HOST}/${key}`
const extFor = (u: string) => {
  try {
    const e = path.extname(new URL(u).pathname).toLowerCase()
    return e && e.length <= 6 ? e : ''
  } catch {
    return ''
  }
}

// --- discord cdn workaround (signed urls expire; refresh via bot api) ---

const discordCache = new Map<string, string | null>()
const isDiscord = (u: string) => /cdn\.discordapp\.com|media\.discordapp\.net/.test(u)
async function refreshDiscord(u: string): Promise<string | null> {
  if (discordCache.has(u)) return discordCache.get(u)!
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    discordCache.set(u, null)
    return null
  }
  try {
    const res = await fetch('https://discord.com/api/v10/attachments/refresh-urls', {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachment_urls: [u] }),
    })
    if (!res.ok) {
      discordCache.set(u, null)
      return null
    }
    const j: any = await res.json()
    const fresh = j?.refreshed_urls?.[0]?.refreshed || null
    discordCache.set(u, fresh)
    return fresh
  } catch {
    discordCache.set(u, null)
    return null
  }
}

type Dl = { buf: Buffer; type: string }
async function download(url: string, cap = CAP): Promise<Dl | { error: string }> {
  let u = url
  if (isDiscord(u)) {
    const r = await refreshDiscord(u)
    if (!r) return { error: 'discord-expired' }
    u = r
  }
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 120000)
  try {
    const res = await fetch(u, { signal: ac.signal, redirect: 'follow' })
    if (!res.ok) return { error: `http ${res.status}` }
    const len = Number(res.headers.get('content-length') || 0)
    if (len && len > cap) return { error: `too-big ${len}` }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > cap) return { error: `too-big ${buf.length}` }
    return { buf, type: res.headers.get('content-type') || '' }
  } catch (e: any) {
    return { error: String(e?.message || e) }
  } finally {
    clearTimeout(t)
  }
}

// --- s3 ---

async function put(key: string, body: Buffer, type: string) {
  if (CFG.dryRun) return
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: type, ACL: 'public-read' }))
}
async function exists(key: string) {
  if (CFG.dryRun) return false
  try {
    await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

// --- magicavoxel parser + 4x4x4 LOD ---

function parseVox(buf: Buffer) {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'VOX ') return null
  let p = 8
  const voxels: { x: number; y: number; z: number; c: number }[] = []
  let palette: number[][] | null = null

  const walk = (end: number) => {
    while (p + 12 <= end) {
      const id = buf.toString('ascii', p, p + 4)
      p += 4
      const n = buf.readInt32LE(p)
      p += 4
      const m = buf.readInt32LE(p)
      p += 4
      const content = p
      const contentEnd = p + n
      if (id === 'MAIN') {
        p = contentEnd
        walk(contentEnd + m)
        return
      } else if (id === 'XYZI') {
        const num = buf.readInt32LE(content)
        let q = content + 4
        for (let i = 0; i < num; i++) {
          voxels.push({ x: buf[q], y: buf[q + 1], z: buf[q + 2], c: buf[q + 3] })
          q += 4
        }
        p = contentEnd
      } else if (id === 'RGBA') {
        palette = []
        let q = content
        for (let i = 0; i < 256; i++) {
          palette.push([buf[q], buf[q + 1], buf[q + 2], buf[q + 3]])
          q += 4
        }
        p = contentEnd
      } else {
        p = contentEnd
      }
    }
  }
  walk(buf.length)
  return voxels.length ? { voxels, palette } : null
}

// Downsample to a 4x4x4 grid, 1 byte per cell = fixed-palette index (0 = empty). Returns 64-byte base64.
// MagicaVoxel z is up; remap to Babylon (x, y=up, z=depth) so the placeholder is oriented right.
export function voxLod4(buf: Buffer): string | null {
  const m = parseVox(buf)
  if (!m) return null
  const { voxels, palette } = m
  let minx = Infinity,
    miny = Infinity,
    minz = Infinity,
    maxx = -Infinity,
    maxy = -Infinity,
    maxz = -Infinity
  for (const v of voxels) {
    if (v.x < minx) minx = v.x
    if (v.y < miny) miny = v.y
    if (v.z < minz) minz = v.z
    if (v.x > maxx) maxx = v.x
    if (v.y > maxy) maxy = v.y
    if (v.z > maxz) maxz = v.z
  }
  const span = (lo: number, hi: number) => Math.max(1, hi - lo + 1)
  const sx = span(minx, maxx),
    sy = span(miny, maxy),
    sz = span(minz, maxz)
  const cell = (lo: number, hi: number, v: number, s: number) => Math.min(3, Math.floor(((v - lo) / s) * 4))

  const tally: Record<number, Map<number, number>> = {}
  for (const v of voxels) {
    const rgb = palette && v.c > 0 && palette[v.c - 1] ? palette[v.c - 1] : [128, 128, 128]
    const idx = nearestPaletteIndex(rgb[0], rgb[1], rgb[2])
    const bx = cell(minx, maxx, v.x, sx)
    const by = cell(minz, maxz, v.z, sz) // up
    const bz = cell(miny, maxy, v.y, sy) // depth
    const c = bx + by * 4 + bz * 16
    ;(tally[c] ||= new Map()).set(idx, (tally[c].get(idx) || 0) + 1)
  }

  const out = Buffer.alloc(64)
  for (const k in tally) {
    let best = 0,
      bestN = -1
    for (const [idx, n] of tally[k]) if (n > bestN) ((bestN = n), (best = idx))
    out[Number(k)] = best
  }
  return out.toString('base64')
}

// --- image conversion ---

function runBasis(png: Buffer): Buffer | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ktx'))
  const inp = path.join(dir, 'in.png')
  const out = path.join(dir, 'out.ktx2')
  try {
    fs.writeFileSync(inp, png)
    execFileSync('basisu', ['-ktx2', '-mipmap', inp, '-output_file', out], { stdio: 'ignore' })
    return fs.readFileSync(out)
  } catch {
    return null
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

type ImgResult = { base: string; thumb?: string } | { error: string }
async function migrateImage(src: string, parcelId: number): Promise<ImgResult> {
  const base = `parcel-${parcelId}/${sha(src)}`
  const baseUrl = publicUrl(base)
  if (CFG.dryRun) {
    record({ parcel: parcelId, src, dst: baseUrl, kind: 'image', status: 'planned' })
    return { base: baseUrl }
  }
  if (await exists(`${base}.webp`)) {
    record({ parcel: parcelId, src, dst: baseUrl, kind: 'image', status: 'exists' })
    let thumb: string | undefined
    try {
      const r = await download(`${baseUrl}.webp`, 10 * 1024 * 1024)
      if (!('error' in r)) {
        const t = await sharp(r.buf).resize(8, 8, { fit: 'fill' }).jpeg({ quality: 40 }).toBuffer()
        thumb = `data:image/jpeg;base64,${t.toString('base64')}`
      }
    } catch {}
    return { base: baseUrl, thumb }
  }
  const dl = await download(resolveSrc(src))
  if ('error' in dl) {
    record({ parcel: parcelId, src, kind: 'image', status: 'error', error: dl.error })
    return { error: dl.error }
  }
  let webp: Buffer, thumb: Buffer, png512: Buffer
  try {
    const img = sharp(dl.buf, { failOn: 'none' })
    webp = await img.clone().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
    thumb = await img.clone().resize(8, 8, { fit: 'fill' }).jpeg({ quality: 40 }).toBuffer()
    png512 = await img.clone().resize(512, 512, { fit: 'fill' }).png().toBuffer()
  } catch (e: any) {
    record({ parcel: parcelId, src, kind: 'image', status: 'error', error: 'decode' })
    return { error: 'decode' }
  }
  const ktx = runBasis(png512)
  if (ktx && !(await exists(`${base}.ktx2`))) await put(`${base}.ktx2`, ktx, 'image/ktx2')
  if (!(await exists(`${base}.webp`))) await put(`${base}.webp`, webp, 'image/webp')
  record({ parcel: parcelId, src, dst: baseUrl, kind: 'image', status: 'uploaded', ktx: !!ktx, bytes: dl.buf.length })
  return { base: baseUrl, thumb: `data:image/jpeg;base64,${thumb.toString('base64')}` }
}

type CopyResult = { url: string } | { error: string }
async function migrateCopy(src: string, parcelId: number, cap = CAP): Promise<CopyResult> {
  const ext = extFor(resolveSrc(src))
  const key = `parcel-${parcelId}/${sha(src)}${ext}`
  const url = publicUrl(key)
  if (CFG.dryRun) {
    record({ parcel: parcelId, src, dst: url, kind: 'copy', status: 'planned' })
    return { url }
  }
  if (await exists(key)) {
    record({ parcel: parcelId, src, dst: url, kind: 'copy', status: 'exists' })
    return { url }
  }
  const dl = await download(resolveSrc(src), cap)
  if ('error' in dl) {
    record({ parcel: parcelId, src, kind: 'copy', status: 'error', error: dl.error })
    return { error: dl.error }
  }
  await put(key, dl.buf, dl.type || 'application/octet-stream')
  record({ parcel: parcelId, src, dst: url, kind: 'copy', status: 'uploaded', bytes: dl.buf.length })
  return { url }
}

type VoxResult = { url: string; lod4?: string } | { error: string }
async function migrateVox(src: string, parcelId: number): Promise<VoxResult> {
  const key = `parcel-${parcelId}/${sha(src)}.vox`
  const url = publicUrl(key)
  if (CFG.dryRun) {
    record({ parcel: parcelId, src, dst: url, kind: 'vox', status: 'planned' })
    return { url }
  }
  if (await exists(key)) {
    record({ parcel: parcelId, src, dst: url, kind: 'vox', status: 'exists' })
    return { url }
  }
  const dl = await download(resolveSrc(src))
  if ('error' in dl) {
    record({ parcel: parcelId, src, kind: 'vox', status: 'error', error: dl.error })
    return { error: dl.error }
  }
  let lod4: string | undefined
  try {
    lod4 = voxLod4(dl.buf) ?? undefined
  } catch {
    lod4 = undefined
  }
  await put(key, dl.buf, 'application/octet-stream')
  record({ parcel: parcelId, src, dst: url, kind: 'vox', status: 'uploaded', lod4: !!lod4, bytes: dl.buf.length })
  return { url, lod4 }
}

const once = async <T>(memo: Map<string, T>, kind: string, src: string, fn: () => Promise<T>): Promise<T> => {
  const k = `${kind}:${src}`
  if (memo.has(k)) return memo.get(k)!
  const v = await fn()
  memo.set(k, v)
  return v
}

export type ParcelStats = { img: number; vox: number; copy: number; skip: number; err: number }

// Walks a parcel's content + lightmap, migrates every asset, rewrites urls in place.
export async function rewriteParcel(parcelId: number, content: any, lightmapUrl: string | null): Promise<{ content: any; lightmap: string | null; changed: boolean; stats: ParcelStats }> {
  const memo = new Map<string, any>()
  const stats: ParcelStats = { img: 0, vox: 0, copy: 0, skip: 0, err: 0 }
  let changed = false

  const img = (s: string) => once(memo, 'img', s, () => migrateImage(s, parcelId))
  const cp = (s: string) => once(memo, 'cp', s, () => migrateCopy(s, parcelId))
  const vox = (s: string) => once(memo, 'vox', s, () => migrateVox(s, parcelId))

  const features = Array.isArray(content?.features) ? content.features : []
  for (const f of features) {
    try {
      switch (f.type) {
        case 'image':
        case 'cube':
        case 'particles': {
          const src = clean(f.url)
          if (!usable(src)) break
          const r = await img(src)
          if ('base' in r) {
            f.url = r.base
            if (r.thumb) f.thumb = r.thumb
            changed = true
            stats.img++
          } else stats.err++
          break
        }
        case 'nft-image': {
          const src = clean(f.url)
          if (!usable(src)) break
          if (isOpensea(src)) {
            record({ parcel: parcelId, src, kind: 'nft', status: 'skip-opensea' })
            stats.skip++
            break
          }
          const r = await img(src)
          if ('base' in r) {
            f.url = r.base
            if (r.thumb) f.thumb = r.thumb
            changed = true
            stats.img++
          } else stats.err++
          break
        }
        case 'portal': {
          const src = clean(f.url)
          if (usable(src)) {
            const r = await img(src)
            if ('base' in r) {
              f.url = r.base
              if (r.thumb) f.thumb = r.thumb
              changed = true
              stats.img++
            } else stats.err++
          }
          const w = clean(f.womp?.image_url)
          if (usable(w)) {
            const r = await img(w)
            if ('base' in r) {
              f.womp.image_url = `${r.base}.webp`
              changed = true
              stats.img++
            } else stats.err++
          }
          break
        }
        case 'video': {
          const src = clean(f.url)
          if (usable(src) && !isOpensea(src)) {
            const r = await cp(src)
            if ('url' in r) {
              f.url = r.url
              changed = true
              stats.copy++
            } else stats.err++
          }
          const pv = clean(f.previewUrl)
          if (usable(pv)) {
            const r = await img(pv)
            if ('base' in r) {
              f.previewUrl = `${r.base}.webp`
              changed = true
              stats.img++
            } else stats.err++
          }
          const au = clean(f.assetUrl)
          if (usable(au) && !isOpensea(au)) {
            const r = await cp(au)
            if ('url' in r) {
              f.assetUrl = r.url
              changed = true
              stats.copy++
            } else stats.err++
          }
          break
        }
        case 'audio': {
          const src = clean(f.url)
          if (usable(src) && !isOpensea(src)) {
            const r = await cp(src)
            if ('url' in r) {
              f.url = r.url
              changed = true
              stats.copy++
            } else stats.err++
          }
          break
        }
        case 'vox-model':
        case 'megavox': {
          const src = clean(f.url)
          if (!usable(src)) break
          const r = await vox(src)
          if ('url' in r) {
            f.url = r.url
            if (r.lod4) f.lod4 = r.lod4
            changed = true
            stats.vox++
          } else stats.err++
          break
        }
        case 'collectible-model': {
          const cur = clean(f.url)
          if (cur && migrated(cur)) break
          const hash = f.collectible?.hash
          if (!hash) break
          const src = `https://www.voxels.com/w/${hash}/vox`
          const r = await vox(src)
          if ('url' in r) {
            f.url = r.url
            if (r.lod4) f.lod4 = r.lod4
            changed = true
            stats.vox++
          } else stats.err++
          break
        }
      }
    } catch (e: any) {
      stats.err++
      record({ parcel: parcelId, type: f.type, status: 'error', error: String(e?.message || e) })
    }
  }

  // tileset atlas. todo phase2: voxel-field must use this as an absolute url (currently IMG_HOST + tileset)
  if (typeof content?.tileset === 'string' && content.tileset && !migrated(content.tileset)) {
    const src = content.tileset.startsWith('http') ? content.tileset : `${IMG_HOST}${content.tileset}`
    const r = await cp(src)
    if ('url' in r) {
      content.tileset = r.url
      changed = true
      stats.copy++
    } else stats.err++
  }

  // lightmap (column, not in content)
  let lightmap = lightmapUrl
  if (typeof lightmap === 'string' && lightmap && !migrated(lightmap)) {
    const r = await cp(lightmap)
    if ('url' in r) {
      lightmap = r.url
      changed = true
      stats.copy++
    } else stats.err++
  }

  return { content, lightmap, changed, stats }
}
