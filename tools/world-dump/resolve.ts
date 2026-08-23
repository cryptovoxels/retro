export type Kind = 'image' | 'video' | 'preview' | 'audio' | 'vox' | 'tileset'

export type Env = {
  baseUrl: string
  imgHost: string
  imgUrl: string
  textureCdn: string
  voxUrl: string
}

export function env(): Env {
  return {
    baseUrl: process.env.BASE_URL || 'https://www.voxels.com',
    imgHost: process.env.IMG_HOST || 'https://img.cryptovoxels.com',
    imgUrl: process.env.IMG_URL || 'https://img.cryptovoxels.com/node',
    textureCdn: process.env.TEXTURE_CDN || 'https://textures.sfo2.cdn.digitaloceanspaces.com',
    voxUrl: process.env.VOX_URL || 'https://herring.crvox.com/node',
  }
}

export function tidyURL(urlCandidate: any): string | undefined {
  if (!urlCandidate) return undefined
  const trim = (v: any) => (typeof v === 'string' ? v.trim() : v)
  if (typeof urlCandidate == 'string') return trim(urlCandidate)
  if (Array.isArray(urlCandidate) && urlCandidate.length > 0) return tidyURL(urlCandidate[0])
  if (urlCandidate.url) return trim(urlCandidate.url)
  return undefined
}

export function isYoutube(url: string): boolean {
  return /youtube\.com|youtu\.be/i.test(url)
}

export function isHttp(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function absoluteUrl(raw: string, e: Env): string | null {
  let url = tidyURL(raw)
  if (!url) return null
  if (url.startsWith('//')) url = 'https:' + url
  if (url.startsWith('/')) url = e.baseUrl.replace(/\/$/, '') + url
  try {
    url = new URL(url).toString()
  } catch {
    return null
  }
  if (!isHttp(url)) return null
  return url
}

export type ResolveOpts = {
  transparent?: boolean
  stretch?: boolean
  assetUrl?: string | null
}

export function shouldSkip(url: string | undefined | null): boolean {
  if (!url) return true
  if (!isHttp(url) && !url.startsWith('/')) return true
  if (isYoutube(url)) return true
  if (url.match(/twitch\.tv\//i)) return true
  if (url.match(/rarible\.com\/token/i)) return true
  if (url.match(/cryptovoxels\.com\/play/i)) return true
  if (url.match(/voxels\.com\/play/i)) return true
  if (url.match(/opensea\.io\/(assets|item)\//i) && !url.match(/storage\.opensea/i)) return true
  return false
}
