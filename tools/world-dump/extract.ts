import { Kind, tidyURL, shouldSkip, absoluteUrl, env, Env } from './resolve'

export type AssetRef = {
  field: string
  kind: Kind
  raw_url: string
  url: string
  status: 'pending' | 'skip'
  transparent?: boolean
  stretch?: boolean
  assetUrl?: string | null
}

function kindFromFeature(type: string, field: string): Kind | null {
  if (field === 'previewUrl') return 'preview'
  if (field === 'assetUrl') return 'video'
  if (type === 'image' || type === 'nft-image' || type === 'cube') return 'image'
  if (type === 'video') return 'video'
  if (type === 'audio') return 'audio'
  if (type === 'vox-model' || type === 'megavox' || type === 'vox') return 'vox'
  if (type === 'particle-system') return 'image'
  // generic url on unknown types - treat as image if looks like media
  if (field === 'url') return 'image'
  return null
}

export function extractAssets(parcel: any, e: Env = env()): AssetRef[] {
  const out: AssetRef[] = []
  const add = (field: string, kind: Kind, raw: string, extra: Partial<AssetRef> = {}) => {
    const tidied = tidyURL(raw)
    if (!tidied) {
      out.push({ field, kind, raw_url: String(raw ?? ''), url: '', status: 'skip', ...extra })
      return
    }
    if (shouldSkip(tidied)) {
      out.push({ field, kind, raw_url: tidied, url: tidied, status: 'skip', ...extra })
      return
    }
    const abs = absoluteUrl(tidied, e) || (kind === 'tileset' ? tidied : null)
    if (!abs && kind !== 'tileset') {
      out.push({ field, kind, raw_url: tidied, url: tidied, status: 'skip', ...extra })
      return
    }
    out.push({
      field,
      kind,
      raw_url: tidied,
      url: abs || tidied,
      status: 'pending',
      ...extra,
    })
  }

  if (parcel.lightmap_url) {
    add('lightmap_url', 'lightmap', parcel.lightmap_url)
  }

  const content = typeof parcel.content === 'string' ? JSON.parse(parcel.content) : parcel.content
  if (!content) return out

  if (content.tileset && typeof content.tileset === 'string') {
    add('content.tileset', 'tileset', content.tileset)
  }

  const features = Array.isArray(content.features) ? content.features : []
  for (let i = 0; i < features.length; i++) {
    const f = features[i]
    if (!f || typeof f !== 'object') continue
    const type = String(f.type || '')

    if (f.url != null && f.url !== '') {
      const kind = kindFromFeature(type, 'url')
      if (kind) {
        add(`content.features[${i}].url`, kind, f.url, {
          transparent: !!f.transparent,
          stretch: !!f.stretch,
          assetUrl: f.assetUrl || null,
        })
      }
    }

    if (f.previewUrl && type !== 'youtube') {
      add(`content.features[${i}].previewUrl`, 'preview', f.previewUrl, {
        transparent: false,
        stretch: true,
      })
    }

    if (f.assetUrl && type === 'video') {
      // only if different from url - still record; download will dedupe
      const urlStr = tidyURL(f.url)
      const assetStr = tidyURL(f.assetUrl)
      if (assetStr && assetStr !== urlStr) {
        add(`content.features[${i}].assetUrl`, 'video', f.assetUrl)
      }
    }
  }

  return out
}
