// ABOUTME: Deterministic CDN URLs for rendered thumbs. Key: {version}/{type}/{uuid}.{ext}

const CDN = 'https://ugc.crvox.com'
const VERSION = 'v1'

export function thumbKey(type: string, uuid: string, ext = 'webp') {
  return `${VERSION}/${type}/${uuid}.${ext}`
}

export function thumbUrl(type: string, uuid: string, ext = 'webp') {
  return `${CDN}/${thumbKey(type, uuid, ext)}`
}

/** Wearable collectible thumb CDN URL */
export function wearableThumbUrl(uuid: string) {
  return thumbUrl('wearable', uuid)
}
