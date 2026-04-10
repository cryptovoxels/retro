import { SignJWT } from 'jose'
import fetch from 'node-fetch'
import log from '../lib/logger'
import Parcel, { ParcelRef } from '../parcel'
import db from '../pg'
import { VoxelsUserRequest } from '../user'

const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const JWT_SECRET_KEY = new TextEncoder().encode(JWT_SECRET)

const makeLowerCaseSetFor = (dict: { [name: string]: string[] }) => {
  return new Set<string>(([] as string[]).concat(...Object.values(dict)).map((wallet) => wallet.toLowerCase()))
}

// Mods are now loaded from the DB instead of being hardcoded a second time here.

//TODO: The commented-out line below would be ideal, but this requires getting top-level await working first (see sc-3508)
//const mods = new Set<string>((await db.query('embedded/fetch-mods', 'select owner from avatars where moderator')).rows.map(({ owner }: { owner: string }) => owner.toLowerCase()))

// Until the async DB call to populate mods completes, isMod() will conservatively return false for any user
let mods = new Set<string>()

// Asynchronously populate mods from the DB
db.query('embedded/fetch-mods', 'select owner from avatars where moderator').then((result) => {
  mods = new Set<string>(result.rows.map(({ owner }: { owner: string }) => owner.toLowerCase()))
  log.info(`loaded ${mods.size} moderators from the DB`)
})

// Group of parcels that will be part of the security auditing performed by Quantum security
const securityTeamParcels = [5067, 5064]

const cryptovoxelsTeam = makeLowerCaseSetFor({
  ben: ['0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2'],
})

export const isOwner = (req: Pick<VoxelsUserRequest, 'user'>) => {
  return req.user && req.user.wallet && req.user.wallet.toLowerCase() === process.env.OWNER_ADDRESS?.toLowerCase()
}

export const isMod = (req: Partial<Pick<VoxelsUserRequest, 'user'>>) => !!req.user?.wallet && mods.has(req.user.wallet.toLowerCase())

export const isSecurityTeamParcel = (parcel: Parcel | ParcelRef) => {
  if (!parcel) {
    return false
  }
  return securityTeamParcels.includes(parcel.id)
}

export const isCVTeam = (wallet: string | undefined) => !!wallet && cryptovoxelsTeam.has(wallet.toLowerCase())

export const isAdmin = (req: Express.Request) => {
  const wallet = req.user ? (req.user as Express.User & { wallet: string }).wallet : null

  if (!wallet) {
    return false
  }

  return cryptovoxelsTeam.has(wallet.toLowerCase())
}

export const isCommonParcel = (parcel: Parcel | ParcelRef) => {
  if (!parcel) {
    return false
  }

  return !!parcel.is_common
}

export const isTestIsland = (parcel: Parcel | ParcelRef) => {
  if (!parcel) {
    return false
  }

  return parcel.island === 'Test Island'
}
// parcels owned by 0x36F1A7f48f4e7bbda9E2d8aEEfEE639cae2604bc
export const isCampusParcels = (parcel: Parcel | ParcelRef) => {
  if (!parcel) {
    return false
  }

  return parcel.owner.toLowerCase() === '0x36F1A7f48f4e7bbda9E2d8aEEfEE639cae2604bc'.toLowerCase()
}

export const isShellParcel = (parcel: Parcel | ParcelRef) => {
  if (!parcel) {
    return false
  }

  if (parcel.kind == 'inner') {
    return false
  }

  return !parcel.is_common && parcel.island === 'Architect Island'
}

export async function generateOriginToken(): Promise<string> {
  const payload = { date: Date.now() }
  return new SignJWT(payload as any).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1m').sign(JWT_SECRET_KEY)
}

export async function callMultiplayerApi(api: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE') {
  const token = await generateOriginToken()
  const p = await fetch(`/mp/api/${api}.json`, {
    headers: { 'x-cryptovoxels-auth': token },
    method,
  })
  return await p.json()
}

export function isHex(num: string) {
  return Boolean(num.match(/^0x[0-9a-f]+$/i)) || (num.startsWith('0x') && Boolean(num.length >= 63))
}

// This REGEX should be safe from ReDOS attacks
// as it does n0t contain any variable repeats, or any alternation inside of repeats
// this is the same regex that is used in the UUID package implementation
const UUID_REGEX = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i

export function isValidUUID(uuid: any) {
  return typeof uuid === 'string' && UUID_REGEX.test(uuid)
}
