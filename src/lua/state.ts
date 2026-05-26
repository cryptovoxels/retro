// Behaviour state descriptors and resolvers.
// Lua scripts declare state with value()/animate()/rng()/persistent() constructors.
// The runtime stores raw descriptors and resolves them to plain numbers/booleans
// when reading. Interrupted animations re-anchor from the current interpolated value.

export type Easing = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'

export type ValueDesc = {
  __kind: 'value'
  value: number | string | boolean
}

export type AnimateDesc = {
  __kind: 'animate'
  from: number
  target: number
  startedAt: number
  duration: number
  easing: Easing
}

export type RngDesc = {
  __kind: 'rng'
  // Resolved at session start to a concrete number; descriptor stays so peers
  // know the resolved range.
  min: number
  max: number
  resolved: number
}

export type PersistentDesc = {
  __kind: 'persistent'
  inner: AnyDesc
}

export type AnyDesc = ValueDesc | AnimateDesc | RngDesc | PersistentDesc

export const isDesc = (x: unknown): x is AnyDesc => !!x && typeof x === 'object' && '__kind' in (x as object)

const ease = (e: Easing, t: number): number => {
  switch (e) {
    case 'ease_in':
      return t * t
    case 'ease_out':
      return 1 - (1 - t) * (1 - t)
    case 'ease_in_out':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    case 'linear':
    default:
      return t
  }
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

// Resolve a descriptor to a plain JS value at the given clock time.
export const resolveDesc = (desc: AnyDesc | unknown, now: number): number | string | boolean | unknown => {
  if (!isDesc(desc)) return desc
  switch (desc.__kind) {
    case 'value':
      return desc.value
    case 'rng':
      return desc.resolved
    case 'persistent':
      return resolveDesc(desc.inner, now)
    case 'animate': {
      if (desc.duration <= 0) return desc.target
      const t = clamp01((now - desc.startedAt) / desc.duration)
      return desc.from + (desc.target - desc.from) * ease(desc.easing, t)
    }
  }
}

// Snap an animate descriptor to the current interpolated value (used when play() interrupts).
export const reanchorAnimate = (desc: AnimateDesc, now: number, target: number, duration?: number, easing?: Easing): AnimateDesc => {
  const current = resolveDesc(desc, now) as number
  return {
    __kind: 'animate',
    from: current,
    target,
    startedAt: now,
    duration: duration ?? desc.duration,
    easing: easing ?? desc.easing,
  }
}

// Tiny seeded PRNG (mulberry32) - deterministic across clients in a session.
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

// Deterministic rng resolver: seed from parcelId + sessionToken + per-call key.
export const resolveRng = (min: number, max: number, parcelId: number | string, sessionToken: string, key: string): number => {
  const seed = hashStr(`${parcelId}:${sessionToken}:${key}`)
  const rand = mulberry32(seed)()
  return min + (max - min) * rand
}
