import { createHash } from 'node:crypto'
import { Kind, tidyURL, absoluteUrl, env, Env, ResolveOpts } from './resolve'

function push(urls: string[], u?: string | null) {
  if (!u) return
  if (urls.includes(u)) return
  urls.push(u)
}

/** Dropbox share page -> direct download */
export function dropboxDirect(url: string): string {
  let u = url
  if (u.match(/^https:\/\/www\.dropbox\.com\/s\//)) {
    u = u.replace('https://www.dropbox.com/s/', 'https://dl.dropboxusercontent.com/s/')
  } else if (u.match(/^https:\/\/www\.dropbox\.com\/scl\//)) {
    u = u.replace('https://www.dropbox.com/scl/', 'https://dl.dropboxusercontent.com/scl/')
  } else if (u.match(/^https:\/\/www\.dropbox\.com/)) {
    u = u.replace(/^https:\/\/www\.dropbox\.com/, 'https://dl.dropboxusercontent.com')
  }
  u = u.replace(/[?&]dl=0/, '').replace(/[?&]raw=0/, '')
  if (u.includes('?')) {
    if (!/[?&]dl=/.test(u) && !/[?&]raw=/.test(u)) u += '&dl=1'
  } else if (u.includes('dropbox')) {
    u += '?dl=1'
  }
  return u
}

/** Extract /ipfs/<cid>/... and mirror across gateways */
export function ipfsMirrors(url: string): string[] {
  const m = url.match(/\/ipfs\/([A-Za-z0-9]+)(\/[^?#]*)?/)
  if (!m) return []
  const cid = m[1]
  const rest = m[2] || ''
  const path = `/ipfs/${cid}${rest}`
  return [`https://ipfs.io${path}`, `https://cloudflare-ipfs.com${path}`, `https://dweb.link${path}`, `https://gateway.pinata.cloud${path}`]
}

/** cdn.discordapp.com <-> media.discordapp.net */
export function discordSwap(url: string): string {
  if (url.includes('cdn.discordapp.com')) {
    return url.replace('cdn.discordapp.com', 'media.discordapp.net')
  }
  if (url.includes('media.discordapp.net')) {
    return url.replace('media.discordapp.net', 'cdn.discordapp.com')
  }
  return url
}

type HashOpts = {
  size: number
  mode: 'color' | 'transparent'
  stretch: boolean
  gif: 'sheet'
  passthrough?: boolean
  dontFlipY?: boolean
}

function hashify(srcURL: string, opts: HashOpts): string {
  const hashableOptions: any = Object.assign({}, opts)
  if (!hashableOptions.passthrough) delete hashableOptions.passthrough
  if (!hashableOptions.dontFlipY) delete hashableOptions.dontFlipY
  return createHash('sha1')
    .update(srcURL + JSON.stringify(hashableOptions))
    .digest('hex')
}

function compressorSources(srcURL: string, textureCdn: string, transparent: boolean, stretch: boolean): string[] {
  const out: string[] = []
  for (const t of [transparent, !transparent]) {
    for (const s of [stretch, !stretch]) {
      const opts: HashOpts = { size: 0, mode: t ? 'transparent' : 'color', stretch: s, gif: 'sheet' }
      const sha1 = hashify(srcURL, opts)
      const u = `${textureCdn}/compressed/${sha1}_source.png`
      if (!out.includes(u)) out.push(u)
    }
  }
  return out
}

/** Webpage URLs that are never downloadable binary files */
export function isPageUrl(url: string): boolean {
  if (url.match(/twitch\.tv\//i)) return true
  if (url.match(/rarible\.com\/token/i)) return true
  if (url.match(/cryptovoxels\.com\/play/i)) return true
  if (url.match(/voxels\.com\/play/i)) return true
  if (url.match(/opensea\.io\/(assets|item)\//i) && !url.match(/storage\.opensea/i)) return true
  return false
}

/**
 * Build ordered try list. Empty = skip (page URL / nothing useful).
 * One long fall-through. Don't make this clever.
 */
export function buildTryUrls(kind: Kind, raw: string, e: Env = env(), opts: ResolveOpts = {}): string[] {
  const urls: string[] = []

  if (kind === 'tileset') {
    const path = raw.startsWith('/') ? raw : '/' + raw
    push(urls, e.imgHost.replace(/\/$/, '') + path)
    push(urls, e.baseUrl.replace(/\/$/, '') + path)
    return urls
  }

  let u = absoluteUrl(raw, e) || tidyURL(raw) || ''
  if (!u) return []

  // --- skip webpage garbage ---
  if (isPageUrl(u)) return []

  // --- munge ---
  if (u.match(/dropbox\.com/)) {
    push(urls, dropboxDirect(u))
  }

  if (u.match(/\/ipfs\//) || u.match(/pinata\.cloud\/ipfs\//)) {
    for (const g of ipfsMirrors(u)) push(urls, g)
  }

  if (u.match(/discordapp\.(com|net)/)) {
    push(urls, discordSwap(u))
  }

  // original (after light absolute)
  push(urls, u)

  // --- kind fall-throughs ---
  if (kind === 'vox') {
    push(urls, `${e.voxUrl}/vox?url=${encodeURIComponent(u)}`)
    // also herring the discord-swapped form if different
    for (const x of [...urls]) {
      if (x.match(/discordapp/)) {
        push(urls, `${e.voxUrl}/vox?url=${encodeURIComponent(x)}`)
      }
    }
  }

  if (kind === 'image' || kind === 'preview') {
    const transparent = !!opts.transparent
    const stretch = opts.stretch !== false
    for (const s of compressorSources(u, e.textureCdn, transparent, stretch)) {
      push(urls, s)
    }
    // img proxy last ditch on the best primary we have
    const primary = urls[0] || u
    push(urls, `${e.imgUrl}/img?url=${encodeURIComponent(primary)}&passthrough=true`)
  }

  if (kind === 'video') {
    if (opts.assetUrl) {
      const asset = absoluteUrl(opts.assetUrl, e)
      if (asset) {
        if (asset.match(/dropbox\.com/)) push(urls, dropboxDirect(asset))
        push(urls, asset)
      }
    }
  }

  if (kind === 'audio') {
    push(urls, `${e.imgUrl}/audio?url=${encodeURIComponent(u)}&mode=audio`)
  }

  if (kind === 'lightmap') {
    // already pushed u
  }

  return urls
}
