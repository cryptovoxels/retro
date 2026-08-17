import { ParcelAuthResult } from '../common/messages/parcel'
import Avatar from './avatar'
import { getERC20Balance } from './lib/ethereum-helpers'
import ParcelUserRight from './parcel-user-right'
import { isCampusParcels, isCommonParcel, isCVTeam, isTestIsland } from './lib/helpers'
import { countOwnedTokens_ERC721Contract, getBalanceOfToken_ERC1155Contract, getOwnerOfToken_ERC721Contract, TokenAddress } from './lib/utils'
import db from './pg'
import Parcel, { ParcelAuthRef, ParcelRef } from './parcel'
import { ethers } from 'ethers'
import { VoxelsUser } from './user'
import { FeatureRecord } from '../common/messages/feature'

export default async function authParcel(parcel: ParcelAuthRef, user: VoxelsUser | null): Promise<ParcelAuthResult> {
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

  const isSandbox = parcel.settings?.sandbox === true

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
    const canEdit = !!user.moderator || (await ownsParcelInSuburb(parcel, user))
    return canEdit ? 'Suburb' : false
  } else if (user.moderator) {
    return 'Moderator'
  } else if (isSandbox) {
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
  if (!parcel || !user) {
    return false
  }
  const feature = parcel?.getFeatureByUuid(featureUuid)

  if (!feature) return false
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

export const ownsParcelInSuburb = async (parcel: Parcel | ParcelRef, user: VoxelsUser | null) => {
  if (user && user.wallet) {
    let ownsParcelInSuburb = false

    const r = await db.query('embedded/owns-parcel-in-suburb', `select id,address,owner from properties where lower(owner) = lower($1) and (select suburbs.name from suburbs where suburbs.id =properties.suburb_id) = $2`, [
      user.wallet,
      parcel.suburb,
    ])

    if (r.rows && r.rows.length > 0) {
      ownsParcelInSuburb = true
    }
    return ownsParcelInSuburb
  }

  return false
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

export async function authParcelByNFT(parcel: Parcel | ParcelRef, user: VoxelsUser | null): Promise<boolean> {
  const p = parcel

  if (!p.settings.tokensToEnter?.length) {
    // no token is needed to enter the parcel, return true
    return true
  }

  // token is needed to enter the parcel and the user is not logged in
  if (!user || !user.wallet) {
    return false
  }

  let pass = false

  for (const token of p.settings.tokensToEnter) {
    if (token.type == 'erc20') {
      let erc20TokenBalance = { balance: 0 }
      try {
        erc20TokenBalance = await getERC20Balance(user.wallet, token.address as TokenAddress, token.chain)
      } catch {}
      if (erc20TokenBalance.balance) {
        // user has balance;
        pass = true
        break
      }
      continue
    }

    if (token.type == 'erc721') {
      // token is an ERC721 NFT COntract and we don't have a token_id specified (any owned is fine)
      if (!token.tokenId) {
        const r = await countOwnedTokens_ERC721Contract(user.wallet, token.address, token.chain)

        if (r) {
          pass = true
          break
        }

        continue
      } else {
        // token is an ERC721 NFT COntract and we have a token_id specified
        const r = await getOwnerOfToken_ERC721Contract(token.tokenId, token.address, token.chain)
        if (r?.toLowerCase() == user.wallet.toLowerCase()) {
          pass = true
          break
        }
        continue
      }
    } else if (token.type == 'erc1155') {
      if (!token.tokenId) {
        // for erc1155 we have to have a token ID or it won't work.
        continue
      }
      // token is an ERC155 NFT COntract and we have a token_id specified (mandatory)
      const r = await getBalanceOfToken_ERC1155Contract(user.wallet, token.address, token.tokenId, token.chain)

      if (!!r) {
        pass = true
        break
      }
      continue
    }
  } //end of loop
  return pass
}
