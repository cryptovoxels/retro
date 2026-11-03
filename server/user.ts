import { Request } from 'express'
import { SuspendedAvatar } from './avatar'

export type VoxelsUser = Express.User & {
  wallet?: string
  /** Identity that signed in, set only while acting as a delegate wallet. */
  account?: string
  moderator?: boolean

  suspended?: SuspendedAvatar | null

  /** skynet tokens edit parcel_id only, with the rights of the owner who minted them */
  skynet?: boolean
  parcel_id?: number
  owner?: string
}

export type VoxelsUserRequest = Request & { user?: VoxelsUser }
