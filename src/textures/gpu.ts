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
  const engine = (undefined as any /* todo(lite): BABYLON.EngineStore.Instances[0] */)

  if (!engine) {
    throw new Error('Cannot detect texture format: BabylonJS engine not initialized')
  }

  // NullEngine (used in tests) doesn't have WebGL context
  if (!engine._gl) {
    return '.pvrtc.ktx'
  }

  // Check for supported compression formats in order of preference
  // ETC is smaller than ASTC over the wire
  if (engine._gl.getExtension('WEBGL_compressed_texture_s3tc')) {
    return '.dxt.ktx'
  }
  if (engine._gl.getExtension('WEBGL_compressed_texture_pvrtc')) {
    return '.pvrtc.ktx'
  }
  if (engine._gl.getExtension('WEBGL_compressed_texture_etc')) {
    return '.etc.ktx'
  }
  if (engine._gl.getExtension('WEBGL_compressed_texture_astc')) {
    return '.astc.ktx'
  }

  // Fallback to PVRTC
  return '.pvrtc.ktx'
}
