import * as t from 'io-ts'

export type AvatarRefObj = { id: string | number; name: string; owner: string; created_at: string }
export type AnonRef = 'anon'
export type AvatarRef = AnonRef | string | AvatarRefObj

// t.any at runtime (no server response validation), but TypeScript sees AvatarRef
export const avatarRefCodec = t.any as t.Type<AvatarRef, unknown, unknown>

export type UserRightRole = 'owner' | 'contributor' | 'excluded'
// a parcel_users row: the collaborator's avatar (or just { owner } when they have none) plus their role
export type ParcelUser = Partial<AvatarRefObj> & { owner: string; role: UserRightRole }
export const parcelUserCodec = t.any as t.Type<ParcelUser, unknown, unknown>

export const avatarName = (a: AvatarRef | null | undefined): string => {
  if (!a) return '...'
  const s = typeof a === 'string' ? a : a.name || a.owner
  if (!s) return '...'
  return s.startsWith('0x') ? s.substring(0, 10) + '...' : s
}

export const avatarSlug = (a: AvatarRef | null | undefined): string => {
  if (!a) return ''
  return typeof a === 'string' ? a : a.name?.toLowerCase() || a.owner || ''
}

export const avatarWallet = (a: AvatarRef | null | undefined): string => {
  if (!a) return ''
  return typeof a === 'string' ? a : a.owner
}
