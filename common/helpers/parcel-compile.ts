import { isParcelUgc } from './ugc-upload-keys'
import { KTX_SUFFIXES, textureBucketUrl, textureHash, textureHashOptions } from './texture-hash'
import { FeatureRecord } from '../messages/feature'

export type CompilePatch = {
  features?: Record<string, FeatureRecord>
  tileset?: string | false
}

export type CompileUpload = (name: string, bytes: Uint8Array, contentType: string) => Promise<string | null>

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

const RASTER_EXT = /\.(jpe?g|png|webp|gif)$/i

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
  try {
    return new URL(url).toString()
  } catch {
    return null
  }
}

function extFromUrl(url: string, contentType?: string) {
  const m = url.match(/\.([a-z0-9]+)(?:\?|$)/i)
  if (m?.[1]) return m[1].toLowerCase()
  if (contentType?.includes('webp')) return 'webp'
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'jpg'
  if (contentType?.includes('gif')) return 'gif'
  if (contentType?.includes('png')) return 'png'
  if (contentType?.includes('vox')) return 'vox'
  return 'bin'
}

function contentTypeForExt(ext: string) {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'vox') return 'application/octet-stream'
  if (ext.endsWith('ktx')) return 'image/ktx'
  return 'application/octet-stream'
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const res = await fetch(resolveUgc(url) || url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return { bytes: new Uint8Array(buf), contentType: res.headers.get('content-type') || '' }
  } catch {
    return null
  }
}

async function copyKtxSidecars(parcelId: number, baseName: string, sourceUrl: string, transparent: boolean, stretch: boolean, upload: CompileUpload) {
  const opts = textureHashOptions(transparent, stretch, /\.gif/i.test(sourceUrl))
  const hash = textureHash(sourceUrl, opts)
  const bucketHost = process.env.TEXTURE_BUCKET || 'https://textures.sfo2.cdn.digitaloceanspaces.com'

  for (const suffix of KTX_SUFFIXES) {
    const bucketUrl = textureBucketUrl(hash, suffix, bucketHost)
    try {
      const res = await fetch(bucketUrl)
      if (!res.ok) continue
      const bytes = new Uint8Array(await res.arrayBuffer())
      const sidecarName = `${baseName}_medium${suffix}`
      await upload(sidecarName, bytes, 'image/ktx')
    } catch {
      /* skip */
    }
  }
}

async function rehostUrl(parcelId: number, rawUrl: string, fileName: string, upload: CompileUpload, rasterOpts?: { transparent: boolean; stretch: boolean }) {
  if (isParcelUgc(rawUrl, parcelId) || shouldSkip(rawUrl)) return rawUrl
  const sourceUrl = absoluteUrl(rawUrl)
  if (!sourceUrl) return rawUrl

  const fetched = await fetchBytes(sourceUrl)
  if (!fetched) return rawUrl

  const ext = extFromUrl(sourceUrl, fetched.contentType)
  const name = `${fileName}.${ext}`
  const location = await upload(name, fetched.bytes, contentTypeForExt(ext))
  if (!location) return rawUrl

  if (rasterOpts && RASTER_EXT.test(name)) {
    const base = fileName
    await copyKtxSidecars(parcelId, base, sourceUrl, rasterOpts.transparent, rasterOpts.stretch, upload)
  }

  return location
}

const URL_FIELDS = ['url', 'previewUrl', 'assetUrl'] as const

export async function compileParcelContent(
  parcelId: number,
  features: FeatureRecord[],
  tileset: string | undefined,
  upload: CompileUpload,
  draft?: {
    encodeImage?: (url: string) => Promise<string | null>
    encodeVox?: (buf: ArrayBuffer) => Promise<string | null>
  },
): Promise<CompilePatch> {
  const out: Record<string, FeatureRecord> = {}
  let tilesetOut: string | false | undefined

  for (const f of features) {
    if (!f.uuid) continue
    const desc = { ...f } as FeatureRecord & { draft?: string }
    let changed = false

    for (const field of URL_FIELDS) {
      const raw = (f as any)[field] as string | undefined
      if (!raw || typeof raw !== 'string') continue
      const isRaster = f.type === 'image' || f.type === 'nft-image' || f.type === 'cube' || f.type === 'portal' || field !== 'url'
      const rasterOpts = isRaster ? { transparent: !!(f as any).transparent, stretch: !!(f as any).stretch } : undefined
      const base = `${f.uuid}-${field}`
      const next = await rehostUrl(parcelId, raw, base, upload, rasterOpts)
      if (next !== raw) {
        ;(desc as any)[field] = next
        changed = true
      }
    }

    if (draft?.encodeImage && (f.type === 'image' || f.type === 'nft-image')) {
      const imgUrl = resolveUgc((desc as any).url || f.url)
      if (imgUrl) {
        const d = await draft.encodeImage(imgUrl)
        if (d && d !== (desc as any).draft) {
          ;(desc as any).draft = d
          changed = true
        }
      }
    }

    if (draft?.encodeVox && (f.type === 'vox-model' || f.type === 'megavox' || f.type === 'ride')) {
      const voxUrl = resolveUgc((desc as any).url || f.url)
      if (voxUrl) {
        const fetched = await fetchBytes(voxUrl)
        if (fetched) {
          const d = await draft.encodeVox(fetched.bytes.buffer)
          if (d && d !== (desc as any).draft) {
            ;(desc as any).draft = d
            changed = true
          }
        }
      }
    }

    if (changed) out[f.uuid] = desc
  }

  if (tileset && !isParcelUgc(tileset, parcelId)) {
    const sourceUrl = tileset.startsWith('/') ? absoluteUrl(tileset) : absoluteUrl(tileset)
    if (sourceUrl) {
      const fetched = await fetchBytes(sourceUrl)
      if (fetched) {
        const ext = extFromUrl(sourceUrl, fetched.contentType) || 'png'
        const location = await upload(`tileset.${ext}`, fetched.bytes, contentTypeForExt(ext))
        if (location) {
          tilesetOut = location
          await copyKtxSidecars(parcelId, 'tileset', sourceUrl, false, false, upload)
        }
      }
    }
  }

  const patch: CompilePatch = {}
  if (Object.keys(out).length) patch.features = out
  if (tilesetOut !== undefined) patch.tileset = tilesetOut
  return patch
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
