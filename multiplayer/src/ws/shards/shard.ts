import * as messages from '../../../../common/messages'
import { ClientUUID } from '../../common/clientUUID'
import { ConnectionHandle } from '../../common/pq'
import { WSCloseCodes } from '../../constants/socketCloseCodes'
import type { WsLike } from '../../createServer'
import { AbortError } from '../../utility/abortError'
import { toBuffer } from '../../utility/toBuffer'
import { BehaviourRelay } from '../behaviour-relay'
import { Client, ClientConnectionInformation } from '../client'

export type AddClientResult =
  | {
      kind: 'success'
      client: Client
    }
  | {
      kind: 'error'
      reason: 'loginFailureRateLimit' | 'shardClientLimitMet' | 'shardGlobalClientLimitMet' | 'shardDisposed'
    }

export const CLIENT_INACTIVE_TIMEOUT_MS = 60000 * 1
export const CONNECTION_INACTIVE_TIMEOUT_MS = 30000
const HEALTHY_UPDATE_HZ = 5
export const ALL_SHARD_CLIENT_MESSAGE_CHANNEL = 'all_shard_clients'

export class Shard {
  lastWorldStateUpdate = 0
  readonly connectedClients: Map<ClientUUID, Client> = new Map()
  readonly disposeAbortController = new AbortController()
  updateTimeout: NodeJS.Timeout
  readonly recentChat: messages.ChatMessage[] = []
  readonly behaviourRelay: BehaviourRelay = new BehaviourRelay(this)

  constructor(
    public readonly id: string,
    public readonly clientLimit: number | null,
    public readonly publish: (topic: string, message: ArrayBufferView, isBinary?: boolean) => void,
    public readonly connection: ConnectionHandle,
    public readonly jwtSecret: string,
    public readonly onRadarEvent?: (e: import('./shards').RadarEvent) => void,
  ) {
    const scheduleNextWorldStateBroadcast = (delayMs: number): NodeJS.Timeout =>
      setTimeout(() => {
        this.sendWorldState()
        const nextDelayMs = 1000 / HEALTHY_UPDATE_HZ
        this.updateTimeout = scheduleNextWorldStateBroadcast(nextDelayMs)
      }, delayMs)

    this.updateTimeout = scheduleNextWorldStateBroadcast(0)
  }

  async addClient(ws: WsLike<ClientConnectionInformation>, clientUUID: ClientUUID): Promise<AddClientResult> {
    if (this.clientLimit !== null && this.connectedClients.size >= this.clientLimit) {
      return { kind: 'error', reason: 'shardClientLimitMet' }
    }

    ws.subscribe(this.id)
    ws.subscribe(ALL_SHARD_CLIENT_MESSAGE_CHANNEL)

    const client = new Client(clientUUID, ws, this.connection, this.jwtSecret, this)
    this.connectedClients.set(clientUUID, client)
    this.sendClientJoinedMessage(client)

    return { kind: 'success', client }
  }

  broadcastFromClient(
    _message: messages.Message.ServerStateMessage,
    rawMessageData: Buffer,
    clientUUID: ClientUUID,
    toAllShards = false,
  ): void {
    const channel = toAllShards ? ALL_SHARD_CLIENT_MESSAGE_CHANNEL : this.id
    const sendingClient = this.connectedClients.get(clientUUID)
    if (!sendingClient) {
      console.warn('broadcastFromClient: client not found', { clientUUID })
      return
    }
    sendingClient.websocket.publish(channel, new Uint8Array(rawMessageData), true)
  }

  onClientLeave(client: Client) {
    const msg: messages.DestroyAvatarMessage = {
      type: messages.MessageType.destroyAvatar,
      uuid: client.clientUUID,
    }
    this.broadcastFromServer(msg)
    if (this.connectedClients.delete(client.clientUUID)) {
      client.dispose()
    }
  }

  broadcastFromServer(message: messages.Message.ServerStateMessage, targets?: ClientUUID[]) {
    const encodedMessage = toBuffer(messages.encode(message))
    if (targets) {
      targets.forEach((target) => {
        this.connectedClients.get(target)?.send(encodedMessage, message.type)
      })
    } else {
      this.publish(this.id, encodedMessage, true)
    }
  }

  sendWorldState() {
    const start = Date.now()
    const avatars: messages.UpdateAvatarMessage[] = []
    for (const client of this.connectedClients.values()) {
      if (!client.position) continue
      if (client.lastMoved < this.lastWorldStateUpdate) continue
      const avatar = client.updateAvatarMessage()
      if (!avatar) continue
      avatars.push(avatar)
    }

    if (avatars.length === 0) return

    const msg: messages.WorldStateMessage = {
      type: messages.MessageType.worldState,
      avatars: avatars,
    }

    this.broadcastFromServer(msg)

    this.lastWorldStateUpdate = start
  }

  sendClientJoinedMessage(client: Client) {
    const msg: messages.JoinMessage = {
      type: messages.MessageType.join,
      createAvatars: [],
      avatars: [],
    }
    try {
      for (const s of this.getClientList()) {
        if (!s.loggedIn) continue

        const ref = s.avatar
        const name = ref && typeof ref === 'object' ? (ref as any).name : undefined
        const wallet = typeof ref === 'string' ? ref : ref && typeof ref === 'object' ? (ref as any).owner : undefined

        msg.createAvatars.push({
          type: messages.MessageType.createAvatar,
          uuid: s.clientUUID,
          description: { name, wallet, costumeId: s.costumeId ?? undefined },
        })

        if (!s.position) continue

        msg.avatars.push({
          type: messages.MessageType.updateAvatar,
          animation: s.animation,
          orientation: s.orientation!,
          position: s.position,
          uuid: s.clientUUID,
          inConga: s.inConga,
          congaFollowsUuid: s.congaFollowsUuid,
        })
      }
    } catch (error) {
      if (client.disposed || error instanceof AbortError) return
      throw error
    }
    client.send(toBuffer(messages.JoinEncoder(msg)), msg.type)

    for (const m of this.recentChat) {
      client.send(toBuffer(messages.ChatEncoder(m)), m.type)
    }
  }

  removeClient(clientUUID: ClientUUID): void {
    this.connectedClients.delete(clientUUID)
  }

  shutdown() {
    this.connectedClients.forEach((client) => client.drop(WSCloseCodes.restarting, 'server restarting'))
  }

  dropInactiveClient(client: Client) {
    client.drop(1013, 'inactive')
  }

  dispose() {
    clearTimeout(this.updateTimeout)
    this.disposeAbortController.abort('ABORT: shard disposed')
  }

  scanForInactiveConnections() {
    const now = Date.now()
    for (const connectedClient of this.connectedClients.values()) {
      if (now - connectedClient.lastActive >= CONNECTION_INACTIVE_TIMEOUT_MS) {
        this.dropInactiveClient(connectedClient)
      }
    }
    this.behaviourRelay.evict()
  }

  getClientList() {
    return this.connectedClients.values()
  }

  getShardClientCount(): number {
    return this.connectedClients.size
  }

  getClient(clientUUID: ClientUUID): Client | undefined {
    return this.connectedClients.get(clientUUID)
  }

  getClients(): Iterable<Readonly<Client>> {
    return this.connectedClients.values()
  }

  get disposedSignal() {
    return this.disposeAbortController.signal
  }

  get disposed() {
    return this.disposedSignal.aborted
  }
}
