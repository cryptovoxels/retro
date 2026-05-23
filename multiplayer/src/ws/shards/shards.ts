import { concat, from } from 'ix/iterable'
import { filter, flatMap } from 'ix/iterable/operators'
import winston from 'winston'
import { AvatarChangedMessage, MessageType } from '../../../../common/messages'
import { ClientUUID } from '../../common/clientUUID'
import { ConnectionHandle } from '../../common/pq'
import { ShardId } from '../../common/shardId'
import { SpaceId } from '../../common/spaceId'
import { WSCloseCodes } from '../../constants/socketCloseCodes'
import type { WsLike } from '../../createServer'
import { Client, ClientConnectionInformation } from '../client'
import { Shard } from './shard'

/**
 * this is where we create and manage the shards.
 * A shard manager and factory..
 */

export type Shards = {
  worldShard: Shard
  spaceShards: Map<SpaceId, Shard>
  shutdown(): void
  dispose(): void
  handleConnection(
    shardID: ShardId,
    clientUUID: ClientUUID,
    ws: WsLike<ClientConnectionInformation>,
  ): Promise<Error | void>
  handleClose(shardID: ShardId, clientUUID: ClientUUID): Error | void
  handleDrain(shardID: ShardId, clientUUID: ClientUUID): Error | void
  handleMessage(shardID: ShardId, clientUUID: ClientUUID, message: ArrayBuffer, isBinary: boolean): Error | void
  handleMessageDropped(shardID: ShardId, clientUUID: ClientUUID, message: ArrayBuffer, isBinary: boolean): Error | void
  onAvatarChanged(wallet: string): void
}

const HEALTHY_UPDATE_HZ = 5
const UNHEALTHY_UPDATE_HZ = 0.5
const MAX_CLIENT_STATE_UPDATE_HZ = 10

const SPACE_SHARD_CLIENT_LIMIT = 10 // max number of clients per space shard

export const CLIENT_INACTIVE_TIMEOUT_MS = 60000 * 1
export const CONNECTION_INACTIVE_TIMEOUT_MS = 30000

export default async function createShards(
  publish: (topic: string, message: ArrayBufferView, isBinary?: boolean) => void,
  logger: winston.Logger,
  connection: ConnectionHandle,
  jwtSecret: string,
  onRadarEvent?: (e: RadarEvent) => void,
): Promise<Shards> {
  const worldShard = createWorldShardInternal({
    publish: (topic, message, isBinary) => publish(topic, message, isBinary),
    logger,
    connection,
    jwtSecret,
    onRadarEvent,
  })
  const spaceShards = new Map<SpaceId, Shard>()

  const interval = setInterval(() => {
    worldShard.scanForInactiveConnections()

    for (const [spaceId, spaceShard] of spaceShards.entries()) {
      spaceShard.scanForInactiveConnections()

      if (spaceShard.getShardClientCount() === 0) {
        disposeSpaceShard(spaceId)
      }
    }
  }, CONNECTION_INACTIVE_TIMEOUT_MS)

  const createSpaceShard = async (spaceId: SpaceId): Promise<Shard> => {
    if (spaceShards.has(spaceId)) {
      throw new Error('Shard already exists')
    }

    const shard = createSpaceShardInternal(spaceId, {
      publish,
      logger,
      connection,
      jwtSecret,
    })
    spaceShards.set(spaceId, shard)
    return shard
  }

  const handleConnection = async (
    shardID: ShardId,
    clientUUID: ClientUUID,
    ws: WsLike<ClientConnectionInformation>,
  ): Promise<Error | void> => {
    // this is a new connection, we need to figure out where it belongs and wire it up
    let connectionShard = shardID.type === 'world' ? worldShard : spaceShards.get(shardID.spaceId)

    // if we don't have a shard for this connection, we need to create one
    if (!connectionShard) {
      // we create space shards on demand
      // if we know their ip, we can rate limit them to stop excessive space creation
      if (shardID.type === 'space') {
        connectionShard = await createSpaceShard(shardID.spaceId)
      } else {
        // wtf? we should always have a world shard, something is very wrong!?
        return new Error('No world shard found for connection')
      }
    }

    // we have a shard, pass the connection to it
    const result = await connectionShard.addClient(ws, clientUUID)
    if (result.kind === 'error') {
      return new Error(`Failed to add client to shard: ${result.reason}`)
    }
    // success
    logger.debug('Client added to shard ', shardID, clientUUID)
  }

  const handleClose = (shardID: ShardId, clientUUID: ClientUUID): Error | void => {
    // this connection is closing, we need to clean up
    const client = getClientOrError(shardID, clientUUID)
    if (client instanceof Error) {
      return client
    }
    client.onClose()
    // if this was the last client in a shard, we can dispose of it
    if (shardID.type === 'space' && spaceShards.get(shardID.spaceId)?.getShardClientCount() === 0) {
      disposeSpaceShard(shardID.spaceId)
    }
  }

  const disposeSpaceShard = (shardID: SpaceId): void => {
    if (!spaceShards.has(shardID)) return

    spaceShards.get(shardID)?.dispose()
    spaceShards.delete(shardID)
  }

  const handleDrain = (shardID: ShardId, clientUUID: ClientUUID): Error | void => {
    // this connection is draining, update the backpressure etc
    const client = getClientOrError(shardID, clientUUID)
    if (client instanceof Error) {
      return client
    }

    client.drained()
  }

  const handleMessage = (
    shardID: ShardId,
    clientUUID: ClientUUID,
    message: ArrayBuffer,
    isBinary: boolean,
  ): Error | void => {
    // this connection has sent us a message, we need to handle it
    const client = getClientOrError(shardID, clientUUID)
    if (client instanceof Error) {
      return client
    }

    client.onMessage(message, isBinary)
  }

  const handleMessageDropped = (
    shardID: ShardId,
    clientUUID: ClientUUID,
    message: ArrayBuffer,
    isBinary: boolean,
  ): Error | void => {
    // this connection has a message that was dropped, we need to handle it
    const client = getClientOrError(shardID, clientUUID)
    if (client instanceof Error) {
      return client
    }
    client.onMessageDropped(message, isBinary)
  }

  const getClientOrError = (shardID: ShardId, clientUUID: ClientUUID): Client | Error => {
    const connectionShard = shardID.type === 'world' ? worldShard : spaceShards.get(shardID.spaceId)
    if (!connectionShard) {
      return new Error('No shard found for connection')
    }
    const client = connectionShard.getClient(clientUUID)
    if (!client) {
      return new Error('No client found for connection')
    }
    return client
  }

  const onAvatarChanged = (wallet: string): void => {
    const changedWallet = wallet.toLowerCase()
    const message: AvatarChangedMessage = {
      type: MessageType.avatarChanged,
      wallet,
      cacheKey: Date.now(),
    }
    ;[worldShard, ...spaceShards.values()]
      .filter((shard) =>
        Array.from(shard.getClients()).some((c) => {
          const w = typeof c.avatar === 'string' ? c.avatar : (c.avatar as any)?.owner
          return w?.toLowerCase() === changedWallet
        }),
      )
      .forEach((shard) => shard.broadcastFromServer(message))
  }

  const onUserSuspended = (
    logger: winston.Logger,
    worldShard: Shard,
    spaceShards: Map<string, Shard>,
    wallet: string,
  ): void => {
    const suspendedWallet = wallet.toLowerCase()
    let dropped = 0

    concat(from([worldShard]), spaceShards.values())
      .pipe(
        flatMap((s) => s.getClients()),
        filter((c) => {
          const w = typeof c.avatar === 'string' ? c.avatar : (c.avatar as any)?.owner
          return w?.toLowerCase() === suspendedWallet
        }),
      )
      .forEach((client) => {
        client.drop(WSCloseCodes.tryAgainLater, 'connection forced drop via voxels.com')
        dropped++
      })

    logger.info(`user with wallet ${wallet} suspended, number of clients dropped: ${dropped}`)
  }

  return {
    worldShard,
    spaceShards,
    handleConnection,
    shutdown: async () => {
      clearInterval(interval)
      await Promise.all([worldShard.shutdown(), [...spaceShards.values()].map((shard) => shard.shutdown())])
    },
    dispose: async () => {
      await Promise.all([worldShard.dispose(), [...spaceShards.values()].map((shard) => shard.dispose())])
    },
    handleClose,
    handleDrain,
    handleMessage,
    handleMessageDropped,
    onAvatarChanged,
  }
}

export type RadarEvent =
  | {
      type: 'move'
      uuid: string
      avatar: import('../../../../common/messages/avatar-ref').AvatarRef | null
      parcel: number
    }
  | { type: 'leave'; uuid: string }

export type ShardOptions = {
  publish: (topic: string, message: ArrayBufferView, isBinary?: boolean) => void
  logger: winston.Logger
  connection: ConnectionHandle
  jwtSecret: string
  onRadarEvent?: (e: RadarEvent) => void
}

const createWorldShardInternal = (opts: ShardOptions) => {
  return new Shard('world', opts.logger, null, opts.publish, opts.connection, opts.jwtSecret, opts.onRadarEvent)
}

const createSpaceShardInternal = (spaceId: SpaceId, opts: ShardOptions) => {
  return new Shard(spaceId, opts.logger, SPACE_SHARD_CLIENT_LIMIT, opts.publish, opts.connection, opts.jwtSecret)
}
