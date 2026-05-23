import { v7 as uuidv7 } from 'uuid'
import winston from 'winston'
import * as messages from '../../../../common/messages'
import { ClientUUID } from '../../common/clientUUID'
import { ConnectionHandle } from '../../common/pq'
import { WSCloseCodes } from '../../constants/socketCloseCodes'
import type { WsLike } from '../../createServer'
import { AbortError } from '../../utility/abortError'
import { toBuffer } from '../../utility/toBuffer'
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
const ALLOW_ANON_CHAT = process.env.ALLOW_ANON_CHAT === '1'
export const ALL_SHARD_CLIENT_MESSAGE_CHANNEL = 'all_shard_clients'

export class Shard {
  lastWorldStateUpdate = 0
  private readonly connectedClients: Map<ClientUUID, Client> = new Map()
  private readonly disposeAbortController = new AbortController()
  private updateTimeout: NodeJS.Timeout
  private readonly recentChat: messages.ChatMessage[] = []

  constructor(
    public readonly id: string,
    private readonly logger: winston.Logger,
    private readonly clientLimit: number | null,
    private readonly publish: (topic: string, message: ArrayBufferView, isBinary?: boolean) => void,
    private readonly connection: ConnectionHandle,
    private readonly jwtSecret: string,
    private readonly onRadarEvent?: (e: import('./shards').RadarEvent) => void,
  ) {
    // todo set up world state broadcast
    // todo config

    const scheduleNextWorldStateBroadcast = (delayMs: number): NodeJS.Timeout =>
      setTimeout(() => {
        this.sendWorldState()
        const nextDelayMs = 1000 / HEALTHY_UPDATE_HZ
        this.updateTimeout = scheduleNextWorldStateBroadcast(nextDelayMs)
      }, delayMs)

    this.updateTimeout = scheduleNextWorldStateBroadcast(0)
  }

  async addClient(ws: WsLike<ClientConnectionInformation>, clientUUID: ClientUUID): Promise<AddClientResult> {
    const wsConnectionInfo = ws.getUserData()

    if (this.clientLimit !== null && this.connectedClients.size >= this.clientLimit) {
      return {
        kind: 'error',
        reason: 'shardClientLimitMet',
      }
    }

    // subscribe to ME, so I can broadcast to all clients
    // more efficient using the uws pub/sub system than iterating over all clients
    ws.subscribe(this.id)
    // and subscribe to the special global channel
    ws.subscribe(ALL_SHARD_CLIENT_MESSAGE_CHANNEL)

    const client = new Client(clientUUID, ws, this.logger, this.connection, this.jwtSecret)

    this.registerClientEventHandlers(client)

    this.connectedClients.set(clientUUID, client)
    this.sendClientJoinedMessage(client)

    return { kind: 'success', client }
  }

  registerClientEventHandlers(client: Client) {
    const clientAbortController = new AbortController()
    client.events.once('leave', () => clientAbortController.abort('ABORT: client left'))
    client.events.once('leave', (e) => this.onClientLeave(e.client))
    client.events.on('login', (e) => this.successfulLogin())
    client.events.on('login_failed', (e) => this.failedLogin())
    client.events.on('parcel_change', (e) =>
      this.onRadarEvent?.({ type: 'move', uuid: e.client.clientUUID, avatar: e.client.avatar, parcel: e.parcel }),
    )
    client.events.once('leave', (e) => this.onRadarEvent?.({ type: 'leave', uuid: e.client.clientUUID }))
    client.events.on('broadcast_chat', (e) => this.handleChat(e.client, e.message, e.rawMessageData))
    client.events.on('backpressure', (e) => {
      // back pressure is bad, kill the client
      e.client.terminateSocketConnection()
    })
    client.events.on('message_dropped_queue_full', (e) => {
      e.client.terminateSocketConnection()
    })
    client.events.on('broadcast_create_avatar', (e) =>
      this.broadcastCreateAvatar(e.message, e.rawMessageData, e.client.clientUUID),
    )
    client.events.on('broadcast_message', (e) =>
      this.broadcastFromClient(e.message, e.rawMessageData, e.client.clientUUID),
    )
    client.events.on('inbound_message_ratelimited', ({ client }) => {
      client.terminateSocketConnection()
    })

    // not worried about removing handlers, they should be cleaned up in the dispose
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
      this.logger.warn('broadcastFromClient: client not found', { clientUUID })
      return
    }
    // Optimisation:
    // rather than iterating over all clients, we use the uws pub/sub system
    // to broadcast to all clients except the sending client
    // this is more efficient than iterating over all clients
    // but gives us less control over backpressure and visibility
    // Using server-side pub/sub replacement; exclude sender for parity with intent.
    sendingClient.websocket.publish(channel, new Uint8Array(rawMessageData), true)
  }

  broadcastCreateAvatar(message: messages.CreateAvatarMessage, rawMessageData: Buffer, clientUUID: ClientUUID): void {
    this.broadcastFromClient(message, rawMessageData, clientUUID)
  }

  handleChat(client: Client, message: messages.ChatMessage, _raw: Buffer) {
    if (!client.loggedIn && !ALLOW_ANON_CHAT) {
      this.logger.warn('Dropping chat message due to incorrect permissions', message)
      return
    }
    const stamped: messages.ChatMessage = { ...message, id: uuidv7(), avatar: client.avatar ?? undefined }
    const data = toBuffer(messages.ChatEncoder(stamped))
    this.recentChat.push(stamped)
    if (this.recentChat.length > 20) this.recentChat.shift()
    this.broadcastFromClient(stamped, data, client.clientUUID)
  }

  async successfulLogin() {
    // await this.loginRateLimiter.reset(ipAddr)
  }

  async failedLogin() {
    // if (!ipAddr || ipAddr === 'unknown') return // no point in rate limiting unknowns
    // // punish them
    // const rateLimitResult = await this.loginRateLimiter.tryConsume(ipAddr)
    // if (rateLimitResult !== true) {
    //   this.logger.info(
    //     `too many failed logins for ${ipAddr}, blocked for ${rateLimitResult.msBeforeNext / 1000} seconds`,
    //   )
    // }
  }

  private onClientLeave(client: Client) {
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

  private sendClientJoinedMessage(client: Client) {
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
    this.logger.info('shard shutting down')
    this.connectedClients.forEach((client) => client.drop(WSCloseCodes.restarting, 'server restarting'))
  }

  dropInactiveClient(client: Client) {
    client.drop(1013, 'inactive')
    this.logger.debug(`dropped inactive client`)
  }

  dispose() {
    clearTimeout(this.updateTimeout)
    this.disposeAbortController.abort('ABORT: shard disposed')
  }

  scanForInactiveConnections() {
    // this.logger.debug('checking for inactive connections')
    let inactiveCount = 0
    const now = Date.now()
    for (const connectedClient of this.connectedClients.values()) {
      if (now - connectedClient.lastActive >= CONNECTION_INACTIVE_TIMEOUT_MS) {
        this.dropInactiveClient(connectedClient)
        inactiveCount++
      }
    }
    // this.logger.debug('finished checking for inactive connections', { inactiveCount })
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
