// ABOUTME: Re-export magic sniffers for world-dump (Buffer-friendly wrappers).

import type { Kind } from './resolve'
import { isVox as isVoxU8, isPng as isPngU8, isJpeg as isJpegU8, isGif as isGifU8, isWebP as isWebPU8, isMp3 as isMp3U8, isMp4 as isMp4U8, extForValid as extForValidU8 } from '../../common/helpers/magic'

export function isVox(buf: Buffer): boolean {
  return isVoxU8(buf)
}

export function isPng(buf: Buffer): boolean {
  return isPngU8(buf)
}

export function isJpeg(buf: Buffer): boolean {
  return isJpegU8(buf)
}

export function isGif(buf: Buffer): boolean {
  return isGifU8(buf)
}

export function isWebP(buf: Buffer): boolean {
  return isWebPU8(buf)
}

export function isMp3(buf: Buffer): boolean {
  return isMp3U8(buf)
}

export function isMp4(buf: Buffer): boolean {
  return isMp4U8(buf)
}

export type Validator = (buf: Buffer) => boolean

export function validatorFor(kind: Kind): Validator {
  if (kind === 'vox') return isVox
  if (kind === 'audio') return isMp3
  if (kind === 'video') return isMp4
  return (b) => isPng(b) || isJpeg(b) || isGif(b) || isWebP(b)
}

export function extForValid(buf: Buffer): string {
  const e = extForValidU8(buf)
  return e === 'bin' ? '.bin' : '.' + e
}
