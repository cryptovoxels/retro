// ABOUTME: Mesh a .vox on the compiler into content-addressed .voxelbr (brotli-wrapped).

import { brotliCompressSync, constants as zlibConstants } from 'zlib'
import { packVoxelbr } from '../../common/vox-import/voxelbr'
import { voxReader, type VoxData } from '../../common/vox-import/vox-reader'

export type VoxelbrPacked = { raw: Uint8Array; br: Uint8Array }

export function encodeVoxelbr(buf: ArrayBuffer): Promise<VoxelbrPacked | null> {
  return new Promise((resolve) => {
    // #region agent log
    const __t0 = Date.now()
    const __ab0 = process.memoryUsage().arrayBuffers
    // #endregion
    try {
      // megavox limit so big models mesh too; output format is the same either way
      voxReader(buf, true, (result: VoxData | Error) => {
        if (result instanceof Error) return resolve(null)
        try {
          const raw = packVoxelbr(result)
          const br = brotliCompressSync(raw, {
            params: {
              [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
              [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
            },
          })
          // #region agent log
          const __g = (globalThis as any).__g
          if (__g) {
            __g.voxelbr++
            __g.voxelbrRaw += raw.byteLength
          }
          const __ms = Date.now() - __t0
          const __abDelta = process.memoryUsage().arrayBuffers - __ab0
          if (raw.byteLength > 2_000_000 || __ms > 300 || __abDelta > 50_000_000)
            (globalThis as any).__dbg?.('voxelbr.ts:encodeVoxelbr', 'big vox mesh', { input: buf.byteLength, raw: raw.byteLength, br: br.byteLength, verts: result.positions.length / 3, indices: result.indices.length, indexBuffer: result.indices.buffer.byteLength, posBuffer: result.positions.buffer.byteLength, size: result.size, ms: __ms, arrayBuffersDeltaMb: Math.round(__abDelta / 1048576) }, 'H2')
          // #endregion
          resolve({ raw, br: new Uint8Array(br) })
        } catch {
          resolve(null)
        }
      })
    } catch {
      resolve(null)
    }
  })
}
