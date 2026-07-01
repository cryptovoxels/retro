import { ExponentialBackoff, handleAll, retry } from 'cockatiel'
import he from 'he'
import { jwtVerify } from 'jose'
import { v7 as uuidv7 } from 'uuid'
import * as messages from '../../../common/messages'
import type { AvatarRef, AvatarRefObj } from '../../../common/messages/avatar-ref'
import { ClientUUID } from '../common/clientUUID'
import { ConnectionHandle } from '../common/pq'
import { ShardId } from '../common/shardId'
import { WSCloseCode } from '../constants/socketCloseCodes'
import type { WsLike } from '../createServer'
import type { Shard } from './shards/shard'
import { toBuffer } from '../utility/toBuffer'
import { md5 } from '../../../common/helpers/utils'

const retryPolicy = retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff() })

const isVec3 = (v: any) => Array.isArray(v) && v.length === 3 && v.every((x: any) => typeof x === 'number')

export type ClientConnectionInformation = {
  url: string
  clientUUID: ClientUUID
  shardID: ShardId
}

const MAX_CHAT_MESSAGE_LENGTH = 1024
const MAX_RECENT_CHAT = 1000

export class Client {
  private _disposeAbortController = new AbortController()
  private readonly _connectedAt: number
  private _lastActive: number

  // flat state - no FSM
  loggedIn = false
  avatar: AvatarRef | null = null
  costumeId: number | null = null
  position: [number, number, number] | null = null
  orientation: [number, number, number, number] | null = null
  animation = 0
  lastMoved = 0
  inConga = false
  congaFollowsUuid: string | null = null

  lastSeenParcel: number | null = null
  private _lastChatMsg: string | null = null
  private _lastChatMsgTime = 0

  constructor(
    public readonly clientUUID: ClientUUID,
    public readonly websocket: WsLike<ClientConnectionInformation>,
    private readonly connection: ConnectionHandle,
    private readonly jwtSecret: string,
    public readonly shard: Shard,
  ) {
    this._connectedAt = Date.now()
    this._lastActive = this._connectedAt
  }

  get backpressure(): number {
    return this.websocket.getBufferedAmount()
  }

  send(message: Buffer, _type: messages.MessageType) {
    try {
      this.websocket.send(message, true)
    } catch (err) {
      console.error('Error sending message', this.whois(), err)
    }
  }

  drop(dropCode: WSCloseCode, message?: string): void {
    this.websocket.end(dropCode, message)
  }

  private leave() {
    this.shard.onClientLeave(this)
    this.shard.onRadarEvent?.({ type: 'leave', uuid: this.clientUUID })
  }

  onClose() {
    this.leave()
  }

  private onError(err: Error) {
    console.error(`socket error: ${err}`, this.whois())
    this.leave()
  }

  updateAvatarMessage(): messages.UpdateAvatarMessage | null {
    if (!this.position) return null
    return {
      type: messages.MessageType.updateAvatar,
      uuid: this.clientUUID,
      animation: this.animation,
      orientation: this.orientation!,
      position: this.position,
      inConga: this.inConga,
      congaFollowsUuid: this.congaFollowsUuid,
    }
  }

  onMessageDropped(_message: ArrayBuffer, _isBinary: boolean) {}

  async onMessage(message: ArrayBuffer, isBinary: boolean) {
    if (!isBinary) {
      console.error('non-binary message received', this.whois())
      return this.drop(1003, 'non-binary message')
    }
    try {
      this.processMessage(toBuffer(message))
    } catch (err) {
      console.error(`error processing message ${err}\n\n${message}`, this.whois())
      return this.drop(1003, 'error on processing message')
    }
    this._lastActive = Date.now()
  }

  processMessage(message: Buffer) {
    let decodeResult: messages.DecodeResult
    try {
      decodeResult = messages.decode(message)
    } catch (e) {
      console.error('Unable to decode message for unknown reason, needs triage', e)
      return
    }

    if (decodeResult.type === 'error') return

    const msgUnchecked = decodeResult.message
    if (!msgUnchecked.type) {
      console.warn('no message type found', this.whois())
      return
    }

    const typeName = messages.MessageType[msgUnchecked.type]
    if (!typeName) {
      console.warn('received nonsensical message', { ...this.whois(), msg: typeName })
      return
    }

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
          this.shard.broadcastFromClient(msg, message, this.clientUUID)
        }
        break
      case messages.MessageType.point:
      case messages.MessageType.typing:
      case messages.MessageType.voiceStateAvatar:
        if (msg.uuid === this.clientUUID) {
          this.shard.broadcastFromClient(msg, message, this.clientUUID)
        }
        break
      case messages.MessageType.newCostume:
        if (msg.uuid === this.clientUUID) {
          this.costumeId = msg.costumeId ?? null
          this.shard.broadcastFromClient(msg, message, this.clientUUID)
        }
        break
      case messages.MessageType.chat:
        this.handleChat(msg)
        break
      case messages.MessageType.metric:
        this.handleMetric(msg)
        break
      case messages.MessageType.behaviourState:
        this.shard.behaviourRelay.handleState(this, msg, message)
        break
      case messages.MessageType.behaviourSignal:
        this.shard.behaviourRelay.handleSignal(this, msg, message)
        break
      default:
        console.error(`unknown message type ${(msg as any).type}`, this.whois())
        break
    }
  }

  private handleChat(msg: messages.ChatMessage): void {
    const now = Date.now()
    if (msg.text.length > MAX_CHAT_MESSAGE_LENGTH) {
      console.warn('dropping chat message over max length', this.whois())
      return
    }
    if (!msg.text.trim()) {
      console.warn('dropping empty chat message', this.whois())
      return
    }
    this._lastChatMsg = msg.text
    this._lastChatMsgTime = now
    const stamped: messages.ChatMessage = { ...msg, id: uuidv7(), avatar: this.avatar ?? undefined }
    const data = toBuffer(messages.ChatEncoder(stamped))
    this.shard.recentChat.push(stamped)
    if (this.shard.recentChat.length > MAX_RECENT_CHAT) this.shard.recentChat.shift()
    this.shard.broadcastFromClient(stamped, data, this.clientUUID)
  }

  private handlePing(): void {
    const msg: messages.PongMessage = { type: messages.MessageType.pong }
    this.send(toBuffer(messages.PongEncoder(msg)), msg.type)
  }

  private handleUpdateAvatar(msg: messages.UpdateAvatarMessage): void {
    this.position = msg.position as [number, number, number]
    this.orientation = msg.orientation as [number, number, number, number]
    this.animation = msg.animation
    this.lastMoved = Date.now()
    this.inConga = !!msg.inConga
    this.congaFollowsUuid = msg.congaFollowsUuid ?? null
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

    const wallet = decoded?.wallet
    if (!wallet) {
      this.failedLogin("Bad JWT, it's empty")
      return
    }

    const ts = Date.now()
    let result
    try {
      result = await retryPolicy.execute(() =>
        this.connection.query('embedded/get-avatar', `SELECT * FROM avatars WHERE lower(owner)=lower($1) LIMIT 1;`, [
          wallet,
        ]),
      )
    } catch (err) {
      console.error(`wallet query error (${(Date.now() - ts) / 1000}sec): ${err}`, this.whois())
      result = null
    }

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
      console.error(`banned_users query error (${(Date.now() - ts) / 1000}sec): ${err}`, this.whois())
    }

    const isBanned = banResult && banResult.rows.length > 0
    const row = result?.rows?.[0]

    if (!row || isBanned) {
      this.avatar = wallet as string
      this.costumeId = null
    } else {
      this.avatar = { id: row.id, name: row.name, owner: wallet, created_at: row.created_at } as AvatarRefObj
      this.costumeId = row.costume_id ?? null
    }

    this.loggedIn = true
    this.onLoginComplete()
  }

  private handleAnon(_msg: messages.AnonMessage): void {
    this.loggedIn = true
    this.avatar = null
    this.costumeId = null
    this.onLoginComplete()
  }

  private failedLogin(msg: string) {
    console.error(`failed login: ${msg}`, this.whois())
    this.drop(1008, 'failed login')
  }

  private onLoginComplete(): void {
    const wallet =
      typeof this.avatar === 'string' ? this.avatar : ((this.avatar as AvatarRefObj | null)?.owner ?? undefined)
    const name = typeof this.avatar === 'object' && this.avatar ? (this.avatar as AvatarRefObj).name : undefined

    const loginComplete: messages.LoginCompleteMessage = {
      type: messages.MessageType.loginComplete,
      user: { name: name ?? undefined, wallet: wallet ?? undefined },
    }
    this.send(toBuffer(messages.LoginCompleteEncoder(loginComplete)), loginComplete.type)

    const createAvatar: messages.CreateAvatarMessage = {
      type: messages.MessageType.createAvatar,
      uuid: this.clientUUID,
      description: {
        name: name ?? undefined,
        wallet: wallet ?? undefined,
        costumeId: this.costumeId ?? undefined,
      },
    }
    this.shard.broadcastFromClient(createAvatar, toBuffer(messages.CreateAvatarEncoder(createAvatar)), this.clientUUID)
  }

  get day() {
    return new Date().getUTCDay() % 7
  }

  private anonymizedClientId(): number {
    return parseInt(md5(this.clientUUID), 16) % 0xffffff
  }

  private handleMetric(msg: messages.MetricMessage): void {
    const parcelId = msg.parcel
    if (parcelId != null && this.lastSeenParcel !== parcelId) {
      this.lastSeenParcel = parcelId
      this.shard.onRadarEvent?.({ type: 'move', uuid: this.clientUUID, avatar: this.avatar, parcel: parcelId })
      this.shard.behaviourRelay.sendSnapshot(this, parcelId)
    }
    const anonId = this.anonymizedClientId()
    const position = msg.position
    if (!isVec3(position)) return
    const i = this.day
    const table = `day_${i.toString().padStart(2, '0')}`
    this.connection.query(
      'embedded/insert-metric',
      `INSERT INTO metrics.${table} (client_id, action, parcel, position) VALUES ($1, $2, $3, cube($4::float8[]))`,
      [anonId, msg.action, parcelId, position],
    )
  }

  drained() {}

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

  get lastActive(): number {
    return this._lastActive
  }

  private whois(): Record<string, string> {
    const whois: Record<string, string> = { uuid: this.clientUUID }
    const wallet = typeof this.avatar === 'string' ? this.avatar : (this.avatar as AvatarRefObj | null)?.owner
    if (wallet) whois['wallet'] = wallet
    return whois
  }

  terminateSocketConnection() {
    this.websocket.close()
  }
}
