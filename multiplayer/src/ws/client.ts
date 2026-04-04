import { ExponentialBackoff, handleAll, retry } from 'cockatiel'
import he from 'he'
import { jwtVerify } from 'jose'
import winston from 'winston'
import * as messages from '../../../common/messages'
import { AvatarState, AvatarStateType } from '../common/avatarState'
import { ClientState } from '../common/clientState'
import { ClientUUID } from '../common/clientUUID'
import { ConnectionHandle } from '../common/pq'
import { ShardId } from '../common/shardId'
import { WSCloseCode } from '../constants/socketCloseCodes'
import type { WsLike } from '../createServer'
import { createEventEmitter, EventEmitter, ReadonlyEventEmitter } from '../utility/eventEmitter'
import { toBuffer } from '../utility/toBuffer'
import { md5 } from '../../../common/helpers/utils'

const retryPolicy = retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff() })

const isVec3 = (v: any) => Array.isArray(v) && v.length === 3 && v.every((x: any) => typeof x === 'number')

export type ClientConnectionInformation = {
  url: string
  // these are inferred from the url and ip during the upgrade event
  // no websocket should exist without these fields
  clientUUID: ClientUUID
  shardID: ShardId
  // can add more fields here as needed pulled from the upgrade connection headers
}
export type ClientEventEmitterMap = {
  leave: { client: Client }
  broadcast_message: { message: messages.Message.ServerStateMessage; rawMessageData: Buffer; client: Client }
  broadcast_create_avatar: { message: messages.CreateAvatarMessage; rawMessageData: Buffer; client: Client }
  broadcast_chat: { message: messages.ChatMessage; rawMessageData: Buffer; client: Client }
  messageTx: { status: 'ok' | 'error'; message: Buffer; type: string | undefined; durationMs: number }
  messageRx: { status: 'ok' | 'error'; message: any; type: string | undefined }
  login: {}
  login_failed: {}
  state_updated: { client: Client }
  backpressure: { client: Client; amount: number }
  message_dropped_queue_full: { client: Client; message: messages.MessageType }
  message_dropped_queue_full_timeout: { client: Client; message: messages.MessageType; durationMs: number }
  message_dropped: { client: Client }
  inbound_message_ratelimited: { client: Client }
}

export type ClientEventEmitter = EventEmitter<ClientEventEmitterMap>

const MAX_CHAT_MESSAGE_LENGTH = 256 // this isn't a blog post, keep it short
const CHAT_MESSAGE_RATE_LIMIT_MS = 100 // 10 messages per second should be enough for anyone
const CHAT_MESSAGE_DEDUPE_TIME_MS = 10_000 // you must wait 10 seconds before repeating yourself, anything less is rude

export class Client {
  private _disposeAbortController = new AbortController()

  private readonly _connectedAt: number
  private _lastActive: number
  avatarState: AvatarState = { type: AvatarStateType.beforeLogin, payload: {} }
  lastSeenParcel: number | null = null
  private _lastChatMsg: string | null = null
  private _lastChatMsgTime = 0

  private readonly _emitter: ClientEventEmitter

  get events(): ReadonlyEventEmitter<ClientEventEmitter> {
    return this._emitter
  }

  get identity(): ClientState['identity'] {
    if (
      this.avatarState.type === AvatarStateType.afterLogin ||
      this.avatarState.type === AvatarStateType.afterFirstUpdate
    ) {
      return this.avatarState.payload.identity as any
    }

    return { name: 'anon' }
  }

  constructor(
    public readonly clientUUID: ClientUUID,
    public readonly websocket: WsLike<ClientConnectionInformation>,
    private readonly logger: winston.Logger,
    private readonly connection: ConnectionHandle,
    private readonly jwtSecret: string,
  ) {
    this._connectedAt = Date.now()
    this._lastActive = this._connectedAt
    this._emitter = createEventEmitter(logger.error.bind(logger), this._disposeAbortController.signal)
  }

  get state(): ClientState {
    let avatar: ClientState['avatar'] = null
    if (this.avatarState.type === AvatarStateType.afterFirstUpdate) {
      avatar = {
        animation: this.avatarState.payload.animation,
        position: this.avatarState.payload.position,
        orientation: this.avatarState.payload.orientation,
        lastMoved: this.avatarState.payload.lastMoved,
      }
    }

    return {
      lastSeen: this.lastSeenParcel,
      identity: this.identity,
      avatar,
      clientUUID: this.clientUUID,
      lastActive: this._lastActive,
    }
  }

  /** Returns the bytes buffered in backpressure. */
  get backpressure(): number {
    return this.websocket.getBufferedAmount()
  }

  send(message: Buffer, type: messages.MessageType) {
    const startTime = performance.now()
    try {
      this.websocket.send(message, true)
    } catch (err) {
      this.logger.error('Error sending message', this.whois(), err)
      return
    }

    const durationMs = performance.now() - startTime

    // `ws` doesn't provide a "send result" (buffered/sent/dropped), so we log optimistic success
    // and treat backpressure via bufferedAmount thresholds elsewhere.
    this._emitter.emit('messageTx', {
      status: 'ok',
      message,
      type: messages.MessageType[type],
      durationMs,
    })
  }

  drop(dropCode: WSCloseCode, message?: string): void {
    this.logger.debug('Dropping client', this.clientUUID, dropCode, message)
    this.websocket.end(dropCode, message)
  }

  onClose() {
    this.logger.debug('client closed', this.whois())
    this.leave()
  }

  private onError(err: Error) {
    this.logger.error(`socket error: ${err}`, this.whois())
    this.leave()
  }

  private leave() {
    this._emitter.emit('leave', { client: this })
  }

  updateAvatarMessage(): messages.UpdateAvatarMessage | null {
    if (this.avatarState.type === AvatarStateType.afterFirstUpdate) {
      return {
        type: messages.MessageType.updateAvatar,
        uuid: this.clientUUID,
        animation: this.avatarState.payload.animation,
        orientation: this.avatarState.payload.orientation,
        position: this.avatarState.payload.position,
      }
    }

    return null
  }

  onMessageDropped(_message: ArrayBuffer, _isBinary: boolean) {
    // could parse and log the message type here
    this._emitter.emit('message_dropped', { client: this })
  }

  async onMessage(message: ArrayBuffer, isBinary: boolean) {
    if (!isBinary) {
      this.logger.error('non-binary message received', this.whois())
      return this.drop(1003, 'non-binary message')
    }

    try {
      this.processMessage(toBuffer(message))
    } catch (err) {
      this.logger.error(`error processing message ${err}\n\n${message}`, this.whois())
      return this.drop(1003, 'error on processing message')
    }
    this._lastActive = Date.now()
    this.emitStateUpdated()
  }

  emitStateUpdated(): void {
    this._emitter.emit('state_updated', { client: this })
  }

  processMessage(message: Buffer) {
    let decodeResult: messages.DecodeResult
    try {
      decodeResult = messages.decode(message)
    } catch (e) {
      this.logger.error('Unable to decode message for unknown reason, needs triage', e)
      this._emitter.emit('messageRx', { status: 'error', message, type: 'unknown' })
      return
    }

    if (decodeResult.type === 'error') {
      switch (decodeResult.errorType) {
        case 'invalidDataType':
          this._emitter.emit('messageRx', { status: 'error', message, type: 'not_buffer' })
          return
        case 'invalidDataLength':
          // The client probably disconnected while sending
          this._emitter.emit('messageRx', { status: 'error', message, type: 'invalid_length' })
          return
      }
    }

    const msgUnchecked = decodeResult.message
    const whois = this.whois()
    // this.logger.debug(`received ${messages.MessageType[msgUnchecked.type]} message ${message.byteLength}b`, whois)

    if (!msgUnchecked.type) {
      this._emitter.emit('messageRx', { status: 'error', message, type: 'no_type' })
      this.logger.warn('no message type found', whois)
      return
    }

    const typeName = messages.MessageType[msgUnchecked.type]
    if (!typeName) {
      this.logger.warn('received nonsensical message', { ...whois, msg: typeName })
      return
    }

    this._emitter.emit('messageRx', { status: 'ok', message, type: typeName })

    const msg = msgUnchecked as messages.Message.ClientNegotiationMessage | messages.Message.ClientStateMessage
    switch (msg.type) {
      case messages.MessageType.login:
        this.handleLogin(msg).then(/* NO-OP */)
        break

      case messages.MessageType.ping:
        this.handlePing()
        break

      case messages.MessageType.updateAvatar:
        this.handleUpdateAvatar(msg)
        break

      case messages.MessageType.anon:
        this.handleAnon(msg)
        break

      case messages.MessageType.emoteAvatar:
        if (messages.Emotes.includes(he.decode(msg.emote))) {
          this._emitter.emit('broadcast_message', { message: msg, rawMessageData: message, client: this })
        }
        break
      case messages.MessageType.point:
      case messages.MessageType.newCostume:
      case messages.MessageType.typing:
      case messages.MessageType.voiceStateAvatar:
        if (msg.uuid === this.clientUUID) {
          this._emitter.emit('broadcast_message', { message: msg, rawMessageData: message, client: this })
        }
        break
      case messages.MessageType.chat:
        this.handleChat(msg, message)
        break
      case messages.MessageType.metric:
        this.handleMetric(msg)
        break

      case messages.MessageType.createAvatar:
        // Deprecated
        break

      default:
        this.logger.error(`unknown message type ${(msg as any).type}`, this.whois())
        break
    }
  }

  private handleChat(msg: messages.ChatMessage, data: Buffer): void {
    const now = Date.now()
    if (this._lastChatMsgTime + CHAT_MESSAGE_RATE_LIMIT_MS > now) {
      this.logger.warn('dropping chat message due to rate limit', this.whois())
      return
    }
    if (msg.text.length > MAX_CHAT_MESSAGE_LENGTH) {
      this.logger.warn('dropping chat message over max length', this.whois())
      return
    }

    if (!msg.text.trim()) {
      this.logger.warn('dropping empty chat message', this.whois())
      return
    }

    // dedupe
    if (this._lastChatMsgTime + CHAT_MESSAGE_DEDUPE_TIME_MS > now && this._lastChatMsg === msg.text) {
      this.logger.warn('dropping duplicate chat message', this.whois())
      return
    }

    this._lastChatMsg = msg.text
    this._lastChatMsgTime = now

    this._emitter.emit('broadcast_chat', { message: msg, rawMessageData: data, client: this })
  }

  private handlePing(): void {
    const msg: messages.PongMessage = { type: messages.MessageType.pong }
    this.send(toBuffer(messages.PongEncoder(msg)), msg.type)
  }

  private handleUpdateAvatar(msg: messages.UpdateAvatarMessage): void {
    // if (
    //   this.avatarState.type !== AvatarStateType.afterLogin &&
    //   this.avatarState.type !== AvatarStateType.afterFirstUpdate
    // ) {
    //   this.logger.error("can't set positional attributes on non existing avatar model", this.whois())
    //   return
    // }
    // Preserve existing identity if available, otherwise default to anonymous
    const identity =
      this.avatarState.type === AvatarStateType.afterLogin || this.avatarState.type === AvatarStateType.afterFirstUpdate
        ? this.avatarState.payload.identity
        : { name: 'anon' }

    this.avatarState = {
      type: AvatarStateType.afterFirstUpdate,
      payload: {
        identity,
        position: msg.position as [number, number, number],
        orientation: msg.orientation,
        animation: msg.animation,
        lastMoved: Date.now(),
      },
    }
  }

  private async handleLogin(message: messages.LoginMessage): Promise<void> {
    let decoded = null
    try {
      const result = await jwtVerify(message.token, new TextEncoder().encode(this.jwtSecret), { algorithms: ['HS256'] })
      decoded = result.payload as any
    } catch (err: any) {
      this.failedLogin(`Bad JWT: '${err.toString()}'`)
      return
    }

    // @ts-ignore
    const wallet = decoded?.wallet

    if (!wallet) {
      this.failedLogin("Bad JWT, it's empty")
      return
    }

    this._emitter.emit('login', {})

    let result

    const ts = Date.now()
    try {
      result = await retryPolicy.execute(() =>
        this.connection.query('embedded/get-avatar', `SELECT * FROM avatars WHERE lower(owner)=lower($1) LIMIT 1;`, [
          wallet,
        ]),
      )
    } catch (err) {
      this.logger.error(`wallet query error (${(Date.now() - ts) / 1000}sec): ${err}`, this.whois())
      result = null
    }

    // treat banned users as anonymous
    let banResult = null
    try {
      banResult = await retryPolicy.execute(() =>
        this.connection.query(
          'embedded/get-banned-user',
          `select * from banned_users where lower(wallet)=lower($1) and expires_at>now() limit 1;`,
          [wallet],
        ),
      )
    } catch (err) {
      this.logger.error(
        `banned_users query error, setting name as anon for others (${(Date.now() - ts) / 1000}sec): ${err}`,
        this.whois(),
      )
    }

    if (!result || result.rows.length === 0 || banResult === null || banResult.rows.length > 0) {
      // It's ok if name is null, the client side will first try and replace it with the 10 first digit of the wallet and if not will use 'anonymous'.
      // This is useful for segregating users from anonymous users in the explorer for example. Makes finding people easy.
      // And you can't Teleport to an anon user (not a bug).

      this.avatarState = {
        type: AvatarStateType.afterLogin,
        payload: {
          identity: { name: 'anon' },
        },
      }
    } else {
      const row = result.rows[0]

      this.avatarState = {
        type: AvatarStateType.afterLogin,
        payload: {
          identity: {
            name: row.name,
            wallet,
          },
        },
      }
    }
    this.onLoginComplete(this.avatarState)
  }

  private handleAnon(anonMsg: messages.AnonMessage): void {
    this.avatarState = {
      type: AvatarStateType.afterLogin,
      payload: {
        identity: { name: 'anon' },
      },
    }

    this.onLoginComplete(this.avatarState)
  }

  private failedLogin(msg: string) {
    this.logger.error(`failed login: ${msg}`, this.whois())
    this.drop(1008, 'failed login')
    this._emitter.emit('login_failed', {})
  }

  private onLoginComplete(avatarState: AvatarState.AfterLogin): void {
    const loginCompleteMessage = avatarStateToLoginCompleteMessage(avatarState)
    this.send(toBuffer(messages.LoginCompleteEncoder(loginCompleteMessage)), loginCompleteMessage.type)
    this.emitStateUpdated()
    const createAvatarMessage = avatarStateToCreateMessage(this.clientUUID, avatarState)
    this._emitter.emit('broadcast_create_avatar', {
      client: this,
      message: createAvatarMessage,
      rawMessageData: toBuffer(messages.CreateAvatarEncoder(createAvatarMessage)),
    })
  }

  // Returns the day in GMT+0
  get day() {
    return new Date().getUTCDay() % 7
  }

  // todo - replace with something that isn't md5
  private anonymizedClientId(): number {
    return parseInt(md5(this.clientUUID), 16) % 0xffffff
  }

  private handleMetric(msg: messages.MetricMessage): void {
    // Set the lastseenparcel
    const parcelId = msg.parcel
    Object.assign(this, { lastSeenParcel: parcelId })

    // Anonymize client ID
    const anonId = this.anonymizedClientId()

    // Get position
    const position = msg.position

    if (!isVec3(position)) {
      // Drop
      return
    }

    // Rotate values into the metrics table
    const i = this.day
    const table = `day_${i.toString().padStart(2, '0')}`

    this.connection.query(
      'embedded/insert-metric',
      `INSERT INTO 
        metrics.${table} (client_id, action, parcel, position) 
      VALUES 
        ($1, $2, $3, cube($4::float8[]))`,
      [anonId, msg.action, parcelId, position],
    )
  }

  drained() {
    // todo update/manage backpressure etc
  }

  dispose() {
    this._disposeAbortController.abort('ABORT:client disposed')
  }

  get disposed() {
    return this._disposeAbortController.signal.aborted
  }

  get disposedSignal() {
    return this._disposeAbortController.signal
  }

  get ageInSec(): number {
    return (Date.now() - this._connectedAt) / 1000
  }

  /** Time of last message received */
  get lastActive(): number {
    return this._lastActive
  }

  private whois(): Record<string, string> {
    const whois: Record<string, string> = { uuid: this.clientUUID }
    if (this.identity?.wallet) {
      whois['wallet'] = this.identity.wallet
    }
    return whois
  }

  /** Forcibly close the connection. */
  terminateSocketConnection() {
    this.websocket.close()
  }
}

function avatarStateToCreateMessage(
  clientUUID: ClientUUID,
  avatarState: AvatarState.AfterLogin | AvatarState.AfterFirstUpdate,
): messages.CreateAvatarMessage {
  const description: messages.CreateAvatarMessage['description'] = {}

  if (avatarState.payload.identity) {
    description.name = avatarState.payload.identity.name
    description.wallet = avatarState.payload.identity.wallet
  }

  return {
    type: messages.MessageType.createAvatar,
    uuid: clientUUID,
    description,
  }
}

function avatarStateToLoginCompleteMessage(avatarState: AvatarState.AfterLogin): messages.LoginCompleteMessage {
  return {
    type: messages.MessageType.loginComplete,
    user: {
      name: avatarState.payload.identity.name,
      wallet: avatarState.payload.identity.wallet,
    },
  }
}
