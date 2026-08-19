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

/** ISO week key: 2026-W07 */
export function isoWeekTag(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/** Parcel preview key: v1/parcel/{id}/{yyyy}-W{ww}.{ext} */
export function parcelThumbKey(id: number | string, ext = 'webp', d = new Date()) {
  return `${VERSION}/parcel/${id}/${isoWeekTag(d)}.${ext}`
}

export function parcelThumbUrl(id: number | string, ext = 'webp', d = new Date()) {
  return `${CDN}/${parcelThumbKey(id, ext, d)}`
}

/** Live renderer URL (302 to CDN once baked). OpenSea wants png, not webp. */
export function parcelRendererUrl(id: number | string) {
  return `https://www.voxels.com/renderer/v1/parcel/${id}.png`
}
