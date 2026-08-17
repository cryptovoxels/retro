import http from 'http'
import QueryString from 'querystring'
import { v7 as uuid } from 'uuid'
import WebSocket from 'ws'
import { GridClientMessage } from '../../common/messages/grid'
import Avatar from '../avatar'
import authParcelFn from '../auth-parcel'
import { named } from '../lib/logger'
import Parcel, { AbstractParcel, LightmapStatus, ParcelAuthRef } from '../parcel'
import { VoxelsUser } from '../user'
import { GridClient } from './GridClient'
import { GridClusterMessage, GridClusterMessageBroker } from './GridClusterMessageBroker'
import GridShard from './GridShard'
import { GridShardMessage } from './GridShardMessage'
import { PatchSet } from './PatchSet'
import { ParcelAuthResult } from '../../common/messages/parcel'

const CLIENT_INACTIVITY_TIMEOUT = 40000

const log = named('Grid')

export type StatePersistQueueEntry = {
  type: 'parcel'
  parcelId: number
}

export default class GridSocket {
  private wss: WebSocket.Server
  private worldGridShard: GridShard
  private patchSetByClientId: Map<string, PatchSet> = new Map()
  private parcelStateCache: Map<number, Record<string, unknown>> = new Map()
  private statePersistQueue: StatePersistQueueEntry[] = []
  private gridCluster: GridClusterMessageBroker

  constructor(
    server: http.Server,
    path: string,
    verify: (token: string) => Promise<null | {
      wallet: string
    }>,
    gridCluster: GridClusterMessageBroker,
  ) {
    log.info(`Starting grid server`)

    this.gridCluster = gridCluster
    this.worldGridShard = new GridShard(
      (id) => this.worldGetParcel(id),
      (p, f) => this.worldGetFeature(p, f),
      (id) => this.worldGetState(id),
      (m) => this.worldPublishShardMessage(m),
      GridSocket.noopLightmap,
      GridSocket.noopLightmap,
      (p, u) => this.worldAuthParcel(p, u),
    )

    gridCluster.subscribe((message) => {
      this.worldGridShard.handleShardMessage(message)
    })

    this.wss = new WebSocket.Server({
      server,
      path,
      verifyClient: async (info, done) => {
        const setUser = (user: VoxelsUser | null): void => {
          ;(info.req as http.IncomingMessage & { user: VoxelsUser | null }).user = user
        }

        const token = tryGetToken(info.req.url!)
        if (!token) {
          setUser(null)
          done(true)
        } else {
          const user = await verify(token)
          if (user) {
            setUser({
              ...user,
              suspended: await Avatar.getSuspended(user.wallet),
              moderator: await Avatar.isModerator(user.wallet),
            })
            done(true)
          } else {
            done(false, 401, 'Unauthorized')
          }
        }
      },
    })

    this.wss.on('error', (e: unknown) => {
      let errorMessage = 'grid-socket socket error'
      const socketErrorMessage = typeof e === 'object' ? e?.toString() : null
      if (socketErrorMessage) errorMessage += `: ${socketErrorMessage}`
      log.error(errorMessage)
    })

    this.wss.on('connection', (ws: WebSocket.WebSocket, req: http.IncomingMessage) => {
      const client: GridClient = {
        id: uuid(),
        user: (req as any).user,
        send: (message) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message))
          }
        },
        close: () => ws.close(),
      }

      this.worldGridShard.addClient(client)
      this.patchSetByClientId.set(
        client.id,
        new PatchSet(
          (parcelId) => Parcel.load(parcelId),
          (message) => gridCluster.publish(message),
        ),
      )

      ws.on('error', (e) => {
        log.error(`Message handling error: ${e.toString()}`)
      })

      ws.on('message', (data) => {
        const msg = tryParse(data as unknown as string)
        if (!msg) return

        try {
          this.worldGridShard.handleClientMessage(client, msg)
        } catch (e: any) {
          log.error(`Message handling error: ${e.toString()}`)
          // @ts-ignore
          Bugsnag.notify(e)
        }
      })

      ws.on('close', () => {
        this.worldGridShard.removeClient(client)
        this.patchSetByClientId.delete(client.id)
      })
    })

    setInterval(() => {
      this.worldGridShard.removeInactiveClients(CLIENT_INACTIVITY_TIMEOUT)
    }, 5000)

    setInterval(() => {
      const count = Math.min(10, this.statePersistQueue.length)
      for (let i = 0; i < count; i++) {
        const entry = this.statePersistQueue.shift()!
        Parcel.setState(entry.parcelId, this.parcelStateCache.get(entry.parcelId)!)
      }
    }, 2000)
  }

  private static async noopLightmap(_parcelId: number): Promise<void> {}

  private worldGetParcel(parcelId: number) {
    return Parcel.loadRef(parcelId)
  }

  private async worldGetFeature(parcel: ParcelAuthRef, featureId: string): Promise<unknown | null> {
    const full = await Parcel.load(parcel.id)
    if (!full?.content?.features) return null
    for (const feature of full.content.features) {
      if (feature.uuid === featureId) return feature
    }
    return null
  }

  private worldGetState(parcelId: number) {
    return Parcel.getState(parcelId)
  }

  async publishParcelStatePatch(parcelId: number, patch: Record<string, unknown>) {
    await this.worldPublishShardMessage({
      type: 'patchStateCreate',
      payload: { parcelId, patch, sender: 'showbox-light' },
    })
  }

  private async worldPublishShardMessage(message: GridShardMessage): Promise<void> {
    if (message.type === 'patchCreate') {
      const patchSet = this.patchSetByClientId.get(message.payload.sender)
      if (patchSet) {
        patchSet.add(message.payload.parcelId, message.payload.patch)
      } else {
        log.error(`publishShardMessage() for world grid: no PatchSet found for client ID '${message.payload.sender}'!`)
      }
    } else if (message.type === 'patchStateCreate') {
      const state = (await Parcel.getState(message.payload.parcelId)) || {}
      Object.assign(state, message.payload.patch)
      this.parcelStateCache.set(message.payload.parcelId, state)

      if (!this.statePersistQueue.some((entry) => entry.parcelId === message.payload.parcelId)) {
        this.statePersistQueue.push({ type: 'parcel', parcelId: message.payload.parcelId })
      }
    }

    this.gridCluster.publish(message)
  }

  private worldAuthParcel(parcel: ParcelAuthRef, user: VoxelsUser | null): Promise<ParcelAuthResult> {
    return authParcelFn(parcel, user)
  }

  removeClientsByWallet(wallet: string) {
    this.worldGridShard.removeClientsByWallet(wallet)
  }

  async updateAndSendLightmapStatus(_spaceId: string | null, _parcel: AbstractParcel, _status: LightmapStatus): Promise<void> {}
}

function tryParse(data: string): GridClientMessage | null {
  try {
    return JSON.parse(data)
  } catch (ex) {
    return null
  }
}

function tryGetToken(url: string): string | null {
  const token = QueryString.parse(url.split('?')[1])['auth_token']
  if (typeof token === 'string') return token
  return null
}
