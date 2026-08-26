type Parcel = {
  id: number | undefined | null
  spaceId: string | undefined | null
}

class config {
  readonly proxy_base_url = process.env.PROXY_BASE_URL || 'https://proxy.crvox.com'
  readonly proxy_cdn_base_url = process.env.PROXY_CDN_BASE_URL || 'https://cdn2.cryptovoxels.com'
  readonly texture_cachebuster = process.env.TEXTURE_CACHEBUSTER || 'v6'
  readonly isDevelopment = process.env.NODE_ENV !== 'production'
  readonly lightmap_base_url = process.env.SPACES_BUCKET || 'https://files.crvox.com'

  wearablePreviewURL(uuid: string | null, name: string | undefined) {
    if (!uuid || !name) {
      return ''
    }

    const slug = name
      ?.toLowerCase()
      .replace(/[^a-z]+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')

    return 'https://wearables.crvox.com/' + uuid + '-' + slug + '.gif'
  }
  // We no longer pass the parcel ID as a URL parameter as that caused redundant downloads when a vox model appears in multiple parcels
  voxModelURL(url: string, parcel?: Parcel, type?: string) {
    const root = process.env.VOX_URL || 'https://herring.crvox.com/node'
    let proxyURL = root + `/vox?url=${encodeURIComponent(url)}`
    if (type) {
      proxyURL += `&type=${encodeURIComponent(type)}`
    }
    return proxyURL
  }
}

export const Config = new config()
export default Config
