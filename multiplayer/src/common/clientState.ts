import { ClientUUID } from './clientUUID'

export type ClientState = {
  lastSeen: number | null
  identity: {
    name: string
    wallet?: string
  }
  avatar: {
    animation: number
    position: [x: number, y: number, z: number]
    orientation: [x: number, y: number, z: number, w: number]
    lastMoved: number
    allowFollow?: boolean
  } | null

  /** time of last message received */
  lastActive: number
  clientUUID: ClientUUID
}
