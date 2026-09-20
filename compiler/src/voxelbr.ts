// ABOUTME: Mesh a .vox on the compiler into content-addressed .voxelbr (brotli-wrapped).

import { brotliCompressSync, constants as zlibConstants } from 'zlib'
import { packVoxelbr } from '../../common/vox-import/voxelbr'
import { voxReader, type VoxData } from '../../common/vox-import/vox-reader'

export type VoxelbrPacked = { raw: Uint8Array; br: Uint8Array }

export function encodeVoxelbr(buf: ArrayBuffer): Promise<VoxelbrPacked | null> {
  return new Promise((resolve) => {
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
