// ABOUTME: Detects GPU compressed texture format support.
// ABOUTME: Returns file extension for the best supported format (.dxt.ktx, .pvrtc.ktx, etc.)

type TextureFormatExtension = '.dxt.ktx' | '.pvrtc.ktx' | '.etc.ktx' | '.astc.ktx'

let cachedFormat: TextureFormatExtension | null = null

/**
 * Get the compressed texture format extension supported by this GPU.
 * Must be called after the lite engine is initialized.
 */
export function getGpuTextureFormat(): TextureFormatExtension {
  if (cachedFormat === null) {
    cachedFormat = detectFormat()
  }
  return cachedFormat
}

function detectFormat(): TextureFormatExtension {
  const device = (window.engine as any)?._device as GPUDevice | undefined
  if (device?.features.has('texture-compression-bc')) {
    return '.dxt.ktx'
  }
  if (device?.features.has('texture-compression-etc2')) {
    return '.etc.ktx'
  }
  if (device?.features.has('texture-compression-astc')) {
    return '.astc.ktx'
  }
  return '.dxt.ktx'
}
