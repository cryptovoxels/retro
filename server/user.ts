import { Request } from 'express'
import { SuspendedAvatar } from './avatar'

export type VoxelsUser = Express.User & {
  wallet?: string
  /** Identity that signed in, set only while acting as a delegate wallet. */
  account?: string
  moderator?: boolean

  suspended?: SuspendedAvatar | null
}

export type VoxelsUserRequest = Request & { user?: VoxelsUser }
