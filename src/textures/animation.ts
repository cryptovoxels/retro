// ABOUTME: Sprite sheet animation for GIF textures converted to texture atlases.
// ABOUTME: Manages per-frame UV offset updates for animated textures.

import { Metadata } from './metadata-cache'
import { SceneContext, Texture2D, onBeforeRender } from '@babylonjs/lite'

// Sprite sheets are limited to a 6x6 grid (36 frames max displayed)
const MAX_SPRITE_GRID_SIZE = 6

// Track animated textures globally for per-frame updates
const animatedTextures = new Map<Texture2D, { frameCount: number; durationMs: number; u: number; v: number; lastFrame: number }>()

/**
 * Initialize scene-level animation observer for sprite sheet textures.
 * Call once during scene setup. GIF textures are converted to sprite sheets
 * by the compressor, and this function animates them by adjusting UV offsets.
 */
export function initializeTextureAnimation(scene: SceneContext) {
  onBeforeRender(scene, () => {
    const now = (undefined as any /* todo(lite): BABYLON.PrecisionDate.Now */)

    animatedTextures.forEach((config, texture) => {
      const pos = (now % config.durationMs) / config.durationMs
      const frame = Math.floor(pos * config.frameCount)

      // Skip if frame hasn't changed
      if (frame === config.lastFrame) {
        return
      }
      config.lastFrame = frame

      // Update UV scale and offset to show the current frame in the sprite grid
      texture.uScale = 1 / config.u
      texture.vScale = 1 / config.v
      texture.uOffset = (1 / config.u) * Math.floor(frame % config.u)
      texture.vOffset = 1 - 1 / config.v - Math.floor(frame / config.u) / config.v
    })
  })
}

/**
 * Register a texture for sprite sheet animation based on metadata from the compressor.
 * The compressor converts GIFs to sprite sheets and returns frame count/duration in headers.
 */
export function registerAnimation(metadata: Metadata, texture: Texture2D) {
  const frameCount = metadata.frames as number
  const durationMs = metadata.duration

  // Calculate sprite grid dimensions (max 6x6)
  const u = Math.min(frameCount, MAX_SPRITE_GRID_SIZE)
  const v = Math.min(Math.ceil(frameCount / u), MAX_SPRITE_GRID_SIZE)

  // Set initial UV scale for sprite sheet
  texture.uScale = 1 / u
  texture.vScale = 1 / v

  if (!animatedTextures.has(texture)) {
    animatedTextures.set(texture, {
      frameCount,
      durationMs,
      u,
      v,
      lastFrame: -1,
    })

    // Clean up when texture is disposed
    texture.onDisposeObservable.addOnce(() => {
      animatedTextures.delete(texture)
    })
  }
}
