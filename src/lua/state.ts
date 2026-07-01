// State helpers for the behaviour runtime.
// Animations live in JS-side t0/t1 stamps now, not in user state, so this
// file is just clamping + a deterministic seeded RNG kept around for any
// future use that needs cross-client agreement.

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const hashStr = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Deterministic seeded RNG: same parcel + session + key -> same number on every client.
export const seededRandom = (parcelId: number | string, sessionToken: string, key: string): number => {
  const seed = hashStr(`${parcelId}:${sessionToken}:${key}`)
  return mulberry32(seed)()
}
