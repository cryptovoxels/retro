import type { Kind } from './resolve'

export function isVox(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x56 && buf[1] === 0x4f && buf[2] === 0x58 && buf[3] === 0x20
}

export function isPng(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
}

export function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

export function isGif(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38
}

export function isWebP(buf: Buffer): boolean {
  return buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
}

export function isMp3(buf: Buffer): boolean {
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true
  return false
}

export function isMp4(buf: Buffer): boolean {
  return buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
}

export type Validator = (buf: Buffer) => boolean

export function validatorFor(kind: Kind): Validator {
  if (kind === 'vox') return isVox
  if (kind === 'audio') return isMp3
  if (kind === 'video') return isMp4
  // image | preview | tileset
  return (b) => isPng(b) || isJpeg(b) || isGif(b) || isWebP(b)
}

export function extForValid(buf: Buffer): string {
  if (isVox(buf)) return '.vox'
  if (isPng(buf)) return '.png'
  if (isJpeg(buf)) return '.jpg'
  if (isGif(buf)) return '.gif'
  if (isWebP(buf)) return '.webp'
  if (isMp3(buf)) return '.mp3'
  if (isMp4(buf)) return '.mp4'
  return '.bin'
}
