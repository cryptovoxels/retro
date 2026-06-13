import * as t from 'io-ts'

export type AvatarRefObj = { id: string | number; name: string; owner: string; created_at: string }
export type AnonRef = 'anon'
export type AvatarRef = AnonRef | string | AvatarRefObj

// t.any at runtime (no server response validation), but TypeScript sees AvatarRef
export const avatarRefCodec = t.any as t.Type<AvatarRef, unknown, unknown>

export const avatarName = (a: AvatarRef | null | undefined): string => {
  if (!a) return '...'
  if (typeof a === 'string') return a.startsWith('0x') ? a.substring(0, 10) + '...' : a
  return a.name || '...'
}

export const avatarSlug = (a: AvatarRef | null | undefined): string => {
  if (!a) return ''
  return typeof a === 'string' ? a : a.name?.toLowerCase() || ''
}

export const avatarWallet = (a: AvatarRef | null | undefined): string => {
  if (!a) return ''
  return typeof a === 'string' ? a : a.owner
}
