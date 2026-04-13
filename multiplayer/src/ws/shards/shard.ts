import winston from 'winston'
import * as messages from '../../../../common/messages'
import { AvatarStateType } from '../../common/avatarState'
import { ChatStore } from '../../common/chatStore'
import { ClientState } from '../../common/clientState'
import { ClientStateStore } from '../../common/clientStateStore'
import { ClientUUID } from '../../common/clientUUID'
import { ConnectionHandle } from '../../common/pq'
import { WSCloseCodes } from '../../constants/socketCloseCodes'
import type { WsLike } from '../../createServer'
import { AbortError } from '../../utility/abortError'
import { toBuffer } from '../../utility/toBuffer'
import { Client, ClientConnectionInformation } from '../client'
import { ShardMetrics } from './shardMetrics'

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

  constructor(
    public readonly id: string,
    private readonly logger: winston.Logger,
    private readonly clientLimit: number | null,
    private readonly publish: (topic: string, message: ArrayBufferView, isBinary?: boolean) => void,
    private readonly stateStore: ClientStateStore,
    private readonly connection: ConnectionHandle,
    private readonly chatStore: ChatStore,
    public readonly metrics: ShardMetrics,
    private readonly jwtSecret: string,
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

    this.stateStore.store(client.state)

    this.sendClientJoinedMessage(client)

    return { kind: 'success', client }
  }

  registerClientEventHandlers(client: Client) {
    const clientAbortController = new AbortController()
    client.events.once('leave', () => clientAbortController.abort('ABORT: client left'))
    client.events.once('leave', (e) => this.onClientLeave(e.client))
    client.events.on('login', (e) => this.successfulLogin())
    client.events.on('login_failed', (e) => this.failedLogin())
    client.events.on('messageRx', (e) => this.messageRX(e.status, e.message, e.type))
    client.events.on('messageTx', (e) => this.messageTX(e.status, e.message as any, e.type, e.durationMs))
    client.events.on('broadcast_chat', (e) => this.handleChat(e.client, e.message, e.rawMessageData))
    client.events.on('backpressure', (e) => {
      // back pressure is bad, kill the client
      e.client.terminateSocketConnection()
    })
    client.events.on('message_dropped_queue_full', (e) => {
      // queue full indicates stress, will start dropping all messages..
      this.outboundMessageDropped(messages.MessageType[e.message])
    })
    client.events.on('message_dropped_queue_full', (e) => {
      // if the queue has been full for a while, KILL them
      e.client.terminateSocketConnection()
    })
    client.events.on('message_dropped', (e) => {
      // dropping lower priority messages, penalise client for this
      this.outboundMessageDropped(undefined) //messages.MessageType[e.message])
    })
    client.events.on('broadcast_create_avatar', (e) =>
      this.broadcastCreateAvatar(e.message, e.rawMessageData, e.client.clientUUID),
    )
    client.events.on('broadcast_message', (e) =>
      this.broadcastFromClient(e.message, e.rawMessageData, e.client.clientUUID),
    )
    client.events.on('inbound_message_ratelimited', ({ client }) => {
      // todo
      // if (this.featureFlags.penalizeClientsForRateLimitViolations) {
      //   // shouldn't be able to hit limits without being malicious
      //   // dump them
      //   client.terminateSocketConnection()
      // }

      this.metrics.logClientMsgRatelimited()
    })

    client.events.on('state_updated', () => {
      try {
        this.stateStore.store(client.state)
      } catch (error) {
        this.logger.error('Error storing state', error)
      }
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

  async handleChat(client: Client, message: messages.ChatMessage, rawMessageData: Buffer) {
    // if anon chat is enabled, it is limited to local only
    const shouldBroadcastMessage = !!client.identity || (ALLOW_ANON_CHAT && message.channel === 'local')

    if (!shouldBroadcastMessage) {
      // drop the message
      this.logger.warn('Dropping chat message due to incorrect permissions', message)
      return
    }

    const [moderatedMsg, moderatedData] = await this.getModeratedChatMessage(client, message, rawMessageData)
    // global channel, is global to all shards
    const toAllShards = message.channel === 'global'
    if (message.channel === 'global') this.chatStore.store(moderatedMsg)

    this.broadcastFromClient(moderatedMsg, moderatedData, client.clientUUID, toAllShards)
  }

  private async getModeratedChatMessage(
    client: Client,
    msg: messages.ChatMessage,
    data: Buffer,
  ): Promise<[msg: messages.ChatMessage, data: Buffer]> {
    // moderate anons and all global messages
    // if ((client.state.identity === null || msg.channel === 'global') && this.chatModerator) {
    //   return await this.chatModerator.moderateMessage(msg, data)
    // }

    return [msg, data]
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

  private async onClientLeave(client: Client) {
    const msg: messages.DestroyAvatarMessage = {
      type: messages.MessageType.destroyAvatar,
      uuid: client.clientUUID,
    }

    client.avatarState = {
      type: AvatarStateType.afterLeave,
      payload: {
        uuid: client.clientUUID,
      },
    }

    this.broadcastFromServer(msg)
    this.stateStore.delete(client.clientUUID)
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
    this.metrics.logWorldStateBroadcastStarted()
    const start = Date.now()
    // keep track of which clients that has moved since last time we sent out an update
    const avatars: messages.UpdateAvatarMessage[] = []
    for (const client of this.connectedClients.values()) {
      if (client.avatarState.type !== AvatarStateType.afterFirstUpdate) continue

      if (client.avatarState.payload.lastMoved < this.lastWorldStateUpdate) continue

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
      for (const clientState of this.getClientsStateIterator()) {
        if (clientState.identity === null) continue

        const createAvatarMessage: messages.CreateAvatarMessage = {
          type: messages.MessageType.createAvatar,
          uuid: clientState.clientUUID,
          description: {
            name: clientState.identity?.name,
            wallet: clientState.identity?.wallet,
          },
        }

        msg.createAvatars.push(createAvatarMessage)

        if (clientState.avatar === null) continue

        const updateAvatarMessage: messages.UpdateAvatarMessage = {
          type: messages.MessageType.updateAvatar,
          animation: clientState.avatar.animation,
          orientation: clientState.avatar.orientation,
          position: clientState.avatar.position,
          uuid: clientState.clientUUID,
          inConga: clientState.avatar.inConga,
        }
        msg.avatars.push(updateAvatarMessage)
      }
    } catch (error) {
      if (client.disposed || error instanceof AbortError) return // disposed indicates message was aborted, don't care
      throw error
    }
    client.send(toBuffer(messages.JoinEncoder(msg)), msg.type)
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
    this.metrics.logInactiveClient()
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

  getClientsStateIterator(): Iterable<ClientState> {
    return this.stateStore.getIterator()
  }

  getShardClientCount(): number {
    return this.stateStore.count()
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

  messageRX(status: 'ok' | 'error', msg: any, type: string | undefined) {
    this.metrics.logMessageReceived({ type, status, length: msg.length || msg.byteLength || 0 })
  }

  messageTX(status: 'ok' | 'error', msg: Uint8Array, type: string | undefined, durationMs: number) {
    this.metrics.logMessageTransferred({
      type,
      status,
      length: msg.length || msg.byteLength || 0,
      durationMs,
    })
  }

  outboundMessageDropped(type: string | undefined) {
    this.metrics.logOutboundMessageDropped({ type })
  }
}
