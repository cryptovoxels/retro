// ABOUTME: Magic-byte sniffers for images, audio, video, vox, and ktx.

export type SniffKind = 'image' | 'audio' | 'video' | 'vox'

export function isVox(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x56 && buf[1] === 0x4f && buf[2] === 0x58 && buf[3] === 0x20
}

export function isPng(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
}

export function isJpeg(buf: Uint8Array): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

export function isGif(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38
}

export function isWebP(buf: Uint8Array): boolean {
  return buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
}

export function isMp3(buf: Uint8Array): boolean {
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true
  return false
}

export function isWav(buf: Uint8Array): boolean {
  return buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45
}

export function isOgg(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53
}

export function isMp4(buf: Uint8Array): boolean {
  return buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
}

export function isWebM(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3
}

export function isKtx(buf: Uint8Array): boolean {
  // 0xAB 4B 54 58 20 31 31 BB 0D 0A 1A 0A
  return buf.length >= 12 && buf[0] === 0xab && buf[1] === 0x4b && buf[2] === 0x54 && buf[3] === 0x58 && buf[4] === 0x20 && buf[5] === 0x31 && buf[6] === 0x31 && buf[7] === 0xbb
}

export function looksLikeHtml(buf: Uint8Array): boolean {
  if (!buf.length) return false
  let i = 0
  while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++
  const slice = buf.subarray(i, i + 16)
  let s = ''
  for (let j = 0; j < slice.length; j++) s += String.fromCharCode(slice[j])
  s = s.toLowerCase()
  return s.startsWith('<!doctype') || s.startsWith('<html') || s.startsWith('<head') || s.startsWith('<body')
}

export function looksLikeJson(buf: Uint8Array): boolean {
  if (!buf.length) return false
  let i = 0
  while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++
  return buf[i] === 0x7b || buf[i] === 0x5b
}

function badMime(contentType: string): boolean {
  const c = contentType.toLowerCase().split(';')[0].trim()
  return c === 'text/html' || c === 'application/json' || c === 'text/plain' || c === 'application/xhtml+xml'
}

export function extForValid(buf: Uint8Array): string {
  if (isVox(buf)) return 'vox'
  if (isPng(buf)) return 'png'
  if (isJpeg(buf)) return 'jpg'
  if (isGif(buf)) return 'gif'
  if (isWebP(buf)) return 'webp'
  if (isMp3(buf)) return 'mp3'
  if (isWav(buf)) return 'wav'
  if (isOgg(buf)) return 'ogg'
  if (isMp4(buf)) return 'mp4'
  if (isWebM(buf)) return 'webm'
  if (isKtx(buf)) return 'ktx'
  return 'bin'
}

export function contentTypeForExt(ext: string): string {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'ogg') return 'audio/ogg'
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'vox') return 'application/octet-stream'
  if (ext === 'ktx' || ext.endsWith('ktx')) return 'image/ktx'
  return 'application/octet-stream'
}

export type SniffOk = { ok: true; ext: string; contentType: string }
export type SniffFail = { ok: false; reason: string }
export type SniffResult = SniffOk | SniffFail

export function sniffBytes(bytes: Uint8Array, contentType: string, kind: SniffKind): SniffResult {
  if (!bytes.length) return { ok: false, reason: 'empty' }
  if (looksLikeHtml(bytes)) return { ok: false, reason: 'html' }
  if (badMime(contentType)) return { ok: false, reason: `mime ${contentType || 'none'}` }
  if (kind !== 'vox' && looksLikeJson(bytes)) return { ok: false, reason: 'json' }

  if (kind === 'image') {
    if (isPng(bytes) || isJpeg(bytes) || isGif(bytes) || isWebP(bytes)) {
      const ext = extForValid(bytes)
      return { ok: true, ext, contentType: contentTypeForExt(ext) }
    }
    return { ok: false, reason: 'not image' }
  }
  if (kind === 'audio') {
    if (isMp3(bytes) || isWav(bytes) || isOgg(bytes) || isMp4(bytes)) {
      const ext = extForValid(bytes)
      return { ok: true, ext, contentType: contentTypeForExt(ext) }
    }
    return { ok: false, reason: 'not audio' }
  }
  if (kind === 'video') {
    if (isMp4(bytes) || isWebM(bytes)) {
      const ext = extForValid(bytes)
      return { ok: true, ext, contentType: contentTypeForExt(ext) }
    }
    return { ok: false, reason: 'not video' }
  }
  if (kind === 'vox') {
    if (isVox(bytes)) return { ok: true, ext: 'vox', contentType: 'application/octet-stream' }
    return { ok: false, reason: 'not vox' }
  }
  return { ok: false, reason: 'unknown kind' }
}

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
  if (u.includes('dropbox')) {
    if (u.includes('?')) {
      if (!/[?&]dl=/.test(u) && !/[?&]raw=/.test(u)) u += '&dl=1'
    } else {
      u += '?dl=1'
    }
  }
  return u
}
