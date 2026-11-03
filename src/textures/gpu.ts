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

function glContext(engine: BABYLON.AbstractEngine): WebGLRenderingContext | null {
  return (engine as BABYLON.Engine)._gl ?? null
}

function detectFormat(): TextureFormatExtension {
  const engine = BABYLON.EngineStore.Instances[0]

  if (!engine) {
    return '.dxt.ktx'
    // throw new Error('Cannot detect texture format: BabylonJS engine not initialized')
  }

  if (engine.isWebGPU) {
    const caps = engine.getCaps()
    if (caps.astc) return '.astc.ktx'
    if (caps.s3tc) return '.dxt.ktx'
    if (caps.etc2) return '.etc.ktx'
    return '.dxt.ktx'
  }

  const gl = glContext(engine)

  // NullEngine (used in tests) doesn't have WebGL context
  if (!gl) {
    return '.pvrtc.ktx'
  }

  if (gl.getExtension('WEBGL_compressed_texture_astc')) {
    return '.astc.ktx'
  }
  if (gl.getExtension('WEBGL_compressed_texture_s3tc')) {
    return '.dxt.ktx'
  }
  if (gl.getExtension('WEBGL_compressed_texture_pvrtc')) {
    return '.pvrtc.ktx'
  }
  if (gl.getExtension('WEBGL_compressed_texture_etc')) {
    return '.etc.ktx'
  }

  // Fallback to PVRTC
  return '.pvrtc.ktx'
}
