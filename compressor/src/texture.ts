import sharp from 'sharp'
import { hashify } from './storage'
import config from './config'
import { jobSignal } from './utils'

export const enum Type {
  'medium' = 'medium',
}

export interface Options {
  size: number
  mode: string // color, transparent
  stretch: boolean // if not set, use crop
  gif: string // 'sheet'
  passthrough?: boolean
  dontFlipY?: boolean
}

interface Headers {
  [key: string]: string
}

interface FrameInfo {
  frames: number // number of frames
  duration: number // duration in ms
}

// returns the smallest n^2 we can get for a image. For example there is no need to create a 1024px texture if the
// source image is only 300px wide and tall, in that case a 512x512 image is sufficient.
export function smallestPoT(maxSize: number, x: number, y: number): number {
  return Math.min(maxSize, Math.max(potCeil(x), potCeil(y)))
}

export class Texture {
  readonly source: string
  readonly id: string
  options: Options
  frameInfo: FrameInfo = { frames: 1, duration: 0 }
  format: string = 'png'
  outputFormat: string = 'png'
  resizedName: string = ''
  type: Type = Type.medium

  constructor(source: string, opts: Options) {
    this.source = source
    this.id = hashify(source, opts)
    this.options = opts
  }

  public hasAlpha(): boolean {
    return this.options.mode === 'transparent' || this.format === 'gif'
  }

  public setMetadata(md: sharp.Metadata, type: Type) {
    this.frameInfo = { frames: 1, duration: 0 }
    this.type = type
    this.format = md.format || 'png'
    this.outputFormat = md.format || 'png'
    return this
  }

  public HTTPHeaders(prefix: string = ''): Headers {
    const res: Headers = {}
    if (this.frameInfo) res[`${prefix}frames`] = JSON.stringify(this.frameInfo)
    if (this.format) res[`${prefix}original-format`] = JSON.stringify(this.format)
    if (this.outputFormat) res[`${prefix}output-format`] = JSON.stringify(this.outputFormat)
    return res
  }

  public JSONHeaders(prefix: string = ''): string {
    return JSON.stringify(this.HTTPHeaders(prefix))
  }

  public createMedium(): Promise<Texture> {
    return prepare(this)
  }
}

export class CreateError extends Error {
  public file: string
  public url: string
  public message: string
  constructor(file: string, url: string, message: string) {
    super(message)
    this.file = file
    this.url = url
    this.message = message
  }
}

const DEFAULT_MAX_SIZE_IMAGE = 512
const PASSTHROUGH_MAX_SIZE = 4096

function prepare(texture: Texture): Promise<Texture> {
  jobSignal()
  const sourcePath = config.cacheDir(texture.id)
  let maxSizeImage = texture.options?.size ? potCeil(texture.options?.size) : DEFAULT_MAX_SIZE_IMAGE

  if (texture.options.passthrough) {
    maxSizeImage = PASSTHROUGH_MAX_SIZE
  }

  return sharp(sourcePath, { pages: 1, limitInputPixels: 64 * 1024 * 1024 })
    .timeout({ seconds: 10 })
    .metadata()
    .then((md) => {
      texture.setMetadata(md, Type.medium)
      if (!md.width || !md.height) {
        throw new Error('image has no width or height')
      }

      const pixelSize = smallestPoT(maxSizeImage, md.width, md.pageHeight || md.height)
      // GIF/WebP use their first frame. AVIF/HEIF and other decoded formats become PNG.
      texture.outputFormat = ['jpeg', 'png'].includes(texture.format) ? texture.format : 'png'

      texture.resizedName = `${texture.id}_${Type.medium}.${texture.outputFormat}`

      const resizeOpts: sharp.ResizeOptions = { width: pixelSize, height: pixelSize, fit: 'fill', kernel: 'lanczos3' }
      const extractOpts: sharp.Region = { top: 0, left: 0, width: pixelSize, height: pixelSize }

      // Apply center-crop for non-square static images (unless stretch mode enabled)
      if (!texture.options?.stretch && !texture.options.passthrough) {
        resizeOpts.fit = 'outside'
        const aspectRatio = md.width / (md.pageHeight || md.height)
        extractOpts.left = aspectRatio < 1 ? 0 : Math.round((pixelSize * aspectRatio - pixelSize) / 2)
        extractOpts.top = aspectRatio > 1 ? 0 : Math.round((pixelSize / aspectRatio - pixelSize) / 2)
      }

      jobSignal()
      const sharpInstance = sharp(sourcePath, { failOn: 'error', pages: 1, limitInputPixels: 64 * 1024 * 1024 }).timeout({ seconds: 10 })
      return resize(sharpInstance, resizeOpts, extractOpts)
        .then((s) => flatten(s, texture))
        .then((s) => (texture.options.dontFlipY ? s : s.flip()))
        .then((s) => s.toFile(config.cacheDir(texture.resizedName as string)))
        .then(() => texture)
    })
    .catch((error) => {
      jobSignal()
      throw new CreateError(sourcePath, texture.source, error.message)
    })
}

export function resize(source: sharp.Sharp, resizeOpts: sharp.ResizeOptions, extractOpts: sharp.Region): Promise<sharp.Sharp> {
  const res = source.resize(resizeOpts).extract(extractOpts).sharpen().withMetadata()
  return Promise.resolve(res)
}

// Removes transparency by flattening to white background (except for transparent mode or GIFs)
function flatten(sharpInstance: sharp.Sharp, texture: Texture): sharp.Sharp {
  if (texture.options.mode === 'transparent' || texture.format === 'gif') {
    return sharpInstance
  }
  return sharpInstance.flatten({ background: { r: 255, g: 255, b: 255 } })
}

// Rounds up to next power of 2 using bit manipulation (e.g., 300 → 512, 600 → 1024)
export function potCeil(v: number): number {
  v--
  v |= v >> 1
  v |= v >> 2
  v |= v >> 4
  v |= v >> 8
  v |= v >> 16
  v++
  return v
}
