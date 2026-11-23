// ABOUTME: Detects GPU compressed texture format support.
// ABOUTME: Returns file extension for the best supported format (.dxt.ktx, .pvrtc.ktx, etc.)

type TextureFormatExtension = '.dxt.ktx' | '.pvrtc.ktx' | '.etc.ktx' | '.astc.ktx'

let cachedFormat: TextureFormatExtension | null = null

/**
 * Get the compressed texture format extension supported by this GPU.
 * Must be called after BabylonJS engine is initialized.
 *
 * Returns one of:
 *   .dxt.ktx  - Desktop (S3TC)
 *   .pvrtc.ktx - iOS (PVRTC)
 *   .etc.ktx  - Android (ETC)
 *   .astc.ktx - Modern mobile (ASTC)
 */
export function getGpuTextureFormat(): TextureFormatExtension {
  if (cachedFormat === null) {
    cachedFormat = detectFormat()
  }
  return cachedFormat
}

function detectFormat(): TextureFormatExtension {
  const caps = BABYLON.EngineStore.Instances[0]?.getCaps()
  if (caps?.astc) return '.astc.ktx'
  if (caps?.s3tc) return '.dxt.ktx'
  if (caps?.etc2) return '.etc.ktx'
  return '.dxt.ktx'
}
