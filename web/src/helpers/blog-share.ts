/** First plain-text lines of a markdown post, for OG / twitter cards. */
export function postExcerpt(body: string, max = 200) {
  const plain = body
    .replace(/^#+\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return ''
  if (plain.length <= max) return plain
  return plain.slice(0, max - 1).trimEnd() + '...'
}

export function postShareUrl(slug: string) {
  const base = (process.env.ASSET_PATH || 'https://www.voxels.com').replace(/\/$/, '')
  return `${base}/blog/${slug}`
}

export function tweetIntentUrl(title: string, url: string) {
  const text = `${title}\n${url}`
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
}
