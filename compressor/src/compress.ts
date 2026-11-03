import path from 'path'
import config from './config'
import { pack } from './utils'

interface FormatSettings {
  compression: string
  quality: string
}

interface CompressionOptions {
  type: string
  opaque: FormatSettings
  withAlpha: FormatSettings
}

const commonOptions = {
  flipY: false,
  mipmap: true,
  verbose: false,
  pot: '-',
  square: '-',
}

export const Compressions: Map<string, CompressionOptions> = new Map([
  ['.dxt.ktx', { type: 's3tc', opaque: { compression: 'DXT1', quality: 'normal' }, withAlpha: { compression: 'DXT5', quality: 'better' } }],
  ['.etc.ktx', { type: 'etc', opaque: { compression: 'ETC2_RGB', quality: 'etcfast' }, withAlpha: { compression: 'ETC2_RGBA', quality: 'etcfast' } }],
  ['.pvrtc.ktx', { type: 'pvrtc', opaque: { compression: 'PVRTCI_2BPP_RGB', quality: 'pvrtcnormal' }, withAlpha: { compression: 'PVRTCI_4BPP_RGBA', quality: 'pvrtcnormal' } }],
  ['.astc.ktx', { type: 'astc', opaque: { compression: 'ASTC_4x4', quality: 'astcfast' }, withAlpha: { compression: 'ASTC_8x8', quality: 'astcfast' } }],
])

const VALID_FORMATS = Array.from(Compressions.keys()).join(', ')

export function compress(suffix: string, source: string, hasAlpha: boolean): Promise<string> {
  const opts = Compressions.get(suffix)
  if (!opts) {
    throw new Error(`hint parameter required, must be one of: ${VALID_FORMATS}`)
  }

  const dest = path.basename(source, path.extname(source)) + suffix
  const settings = hasAlpha ? opts.withAlpha : opts.opaque

  const compressOptions = {
    input: config.cacheDir(source),
    output: config.cacheDir(dest),
    type: opts.type,
    compression: settings.compression,
    quality: settings.quality,
  }

  const final = Object.assign(compressOptions, commonOptions)
  return pack(final).then(() => dest)
}
