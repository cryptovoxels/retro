// ABOUTME: Node-side fetch of preview assets to data-URIs so Chromium never hits the CDN.

const IMG_HOST = process.env.IMG_HOST || 'https://cdn.cryptovoxels.com'
const ASSET_PATH = process.env.ASSET_PATH || 'https://www.voxels.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const REFERER = 'https://www.voxels.com/'

function mimeFrom(url: string, contentType: string | null): string {
  const ct = (contentType || '').split(';')[0].trim()
  if (ct && ct !== 'application/octet-stream') return ct
  if (url.endsWith('.png')) return 'image/png'
  if (url.endsWith('.jpg') || url.endsWith('.jpeg')) return 'image/jpeg'
  if (url.endsWith('.webp')) return 'image/webp'
  if (url.endsWith('.gif')) return 'image/gif'
  if (url.endsWith('.ktx')) return 'image/ktx'
  return 'image/png'
}

function aliasKeys(url: string, dataUri: string, out: Record<string, string>) {
  out[url] = dataUri
  try {
    const u = new URL(url)
    out[u.pathname] = dataUri
    if (u.pathname.startsWith('/')) out[u.pathname.slice(1)] = dataUri
  } catch {
    // ignore
  }
}

async function fetchOne(url: string): Promise<{ url: string; dataUri: string } | null> {
  try {
    const r = await fetch(url, {
      headers: {
        'user-agent': UA,
        referer: REFERER,
        accept: 'image/*,*/*',
      },
    })
    if (!r.ok) {
      console.error('[embed] fail', r.status, url)
      return null
    }
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length) {
      console.error('[embed] empty', url)
      return null
    }
    const mime = mimeFrom(url, r.headers.get('content-type'))
    return { url, dataUri: `data:${mime};base64,${buf.toString('base64')}` }
  } catch (e) {
    console.error('[embed] error', url, e)
    return null
  }
}

/** Fetch urls in Node; return url/pathname -> data-URI map. Failures omitted. */
export async function embedUrls(urls: string[]): Promise<Record<string, string>> {
  const seen = new Set<string>()
  const jobs: string[] = []
  for (const url of urls) {
    if (!url || url.startsWith('data:')) continue
    if (seen.has(url)) continue
    seen.add(url)
    jobs.push(url)
  }
  const out: Record<string, string> = {}
  const results = await Promise.all(jobs.map(fetchOne))
  for (const row of results) {
    if (!row) continue
    aliasKeys(row.url, row.dataUri, out)
  }
  console.log('[embed]', Object.keys(out).filter((k) => k.startsWith('http')).length, 'ok /', jobs.length)
  return out
}

function tilesetUrl(tileset: unknown): string | null {
  if (typeof tileset !== 'string' || !tileset) return null
  const path = tileset.startsWith('/') ? tileset.slice(1) : tileset
  return `${IMG_HOST.replace(/\/$/, '')}/${path}`
}

/** v1: tileset + a few static textures. Push more urls here later. */
export function parcelPreviewUrls(record: Record<string, unknown>): string[] {
  const asset = ASSET_PATH.replace(/\/$/, '')
  const urls = [`${asset}/textures/subgrid.png`, `${asset}/textures/atlas-ao.png`, `${asset}/textures/atlas-empty.png`]
  const tileset = tilesetUrl(record.tileset)
  if (tileset) urls.push(tileset)
  return urls
}
