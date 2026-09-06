// ABOUTME: Canonical mesh buffer - Int8 positions, Uint8 RGB. Worker boundary contract.

export type MeshMeta = {
  ox: number
  oy: number
  oz: number
  scale: number
}

export type MeshBuf = {
  pos: Int8Array
  rgb: Uint8Array
  idx: Uint16Array | Uint32Array
  meta: MeshMeta
  lit?: Uint8Array
  ci?: Uint8Array
  uv?: Uint8Array
}

export const VOX_SCALE = 0.02
export const PARCEL_SCALE = 0.5

export function packPos(pos: Int8Array, i: number, wx: number, wy: number, wz: number, meta: MeshMeta) {
  const o = i * 3
  pos[o] = Math.max(-128, Math.min(127, Math.round((wx - meta.ox) / meta.scale)))
  pos[o + 1] = Math.max(-128, Math.min(127, Math.round((wy - meta.oy) / meta.scale)))
  pos[o + 2] = Math.max(-128, Math.min(127, Math.round((wz - meta.oz) / meta.scale)))
}

export function packRgb(rgb: Uint8Array, i: number, r: number, g: number, b: number, ao = 255) {
  const scale = (ao * (1 / 255) * 0.5 + 0.4)
  const o = i * 3
  rgb[o] = Math.min(255, Math.round(r * scale))
  rgb[o + 1] = Math.min(255, Math.round(g * scale))
  rgb[o + 2] = Math.min(255, Math.round(b * scale))
}
