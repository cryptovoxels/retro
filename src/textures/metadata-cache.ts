export interface Metadata {
  url: string
  frames: number
  duration: number
  format: string
  columns?: number
  rows?: number
}

export function metadataFromResponse(response: Response): Metadata {
  const md: Metadata = {
    url: response.url, // resolve any eventual redirects from the response
    frames: 1,
    duration: 0,
    format: 'png',
  }
  const frameHeader = response.headers.get('x-frames') || response.headers.get('x-amz-meta-frames') || (response.url && new URL(response.url).searchParams.get('frames'))
  if (frameHeader) {
    try {
      const parsed = JSON.parse(frameHeader)
      md.duration = parsed.duration || 3.0
      md.frames = parsed.frames || 1
      md.columns = parsed.columns
      md.rows = parsed.rows
    } catch (e) {}
  }
  const formatHeader = response.headers.get('x-original-format') || response.headers.get('x-amz-meta-original-format')
  if (formatHeader) {
    try {
      md.format = JSON.parse(formatHeader)
    } catch (e) {}
  }
  return md
}
