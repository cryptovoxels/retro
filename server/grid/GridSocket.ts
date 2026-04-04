import http from 'http'
import QueryString from 'querystring'
import { v7 as uuid } from 'uuid'
import WebSocket from 'ws'
import { GridClientMessage } from '../../common/messages/grid'
import Avatar from '../avatar'
import authParcelFn, { authSpace } from '../auth-parcel'
import { named } from '../lib/logger'
import Parcel, { AbstractParcel, LightmapStatus, ParcelAuthRef } from '../parcel'
import Space, { SINGLE_VALID_SPACE_PARCEL_ID } from '../space'
import { VoxelsUser } from '../user'
import { GridClient } from './GridClient'
import { GridClusterMessage, GridClusterMessageBroker } from './GridClusterMessageBroker'
import GridShard from './GridShard'
import { GridShardMessage } from './GridShardMessage'
import { PatchSet } from './PatchSet'
import { ParcelAuthResult } from '../../common/messages/parcel'

const CLIENT_INACTIVITY_TIMEOUT = 40000

const log = named('Grid')

export type ParcelStatePersistQueueEntry = {
  type: 'parcel'
  parcelId: number
}

export type SpaceStatePersistQueueEntry = {
  type: 'space'
  spaceId: string
}

export type StatePersistQueueEntry = ParcelStatePersistQueueEntry | SpaceStatePersistQueueEntry

export default class GridSocket {
  private wss: WebSocket.Server
  private worldGridShard: GridShard
  private spaceShardsBySpaceId = new Map<string, GridShard>()
  private patchSetByClientId: Map<string, PatchSet> = new Map()
  private parcelStateCache: Map<number, Record<string, unknown>> = new Map()
  private spaceStateCache: Map<string, Record<string, unknown>> = new Map()
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
      if (message.payload.spaceId) {
        // This instance may not be servicing the space associated with the message i.e. there are no clients in that
        // space connected to this instance. This is fine, we can just ignore the message.
        const spaceGridShard = this.spaceShardsBySpaceId.get(message.payload.spaceId)
        if (spaceGridShard) {
          spaceGridShard.handleShardMessage(message)
        }
      } else {
        this.worldGridShard.handleShardMessage(message)
      }
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
      if (socketErrorMessage) {
        errorMessage += `: ${socketErrorMessage}`
      }

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

      const spaceId: string | null = tryDetectSpaceId(req)
      if (spaceId) {
        const spaceGridShard = this.ensureSpaceShard(spaceId)
        spaceGridShard.addClient(client)
        this.patchSetByClientId.set(
          client.id,
          new PatchSet(
            async (parcelId) => {
              if (parcelId !== SINGLE_VALID_SPACE_PARCEL_ID) throw `Unexpected parcel id ${parcelId} for space ${spaceId}`
              const space = await Space.load(spaceId)
              if (!space) {
                throw `Could not find space ${spaceId}`
              }
              return space
            },
            (message) => gridCluster.publish(GridClusterMessage.withSpaceId(message, spaceId)),
          ),
        )
      } else {
        this.worldGridShard.addClient(client)
        this.patchSetByClientId.set(
          client.id,
          new PatchSet(
            (parcelId) => Parcel.load(parcelId),
            (message) => gridCluster.publish(message),
          ),
        )
      }

      ws.on('error', (e) => {
        log.error(`Message handling error: ${e.toString()}`)
      })

      ws.on('message', (data) => {
        const msg = tryParse(data as unknown as string)
        if (!msg) return

        try {
          if (spaceId) {
            if ('parcelId' in msg && msg.parcelId !== SINGLE_VALID_SPACE_PARCEL_ID) {
              ws.close(1003, 'parcelId for a space must be 0')
            }

            const spaceGridShard = this.spaceShardsBySpaceId.get(spaceId)!
            spaceGridShard.handleClientMessage(client, msg)
          } else {
            this.worldGridShard.handleClientMessage(client, msg)
          }
        } catch (e: any) {
          log.error(`Message handling error: ${e.toString()}`)

          // @ts-ignore
          Bugsnag.notify(e)
        }
      })

      ws.on('close', () => {
        if (spaceId) {
          const spaceGridShard = this.spaceShardsBySpaceId.get(spaceId)
          if (spaceGridShard) {
            spaceGridShard.removeClient(client)

            if (spaceGridShard.clients.length === 0) {
              log.debug(`space '${spaceId}' is unoccupied, remove grid shard`)
              this.spaceShardsBySpaceId.delete(spaceId)
            }
          }
        } else {
          this.worldGridShard.removeClient(client)
        }
        this.patchSetByClientId.delete(client.id)
      })
    })

    setInterval(() => {
      this.worldGridShard.removeInactiveClients(CLIENT_INACTIVITY_TIMEOUT)

      for (const spaceGridShard of Array.from(this.spaceShardsBySpaceId.values())) {
        spaceGridShard.removeInactiveClients(CLIENT_INACTIVITY_TIMEOUT)
      }
    }, 5000)

    setInterval(() => {
      // Throttle state persistence (boomboxes, etc) - persist up to 10 parcels every 2 seconds
      const count = Math.min(10, this.statePersistQueue.length)
      for (let i = 0; i < count; i++) {
        const entry = this.statePersistQueue.shift()!
        if (entry.type === 'parcel') {
          Parcel.setState(entry.parcelId, this.parcelStateCache.get(entry.parcelId)!)
        } else {
          Space.setState(entry.spaceId, this.spaceStateCache.get(entry.spaceId)!)
        }
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

      if (!this.statePersistQueue.some((entry) => entry.type === 'parcel' && entry.parcelId === message.payload.parcelId)) {
        this.statePersistQueue.push({ type: 'parcel', parcelId: message.payload.parcelId })
      }
    }

    this.gridCluster.publish(message)
  }

  private worldAuthParcel(parcel: ParcelAuthRef, user: VoxelsUser | null): Promise<ParcelAuthResult> {
    return authParcelFn(parcel, user)
  }

  private async spaceGetParcel(spaceId: string, parcelId: number): Promise<ParcelAuthRef | null> {
    if (parcelId !== SINGLE_VALID_SPACE_PARCEL_ID) return null
    return Space.loadRef(spaceId)
  }

  private async spaceGetFeature(spaceId: string, _parcel: ParcelAuthRef, featureId: string): Promise<unknown | null> {
    const full = await Space.load(spaceId)
    if (!full?.content?.features) return null
    for (const feature of full.content.features) {
      if (feature.uuid === featureId) return feature
    }
    return null
  }

  private spaceGetState(spaceId: string, _parcelId: number) {
    return Space.getState(spaceId)
  }

  private async spacePublishShardMessage(spaceId: string, message: GridShardMessage): Promise<void> {
    if (message.payload.parcelId !== SINGLE_VALID_SPACE_PARCEL_ID) return

    if (message.type === 'patchCreate') {
      const patchSet = this.patchSetByClientId.get(message.payload.sender)
      if (patchSet) {
        patchSet.add(message.payload.parcelId, message.payload.patch)
      } else {
        log.error(`publishShardMessage() for space ${spaceId} grid: no PatchSet found for client ID '${message.payload.sender}'!`)
      }
    } else if (message.type === 'patchStateCreate') {
      const state = (await Space.getState(spaceId)) || {}
      Object.assign(state, message.payload.patch)
      this.spaceStateCache.set(spaceId, state)

      if (!this.statePersistQueue.some((entry) => entry.type === 'space' && entry.spaceId === spaceId)) {
        this.statePersistQueue.push({ type: 'space', spaceId })
      }
    }

    this.gridCluster.publish(GridClusterMessage.withSpaceId(message, spaceId))
  }

  private spaceAuthParcel(parcel: ParcelAuthRef, user: VoxelsUser | null): Promise<ParcelAuthResult> {
    return authSpace(parcel, user)
  }

  removeClientsByWallet(wallet: string) {
    this.worldGridShard.removeClientsByWallet(wallet)

    for (const spaceGridShard of Array.from(this.spaceShardsBySpaceId.values())) {
      spaceGridShard.removeClientsByWallet(wallet)
    }
  }

  // spaceId === null is for world updates.
  // @TODO: Fix this, CURRENTLY UNUSED
  async updateAndSendLightmapStatus(spaceId: string | null, parcel: AbstractParcel, status: LightmapStatus): Promise<void> {
    if (spaceId) {
      this.ensureSpaceShard(spaceId)
    }

    // await this.shardFor(spaceId)?.updateAndSendLightmapStatus(parcel, status)
  }

  private shardFor(spaceId: string | null) {
    if (spaceId == null) {
      return this.worldGridShard
    } else {
      return this.spaceShardsBySpaceId.get(spaceId)
    }
  }

  private ensureSpaceShard(spaceId: string): GridShard {
    let spaceGridShard = this.spaceShardsBySpaceId.get(spaceId)

    if (!spaceGridShard) {
      log.debug(`creating shard for space '${spaceId}'`)
      spaceGridShard = new GridShard(
        (id) => this.spaceGetParcel(spaceId, id),
        (p, f) => this.spaceGetFeature(spaceId, p, f),
        (id) => this.spaceGetState(spaceId, id),
        (m) => this.spacePublishShardMessage(spaceId, m),
        GridSocket.noopLightmap,
        GridSocket.noopLightmap,
        (p, u) => this.spaceAuthParcel(p, u),
      )
      this.spaceShardsBySpaceId.set(spaceId, spaceGridShard)
    }

    return spaceGridShard
  }
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
  if (typeof token === 'string') {
    return token
  } else {
    return null
  }
}

function tryDetectSpaceId(req: http.IncomingMessage): string | null {
  const spaceId = QueryString.parse(req.url!.split('?')[1] || '')['space_id']
  return Array.isArray(spaceId) ? spaceId[0] : spaceId || null
}
