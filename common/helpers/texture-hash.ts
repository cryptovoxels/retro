import { simpleHash } from './utils'

export type TextureHashOptions = {
  size: number
  mode: 'color' | 'transparent'
  stretch: boolean
  gif: 'sheet'
  passthrough?: boolean
  dontFlipY?: boolean
}

export function textureHashOptions(transparent = false, stretch = false, isGif = false, size?: number | 'passthrough'): TextureHashOptions {
  return {
    size: size && size !== 'passthrough' ? size : 0,
    mode: transparent ? 'transparent' : 'color',
    stretch,
    gif: 'sheet',
    passthrough: size === 'passthrough',
    dontFlipY: false,
  }
}

export function textureHash(srcURL: string, opts: TextureHashOptions): string {
  const hashableOptions = { ...opts }
  if (!hashableOptions.passthrough) delete hashableOptions.passthrough
  if (!hashableOptions.dontFlipY) delete hashableOptions.dontFlipY
  return simpleHash(srcURL + JSON.stringify(hashableOptions))
}
