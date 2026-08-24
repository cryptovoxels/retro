import { from } from 'ix/iterable'
import { filter } from 'ix/iterable/operators'
import { AvatarChangedMessage, MessageType } from '../../../../common/messages'
import { ClientUUID } from '../../common/clientUUID'
import { ConnectionHandle } from '../../common/pq'
import { ShardId } from '../../common/shardId'
import { WSCloseCodes } from '../../constants/socketCloseCodes'
import type { WsLike } from '../../createServer'
import { Client, ClientConnectionInformation } from '../client'
import { Shard } from './shard'

export type Shards = {
  worldShard: Shard
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

export const CLIENT_INACTIVE_TIMEOUT_MS = 60000 * 1
export const CONNECTION_INACTIVE_TIMEOUT_MS = 30000

export default async function createShards(
  publish: (topic: string, message: ArrayBufferView, isBinary?: boolean) => void,
  connection: ConnectionHandle,
  jwtSecret: string,
  onRadarEvent?: (e: RadarEvent) => void,
): Promise<Shards> {
  const worldShard = new Shard('world', null, publish, connection, jwtSecret, onRadarEvent)

  try {
    const { rows } = await connection.query<{ id: string; uuid: string; text: string; avatar: unknown; moderated_at: string | null }>(
      'chat/load-recent',
      `SELECT id, uuid, text, avatar, moderated_at FROM chat_messages ORDER BY created_at DESC LIMIT 1000`,
    )
    for (const row of rows.reverse()) {
      worldShard.recentChat.push({
        type: MessageType.chat,
        id: row.id,
        uuid: row.uuid,
        text: row.text,
        avatar: (row.avatar as any) ?? undefined,
        moderated: row.moderated_at != null,
      })
    }
  } catch (err) {
    console.error('failed to load chat history', err)
  }

  const interval = setInterval(() => {
    worldShard.scanForInactiveConnections()
  }, CONNECTION_INACTIVE_TIMEOUT_MS)

  const handleConnection = async (
    shardID: ShardId,
    clientUUID: ClientUUID,
    ws: WsLike<ClientConnectionInformation>,
  ): Promise<Error | void> => {
    const result = await worldShard.addClient(ws, clientUUID)
    if (result.kind === 'error') {
      return new Error(`Failed to add client to shard: ${result.reason}`)
    }
  }

  const handleClose = (_shardID: ShardId, clientUUID: ClientUUID): Error | void => {
    const client = getClientOrError(clientUUID)
    if (client instanceof Error) return client
    client.onClose()
  }

  const handleDrain = (_shardID: ShardId, clientUUID: ClientUUID): Error | void => {
    const client = getClientOrError(clientUUID)
    if (client instanceof Error) return client
    client.drained()
  }

  const handleMessage = (
    _shardID: ShardId,
    clientUUID: ClientUUID,
    message: ArrayBuffer,
    isBinary: boolean,
  ): Error | void => {
    const client = getClientOrError(clientUUID)
    if (client instanceof Error) return client
    client.onMessage(message, isBinary)
  }

  const handleMessageDropped = (
    _shardID: ShardId,
    clientUUID: ClientUUID,
    message: ArrayBuffer,
    isBinary: boolean,
  ): Error | void => {
    const client = getClientOrError(clientUUID)
    if (client instanceof Error) return client
    client.onMessageDropped(message, isBinary)
  }

  const getClientOrError = (clientUUID: ClientUUID): Client | Error => {
    const client = worldShard.getClient(clientUUID)
    if (!client) return new Error('No client found for connection')
    return client
  }

  const onAvatarChanged = (wallet: string): void => {
    const changedWallet = wallet.toLowerCase()
    const message: AvatarChangedMessage = {
      type: MessageType.avatarChanged,
      wallet,
      cacheKey: Date.now(),
    }
    if (
      Array.from(worldShard.getClients()).some((c) => {
        const w = typeof c.avatar === 'string' ? c.avatar : (c.avatar as any)?.owner
        return w?.toLowerCase() === changedWallet
      })
    ) {
      worldShard.broadcastFromServer(message)
    }
  }

  const onUserSuspended = (wallet: string): void => {
    const suspendedWallet = wallet.toLowerCase()
    let dropped = 0

    from(worldShard.getClients())
      .pipe(
        filter((c) => {
          const w = typeof c.avatar === 'string' ? c.avatar : (c.avatar as any)?.owner
          return w?.toLowerCase() === suspendedWallet
        }),
      )
      .forEach((client) => {
        client.drop(WSCloseCodes.tryAgainLater, 'connection forced drop via voxels.com')
        dropped++
      })

    console.log(`user with wallet ${wallet} suspended, number of clients dropped: ${dropped}`)
  }

  return {
    worldShard,
    handleConnection,
    shutdown: async () => {
      clearInterval(interval)
      await worldShard.shutdown()
    },
    dispose: async () => {
      await worldShard.dispose()
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
      parcel: number | null
    }
  | { type: 'leave'; uuid: string }

export type ShardOptions = {
  publish: (topic: string, message: ArrayBufferView, isBinary?: boolean) => void
  connection: ConnectionHandle
  jwtSecret: string
  onRadarEvent?: (e: RadarEvent) => void
}
