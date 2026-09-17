import { isParcelUgc } from './ugc-upload-keys'
import { KTX_SUFFIXES, textureBucketUrl, textureHash, textureHashOptions } from './texture-hash'
import { FeatureRecord } from '../messages/feature'

export type CompilePatch = {
  features?: Record<string, FeatureRecord>
  tileset?: string | false
}

export type CompileUpload = (name: string, bytes: Uint8Array, contentType: string) => Promise<string | null>

const LOUD = typeof process !== 'undefined' && !!(process as any).versions?.node
const R = '\x1b[0m'
const B = '\x1b[1m'
const D = '\x1b[2m'
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

let stat: CompileStat = emptyStat()

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

async function fetchBytes(url: string, tag = 0): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const c = paint(tag)
  say(`  ${c}${B}Fetching${R} ${c}${truncated(url)}${R} ${D}...${R} ${vibe(tag)}`)
  try {
    const res = await fetch(resolveUgc(url) || url)
    if (!res.ok) {
      stat.fetchFail++
      say(`  ${C[0]}${B}💀 ${res.status}${R} ${truncated(url)} 😵`)
      return null
    }
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    stat.fetches++
    stat.bytes += bytes.byteLength
    say(`  ${c}Fetching ${truncated(url)} ${B}[${kbSize(bytes.byteLength)}]${R} ${vibe(tag + 1)}`)
    return { bytes, contentType: res.headers.get('content-type') || '' }
  } catch (e) {
    stat.fetchFail++
    say(`  ${C[0]}${B}💀 boom${R} ${truncated(url)} ${D}${e}${R} 😵`)
    return null
  }
}

async function copyKtxSidecars(parcelId: number, baseName: string, sourceUrl: string, transparent: boolean, stretch: boolean, upload: CompileUpload) {
  const opts = textureHashOptions(transparent, stretch, /\.gif/i.test(sourceUrl))
  const hash = textureHash(sourceUrl, opts)
  const bucketHost = process.env.TEXTURE_BUCKET || 'https://textures.sfo2.cdn.digitaloceanspaces.com'

  for (const suffix of KTX_SUFFIXES) {
    const bucketUrl = textureBucketUrl(hash, suffix, bucketHost)
    const c = paint(suffix.length)
    say(`  ${c}🧊 ktx ${suffix}${R} ${D}${truncated(bucketUrl)}${R}`)
    try {
      const res = await fetch(bucketUrl)
      if (!res.ok) {
        say(`  ${D}🧊 miss ${suffix} (${res.status}) 🫥${R}`)
        continue
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      const sidecarName = `${baseName}_medium${suffix}`
      say(`  ${c}${B}📤 upload${R} ${sidecarName} ${B}[${kbSize(bytes.byteLength)}]${R} ${vibe(11)}`)
      const loc = await upload(sidecarName, bytes, 'image/ktx')
      if (loc) {
        stat.ktx++
        stat.uploads++
        say(`  ${c}🧊 packed ${sidecarName} ${B}[${kbSize(bytes.byteLength)}]${R} 😎💙`)
      } else {
        say(`  ${C[0]}🧊 ktx upload failed ${sidecarName} 😭${R}`)
      }
    } catch {
      say(`  ${C[0]}🧊 ktx died ${suffix} 💀${R}`)
    }
  }
}

async function rehostUrl(parcelId: number, rawUrl: string, fileName: string, upload: CompileUpload, rasterOpts?: { transparent: boolean; stretch: boolean }, tag = 0) {
  if (isParcelUgc(rawUrl, parcelId)) {
    say(`  ${D}already ugc ${truncated(rawUrl)} 💅${R}`)
    stat.skipped++
    return rawUrl
  }
  if (shouldSkip(rawUrl)) {
    say(`  ${C[3]}😴 skip ${truncated(rawUrl)}${R} ${vibe(2)}`)
    stat.skipped++
    return rawUrl
  }
  const sourceUrl = absoluteUrl(rawUrl)
  if (!sourceUrl) {
    say(`  ${C[1]}🤷 not a url ${truncated(rawUrl)}${R}`)
    stat.skipped++
    return rawUrl
  }

  const fetched = await fetchBytes(sourceUrl, tag)
  if (!fetched) return rawUrl

  const ext = extFromUrl(sourceUrl, fetched.contentType)
  const name = `${fileName}.${ext}`
  say(`  ${paint(tag + 4)}${B}📤 upload${R} ${name} ${B}[${kbSize(fetched.bytes.byteLength)}]${R} ${vibe(tag + 4)}`)
  const location = await upload(name, fetched.bytes, contentTypeForExt(ext))
  if (!location) {
    say(`  ${C[0]}${B}📤 upload failed${R} ${name} 😭💔`)
    return rawUrl
  }
  stat.uploads++
  say(`  ${C[2]}${B}💖 parked${R} ${location} ${vibe(tag + 5)}`)

  if (rasterOpts && RASTER_EXT.test(name)) {
    await copyKtxSidecars(parcelId, fileName, sourceUrl, rasterOpts.transparent, rasterOpts.stretch, upload)
  }

  return location
}

function yoCompile(parcelId: number, total: number) {
  const c = paint(parcelId)
  say('')
  say(`${c}${B}   ___ ___  __  __ ___ ___ _    ___ ${R}`)
  say(`${c}${B}  / __/ _ \\|  \\/  | _ \\_ _| |  | __|${R}`)
  say(`${c}${B} | (_| (_) | |\\/| |  _/| || |__| _| ${R}`)
  say(`${c}${B}  \\___\\___/|_|  |_|_| |___|____|___|${R}`)
  say(`${c}${B}  Yo Compile  ${stat.drafts}/${total} features get a draft  ${vibe(parcelId)}${R}`)
  say(`${paint(2)}  patched ${B}${stat.patched}${R}${paint(2)}/${total}   fetches ${B}${stat.fetches}${R}${paint(2)}  fail ${B}${stat.fetchFail}${R}${paint(2)}  ${kbSize(stat.bytes)}${R}`)
  say(`${paint(4)}  uploads ${B}${stat.uploads}${R}${paint(4)}   ktx ${B}${stat.ktx}${R}${paint(4)}   skipped ${B}${stat.skipped}${R} 🦄💫`)
  say('')
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
  const n = features.length
  stat = emptyStat()
  say(`\n${B}\x1b[45m\x1b[97m  COMPILE parcel ${parcelId}  ${R} ${C[5]}${n} features${R} 🌈🦄💫`)

  for (let i = 0; i < features.length; i++) {
    const f = features[i]
    if (!f.uuid) {
      say(`  ${C[3]}👻 feature ${i} has no uuid, yeet${R}`)
      continue
    }
    const c = paint(i)
    say(`${c}${B}▸ ${f.type}${R} ${c}${D}${f.uuid}${R} ${vibe(i)}`)
    const desc = { ...f } as FeatureRecord & { draft?: string }
    let changed = false

    for (const field of URL_FIELDS) {
      const raw = tidyURL((f as any)[field])
      if (!raw) continue
      say(`  ${c}field ${B}${field}${R} ${D}${truncated(raw)}${R} 💘`)
      const isRaster = f.type === 'image' || f.type === 'nft-image' || f.type === 'cube' || f.type === 'portal' || field !== 'url'
      const rasterOpts = isRaster ? { transparent: !!(f as any).transparent, stretch: !!(f as any).stretch } : undefined
      const base = `${f.uuid}-${field}`
      const next = await rehostUrl(parcelId, raw, base, upload, rasterOpts, i)
      if (next !== (f as any)[field]) {
        ;(desc as any)[field] = next
        changed = true
      }
    }

    if (draft?.encodeImage && (f.type === 'image' || f.type === 'nft-image')) {
      const imgUrl = resolveUgc(tidyURL((desc as any).url) || tidyURL(f.url))
      if (imgUrl) {
        say(`  ${C[5]}✏️  image draft ${truncated(imgUrl)}${R} 😘`)
        const d = await draft.encodeImage(imgUrl)
        if (d && d !== (desc as any).draft) {
          ;(desc as any).draft = d
          changed = true
          stat.drafts++
          say(`  ${C[2]}✏️  draft ok ${d.length} chars 💗${R}`)
        } else {
          say(`  ${D}✏️  draft skip${R} 🫠`)
        }
      }
    }

    if (draft?.encodeVox && (f.type === 'vox-model' || f.type === 'megavox' || f.type === 'ride')) {
      const voxUrl = resolveUgc(tidyURL((desc as any).url) || tidyURL(f.url))
      if (voxUrl) {
        say(`  ${C[4]}🧱 vox draft ${truncated(voxUrl)}${R} 🤩`)
        const fetched = await fetchBytes(voxUrl, i + 8)
        if (fetched) {
          const d = await draft.encodeVox(fetched.bytes.buffer as any)
          if (d && d !== (desc as any).draft) {
            ;(desc as any).draft = d
            changed = true
            stat.drafts++
            say(`  ${C[2]}🧱 vox draft ok ${d.length} chars 💚${R}`)
          } else {
            say(`  ${D}🧱 vox draft skip${R} 🫠`)
          }
        }
      }
    }

    if (changed) {
      out[f.uuid] = desc
      stat.patched++
      say(`  ${C[2]}${B}✔ patched ${f.type}${R} 🎉❤️`)
    }
  }

  if (tileset && !isParcelUgc(tileset, parcelId)) {
    say(`${C[6]}${B}🧩 tileset${R} ${truncated(tileset)} ${vibe(9)}`)
    const sourceUrl = tileset.startsWith('/') ? absoluteUrl(tileset) : absoluteUrl(tileset)
    if (sourceUrl) {
      const fetched = await fetchBytes(sourceUrl, 9)
      if (fetched) {
        const ext = extFromUrl(sourceUrl, fetched.contentType) || 'png'
        say(`  ${C[6]}${B}📤 upload${R} tileset.${ext} ${B}[${kbSize(fetched.bytes.byteLength)}]${R} 😘❤️`)
        const location = await upload(`tileset.${ext}`, fetched.bytes, contentTypeForExt(ext))
        if (location) {
          tilesetOut = location
          stat.uploads++
          say(`  ${C[2]}💖 tileset parked ${location}${R}`)
          await copyKtxSidecars(parcelId, 'tileset', sourceUrl, false, false, upload)
        } else {
          say(`  ${C[0]}📤 tileset upload failed 😭${R}`)
        }
      }
    }
  } else if (tileset) {
    say(`${D}🧩 tileset already ugc ${truncated(tileset)} 💅${R}`)
    stat.skipped++
  }

  const patch: CompilePatch = {}
  if (Object.keys(out).length) patch.features = out
  if (tilesetOut !== undefined) patch.tileset = tilesetOut
  yoCompile(parcelId, n)
  return patch
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
