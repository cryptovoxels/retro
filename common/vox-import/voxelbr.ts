// ABOUTME: Pack/unpack GPU-ready vox buffers as .voxelbr (raw bytes; brotli is Content-Encoding only).

import type { VoxData } from './vox-reader'

export const VXBR_MAGIC = 0x52425856 // 'VXBR' little-endian

function align4(n: number) {
  return (n + 3) & ~3
}

export function packVoxelbr(data: VoxData): Uint8Array {
  const vertCount = data.positions.length / 3
  const indexCount = data.indices.length
  const indexBytes = data.indices.BYTES_PER_ELEMENT === 2 ? 2 : 4

  const posBytes = vertCount * 3
  const posPad = align4(posBytes) - posBytes
  const colBytes = vertCount * 4
  const idxBytes = indexCount * indexBytes
  const idxPad = align4(idxBytes) - idxBytes
  const voxBytes = data.voxels.length * 4
  const total = 16 + posBytes + posPad + colBytes + idxBytes + idxPad + 4 + voxBytes

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, VXBR_MAGIC, true)
  view.setUint32(4, vertCount, true)
  view.setUint32(8, indexCount, true)
  out[12] = indexBytes
  // out[13..15] pad

  let off = 16
  out.set(new Uint8Array(data.positions.buffer, data.positions.byteOffset, posBytes), off)
  off += posBytes + posPad
  out.set(new Uint8Array(data.colors.buffer, data.colors.byteOffset, colBytes), off)
  off += colBytes
  out.set(new Uint8Array(data.indices.buffer, data.indices.byteOffset, idxBytes), off)
  off += idxBytes + idxPad
  view.setUint32(off, data.voxels.length / 3, true)
  out.set(new Uint8Array(data.voxels.buffer, data.voxels.byteOffset, voxBytes), off + 4)
  return out
}

export function unpackVoxelbr(buf: ArrayBuffer): {
  positions: Int8Array
  colors: Uint8Array
  indices: Uint16Array | Uint32Array
  // missing on files compiled before voxels were packed
  voxels?: Int32Array
} {
  if (buf.byteLength < 16) throw new Error('voxelbr too short')
  const view = new DataView(buf)
  if (view.getUint32(0, true) !== VXBR_MAGIC) throw new Error('voxelbr bad magic')
  const vertCount = view.getUint32(4, true)
  const indexCount = view.getUint32(8, true)
  const indexBytes = view.getUint8(12)
  if (indexBytes !== 2 && indexBytes !== 4) throw new Error('voxelbr bad indexBytes')

  const posBytes = vertCount * 3
  const posPad = align4(posBytes) - posBytes
  const colBytes = vertCount * 4
  const idxBytes = indexCount * indexBytes
  if (buf.byteLength < 16 + posBytes + posPad + colBytes + idxBytes) throw new Error('voxelbr truncated')

  let off = 16
  const positions = new Int8Array(buf, off, posBytes)
  off += posBytes + posPad
  const colors = new Uint8Array(buf, off, colBytes)
  off += colBytes
  const indices = indexBytes === 2 ? new Uint16Array(buf, off, indexCount) : new Uint32Array(buf, off, indexCount)
  off += align4(idxBytes)
  let voxels: Int32Array | undefined
  if (buf.byteLength >= off + 4) {
    const n = view.getUint32(off, true) * 3
    if (buf.byteLength >= off + 4 + n * 4) voxels = new Int32Array(buf, off + 4, n)
  }
  return { positions, colors, indices, voxels }
}
