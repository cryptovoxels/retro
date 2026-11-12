import Avatar from './avatar'
import ParcelUserRight from './parcel-user-right'
import { isCommonParcel, isCVTeam } from './lib/helpers'
import db from './pg'
import Parcel, { ParcelAuthRef } from './parcel'
import { ethers } from 'ethers'
import { VoxelsUser } from './user'
import { FeatureRecord } from '../common/messages/feature'
import { ParcelAuthResult } from '../common/messages/parcel'

export default async function authParcel(parcel: ParcelAuthRef, user: VoxelsUser | null): Promise<ParcelAuthResult> {
  if (parcel.sandbox === true && !parcel.is_common) {
    if (!user) return 'Sandbox'
  }

  const isOwnerSuspended = await Avatar.getSuspended(parcel.owner)

  let wallet: string | null = null
  if (user && user.wallet && ethers.isAddress(user.wallet)) {
    wallet = user.wallet.toLowerCase()
  }

  let parcelUser: ParcelUserRight | null = null // the v2 of contributors

  if (!user) {
    return false
  }

  if (user?.suspended) {
    return false
  } else if (!!isOwnerSuspended && !user.moderator) {
    return false
  } else if (parcel.owner.toLowerCase() == wallet) {
    return 'Owner'
  } else if (wallet) {
    // none of the above, load parce user's right before continuing
    parcelUser = await ParcelUserRight.loadRoleFromParcelIdAndWallet(parcel.id, wallet)
  }

  if (parcelUser?.role == 'owner') {
    return 'Owner'
  } else if (isCVTeam(wallet ?? undefined)) {
    return 'Owner'
  } else if (parcelUser?.role == 'contributor') {
    // user is a standard contributor
    return 'Collaborator'
  } else if (parcelUser?.role == 'excluded') {
    // user is not allowed inside parcel
    // this should be a special thing
    return false
  } else if (isCommonParcel(parcel)) {
    if (user.moderator) return 'Suburb'
    if (!wallet || !parcel.island) return false
    const result = await db.query(
      'embedded/owns-island-parcel',
      `select 1 from properties p where lower(p.island) = lower($2) and p.is_common is not true and p.minted
       and (lower(p.owner) = $1 or exists (select 1 from parcel_users u where u.parcel_id = p.id and lower(u.wallet) = $1 and u.role = 'owner'))
       limit 1`,
      [wallet, parcel.island],
    )
    return result.rowCount ? 'Suburb' : false
  } else if (user.moderator) {
    return 'Moderator'
  } else if (parcel.sandbox === true) {
    return 'Sandbox'
  } else {
    return false
  }
}

export type AuthFeatureResultSuccess = {
  moderator: boolean
  feature?: FeatureRecord
  currentParcel?: Parcel
  parcel?: Parcel
}

export type AuthFeatureResult = AuthFeatureResultSuccess | false

export async function authFeature(parcelId: number, featureUuid: string, currentParcelId: number, user: VoxelsUser | null): Promise<AuthFeatureResult> {
  const parcel = await Parcel.load(parcelId)
  if (!parcel) {
    return false
  }
  const feature = parcel?.getFeatureByUuid(featureUuid)

  if (!feature) return false

  if (!user) {
    if (!parcel.is_common && parcel.sandbox) return { moderator: false, parcel, feature }
    return false
  }
  if (parcel.is_common && !(await authParcel(parcel, user))) return false
  if (user.moderator) {
    return { moderator: true, parcel, feature }
  }

  const currentParcel = await Parcel.load(currentParcelId)
  if (!currentParcel) {
    return false
  }
  const authResult = await authParcel(currentParcel, user)

  // must be allowed to edit the currentParcel
  if (!authResult) return false

  const absolutePosition = featureAbsolutePosition(parcel, feature) // Check position relative to Parcel

  // is feature inside of parcel that we are editing?
  const currentParcelResult = checkInsideParcel(currentParcel, absolutePosition)

  // is feature inside of parcel that contains the JSON of the feature?
  const parentParcelResult = checkInsideParcel(parcel, absolutePosition)

  if (parentParcelResult !== RelativePosition.Inside && currentParcelResult !== RelativePosition.Outside) {
    return { feature, currentParcel, parcel, moderator: false }
  } else {
    return false
  }
}

export enum RelativePosition {
  Inside,
  OutsideTolerated,
  Outside,
  NonApplicable,
}

export function checkInsideParcel(
  parcel: Parcel,
  point: {
    x: number
    y: number
    z: number
  },
): RelativePosition {
  if (!parcel) {
    return RelativePosition.NonApplicable
  }

  if (!parcel.x1 || !parcel.x2 || !parcel.y1 || !parcel.y2 || !parcel.z1 || !parcel.z2) {
    return RelativePosition.NonApplicable
  }

  const { x, y, z } = point

  const streetWidth = 0.25

  if (parcel.x1 <= x && x <= parcel.x2 && parcel.y1 <= y && y <= parcel.y2 && parcel.z1 <= z && z <= parcel.z2) {
    return RelativePosition.Inside
  }

  if (parcel.x1 - streetWidth <= x && x <= parcel.x2 + streetWidth && parcel.y1 <= y && y <= parcel.y2 && parcel.z1 - streetWidth <= z && z <= parcel.z2 + streetWidth) {
    return RelativePosition.OutsideTolerated
  }

  return RelativePosition.Outside
}

function parcelCenter(parcel: Parcel) {
  if (parcel.geometry) {
    let x = 0
    let y = 0
    const coords = parcel.geometry.coordinates[0]

    coords.forEach((tuple: any) => {
      x += tuple[0]
      y += tuple[1]
    })

    return [x / coords.length, y / coords.length]
  }

  return [(parcel.x2 + parcel.x1) / 200, (parcel.z2 + parcel.z1) / 200]
}

export function featureAbsolutePosition(parcel: Parcel, feature: any) {
  const featurePosition = feature.position

  const center = parcelCenter(parcel)

  const z = roundHalf(center[1] * 100 + parseFloat(featurePosition[2]))
  const x = roundHalf(center[0] * 100 + parseFloat(featurePosition[0]))
  const y = roundHalf(parcel.y1 + (parseFloat(featurePosition[1]) - 0.25)) // for some reason the spawn is centered wrong

  return { x, y, z }
}

function roundHalf(value: number) {
  return Math.round(value * 2) / 2
}
