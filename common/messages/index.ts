import { decode as decodeAlias, DecodeError, Decoder, encode as encodeAlias, Encoder, ExtensionCodec } from '@msgpack/msgpack'
import { parse, stringify } from 'uuid'
import { compressQuaternion, decompressQuaternion, Quaternion } from './utils'

export { Emotes } from './constant'

const extensionCodec = new ExtensionCodec()

const msgPacker = new Encoder(extensionCodec, null, 100, 1024, false, false, true)
const msgUnpacker = new Decoder(extensionCodec)

export enum MessageType {
  ping = 1,
  pong = 2,
  login = 40,
  traffic = 41,
  anon = 42,
  loginComplete = 43,
  chat = 48,
  metric = 49,

  // Parts of the users avatar
  createAvatar = 50,
  destroyAvatar = 53,
  updateAvatar = 54,
  worldState = 55,
  join = 56,
  avatarChanged = 57, // user has updated their avatar's name or costume, triggered via RPC

  // Avatar interactions
  emoteAvatar = 60,

  newCostume = 62,
  typing = 63,
  voiceStateAvatar = 64,
  point = 66,
}

// unsure if we should pack the data, in most cases the payload is so small that compressing just
// makes the payload bigger, it adds at least 20b to the payload and as long as the whole websocket
// tcp frame is below 1380b it fits into a single TCP frame, will leave it here until i've decided what to do
// ref: https://tools.ietf.org/id/draft-ietf-hybi-thewebsocketprotocol-09.html#rfc.section.4
// const pack = (buf: Uint8Array): Buffer => zlib.gzipSync(Buffer.from(buf))
// const unpack = (buf: unknown): Buffer => zlib.unzipSync(buf as Uint8Array)

const encoderCreator =
  <Type>() =>
  (msg: Type): Uint8Array =>
    msgPacker.encode(msg)

export type DecodeResult = DecodeResult.Success | DecodeResult.Error

export namespace DecodeResult {
  export type Success = {
    type: 'success'
    message: Message
  }

  export type Error = {
    type: 'error'
    errorType: 'invalidDataType' | 'invalidDataLength'
  }
}

export function decode(data: unknown): DecodeResult {
  if (data === null || data === undefined) {
    return {
      type: 'error',
      errorType: 'invalidDataType',
    }
  }

  let message: Message | null = null
  try {
    // Trust that if it decodes, it's a message (hence the cast)
    message = msgUnpacker.decode(data as any) as Message
  } catch (error) {
    if (error instanceof DecodeError) {
      return {
        type: 'error',
        errorType: 'invalidDataType',
      }
    }

    if (error instanceof RangeError) {
      return {
        type: 'error',
        errorType: 'invalidDataLength',
      }
    }

    throw error
  }

  return {
    type: 'success',
    message,
  }
}

export function encode(message: Message): Uint8Array {
  return msgPacker.encode(message)
}

export type PingMessage = {
  type: MessageType.ping
}
export const PingEncoder = encoderCreator<PingMessage>()

export type PongMessage = {
  type: MessageType.pong
}
export const PongEncoder = encoderCreator<PongMessage>()

export type AnonMessage = {
  type: MessageType.anon
  name?: string
}
export const AnonEncoder = encoderCreator<AnonMessage>()

export type LoginMessage = {
  type: MessageType.login
  token: string
}
export const LoginEncoder = encoderCreator<LoginMessage>()

export type LoginCompleteMessage = {
  type: MessageType.loginComplete
  user: {
    name?: string
    wallet?: string
  }
}
export const LoginCompleteEncoder = encoderCreator<LoginCompleteMessage>()
// A codec to compress theLoginComplete message
extensionCodec.register({
  type: MessageType.loginComplete,
  encode: (input: any) => {
    if (input.type != MessageType.loginComplete) {
      return null
    }
    return encodeAlias([input.user.name, walletToBytes(input.user.wallet)])
  },
  decode: (data): LoginCompleteMessage => {
    const res = decodeAlias(data) as any[]
    return {
      type: MessageType.loginComplete,
      user: {
        name: res[0],
        wallet: bytesToWallet(res[1]),
      },
    }
  },
})

export enum Action {
  Login = 'L',
  Logout = 'O',
  Chat = 'C',
  Enter = 'E',
  Exit = 'X',
  Build = 'B',
  Womp = 'W',
  Dance = 'D',
  Emote = 'M',
  Inspect = 'I',
  Teleport = 'T',
}

export type vec3 = [number, number, number]
export type MetricMessage = {
  type: MessageType.metric
  action: Action
  parcel?: number
  position?: vec3
}
export const MetricEncoder = encoderCreator<MetricMessage>()

export type ChatMessage = {
  type: MessageType.chat
  channel: string
  name: string
  uuid: string
  text: string
}

export const ChatEncoder = encoderCreator<ChatMessage>()

export type PointMessage = {
  type: MessageType.point
  uuid: string
  location: number[]
}

export const PointMessageEncoder = encoderCreator<PointMessage>()

export type CreateAvatarMessage = {
  type: MessageType.createAvatar
  uuid: string
  description: {
    name?: string
    wallet?: string
  }
}
export const CreateAvatarEncoder = encoderCreator<CreateAvatarMessage>()
// A codec to compress the CreateAvatar message
extensionCodec.register({
  type: MessageType.createAvatar,
  encode: (input: any) => {
    if (input.type != MessageType.createAvatar) {
      return null
    }
    return encodeAlias([encodeUUID(input.uuid), input.description.name, walletToBytes(input.description.wallet)])
  },
  decode: (data): CreateAvatarMessage => {
    const res = decodeAlias(data) as any[]
    return {
      type: MessageType.createAvatar,
      uuid: decodeUUID(res[0]),
      description: {
        name: res[1],
        wallet: bytesToWallet(res[2]),
      },
    }
  },
})

// 57
export type AvatarChangedMessage = {
  type: MessageType.avatarChanged
  wallet: string
  cacheKey: number
}

export const AvatarChangedEncoder = encoderCreator<AvatarChangedMessage>()

// 60
export type AvatarEmoteMessage = {
  type: MessageType.emoteAvatar
  uuid: string
  emote: string
}

export const EmoteEncoder = encoderCreator<AvatarEmoteMessage>()

// 62
export type NewCostumeMessage = {
  type: MessageType.newCostume
  uuid: string
  cacheKey: number
}

export const NewCostumeEncoder = encoderCreator<NewCostumeMessage>()

// 63
export type TypingMessage = {
  type: MessageType.typing
  uuid: string
}

export const TypingMessageEncoder = encoderCreator<TypingMessage>()
extensionCodec.register({
  type: MessageType.typing,
  encode: (input: any) => {
    if (input.type != MessageType.typing) {
      return null
    }
    return encodeAlias([encodeUUID(input.uuid)])
  },
  decode: (data): TypingMessage => {
    const res = decodeAlias(data) as any[]
    return {
      type: MessageType.typing,
      uuid: decodeUUID(res[0]),
    }
  },
})

// 64
export enum AvatarVoiceState {
  None = 0,
  Listening = 1,
  BroadcastIdle = 2,
  BroadcastActive = 3,
}
export type VoiceStateMessage = {
  type: MessageType.voiceStateAvatar
  uuid: string
  room?: string
  state: AvatarVoiceState
}

export const VoiceStateMessageEncoder = encoderCreator<VoiceStateMessage>()
extensionCodec.register({
  type: MessageType.voiceStateAvatar,
  encode: (input: any) => {
    if (input.type != MessageType.voiceStateAvatar) {
      return null
    }
    return encodeAlias([input.state, encodeUUID(input.uuid), input.room])
  },
  decode: (data): VoiceStateMessage => {
    const res = decodeAlias(data) as any[]
    const t: VoiceStateMessage = {
      type: MessageType.voiceStateAvatar,
      state: res[0],
      uuid: decodeUUID(res[1]),
    }
    if (res[2]) {
      t.room = res[2]
    }
    return t
  },
})

export type UpdateAvatarMessage = {
  type: MessageType.updateAvatar
  uuid: string
  position: number[]
  orientation: Quaternion
  animation: number
  allowFollow?: boolean
}

export const UpdateAvatarEncoder = encoderCreator<UpdateAvatarMessage>()
extensionCodec.register({
  type: MessageType.updateAvatar,
  encode: (input: any) => {
    if (input.type != MessageType.updateAvatar) {
      return null
    }
    return encodeAlias([encodeUUID(input.uuid), Float32Array.from(input.position), compressQuaternion(input.orientation), input.animation, input.allowFollow ? 1 : 0])
  },
  decode: (data): UpdateAvatarMessage => {
    const res = decodeAlias(data) as any[]
    return {
      type: MessageType.updateAvatar,
      uuid: decodeUUID(res[0]),
      position: uint8ToFloat32(res[1]),
      orientation: decompressQuaternion(res[2]),
      animation: res[3],
      allowFollow: !!res[4],
    }
  },
})

export type JoinMessage = {
  type: MessageType.join
  createAvatars: CreateAvatarMessage[]
  avatars: UpdateAvatarMessage[]
}

export const JoinEncoder = encoderCreator<JoinMessage>()
extensionCodec.register({
  type: MessageType.join,
  encode: (input: any) => {
    if (input.type != MessageType.join) {
      return null
    }
    return encodeAlias([input.createAvatars, input.avatars], { extensionCodec: extensionCodec })
  },
  decode: (data): JoinMessage => {
    const res: any[] = decodeAlias(data, { extensionCodec: extensionCodec }) as any[]
    return {
      type: MessageType.join,
      createAvatars: res[0],
      avatars: res[1],
    }
  },
})

export type WorldStateMessage = {
  type: MessageType.worldState
  avatars: UpdateAvatarMessage[]
}
export const WorldStateEncoder = encoderCreator<WorldStateMessage>()
extensionCodec.register({
  type: MessageType.worldState,
  encode: (input: any) => {
    if (input.type != MessageType.worldState) {
      return null
    }
    return encodeAlias([input.avatars], { extensionCodec: extensionCodec })
  },
  decode: (data): WorldStateMessage => {
    const res: any[] = decodeAlias(data, { extensionCodec: extensionCodec }) as any[]
    return {
      type: MessageType.worldState,
      avatars: res[0],
    }
  },
})

export type DestroyAvatarMessage = {
  type: MessageType.destroyAvatar
  uuid: string
}

export const DestroyAvatarEncoder = encoderCreator<DestroyAvatarMessage>()
extensionCodec.register({
  type: MessageType.destroyAvatar,
  encode: (input: any) => {
    if (input.type != MessageType.destroyAvatar) {
      return null
    }
    return encodeAlias([encodeUUID(input.uuid)], { extensionCodec: extensionCodec })
  },
  decode: (data): DestroyAvatarMessage => {
    const res: any[] = decodeAlias(data, { extensionCodec: extensionCodec }) as any[]
    return {
      type: MessageType.destroyAvatar,
      uuid: decodeUUID(res[0]),
    }
  },
})

/** Utility functions from here on **/

function uint8ToFloat32(data: Iterable<number>) {
  const a = Uint8Array.from(data)
  const x = new Float32Array(a.buffer, a.byteOffset, 3)
  return [x[0], x[1], x[2]]
}

function walletToBytes(hex: string) {
  if (typeof hex !== 'string' || hex.length !== 42) {
    return []
  }
  hex = hex.slice(2) // remove the 0x part
  const bytes = []
  for (let c = 0; c < hex.length; c += 2) bytes.push(parseInt(hex.substr(c, 2), 16))
  return bytes
}

function bytesToWallet(bytes: Uint8Array) {
  if (!Array.isArray(bytes) || bytes.length != 20) {
    return ''
  }
  const hex = []

  for (let i = 0; i < bytes.length; i++) {
    const current = bytes[i] < 0 ? bytes[i] + 256 : bytes[i]
    hex.push((current >>> 4).toString(16))
    hex.push((current & 0xf).toString(16))
  }
  return '0x' + hex.join('')
}

export type Message = Message.NegotiationMessage | Message.StateMessage

export namespace Message {
  function isMessageOfType<M extends Message>(message: Message, types: Record<M['type'], unknown>): message is M {
    // Protect from runtime abuse - the function shouldn't fail for things that *aren't* actually messages, but have
    // been cast to messages in TypeScript.
    const maybeMessageStringType = message?.type?.toString()
    return Object.keys(types).includes(maybeMessageStringType)
  }

  /**
   * Returns a type guard function for the message type. The input `types` structure seems extraneous, but it's
   * necessary to ensure that the function is exhaustive over all possible messages of the given type.
   */
  const makeIsMessageOfType =
    <M extends Message>(types: Record<M['type'], unknown>) =>
    (message: Message): message is M =>
      isMessageOfType(message, types)

  /**
   * A type of message that is sent by a client whilst initializing or maintaining the connection.
   */
  export type ClientNegotiationMessage = PingMessage | LoginMessage | AnonMessage | CreateAvatarMessage

  export const isClientNegotiationMessage = makeIsMessageOfType<ClientNegotiationMessage>({
    [MessageType.ping]: null,
    [MessageType.login]: null,
    [MessageType.anon]: null,
    [MessageType.createAvatar]: null,
  })

  /**
   * A type of message that is sent by the server whilst initializing or maintaining the connection.
   */
  export type ServerNegotiationMessage = PongMessage | LoginCompleteMessage

  export const isServerNegotiationMessage = makeIsMessageOfType<ServerNegotiationMessage>({
    [MessageType.pong]: null,
    [MessageType.loginComplete]: null,
  })

  /**
   * A type of message that is sent whilst initializing or maintaining the connection.
   */
  export type NegotiationMessage = ClientNegotiationMessage | ServerNegotiationMessage

  export const isNegotiationMessage = (message: Message): message is NegotiationMessage => {
    return isClientNegotiationMessage(message) || isServerNegotiationMessage(message)
  }

  /**
   * A type of message that is used for maintaining state by the client and the server.
   */
  type StateRelayMessage = NewCostumeMessage | TypingMessage | ChatMessage | VoiceStateMessage | AvatarEmoteMessage | PointMessage

  /**
   * A type of message that is sent by a client to update the avatar's state in-world.
   */
  export type ClientStateMessage = StateRelayMessage | UpdateAvatarMessage | MetricMessage

  export const isClientStateMessage = makeIsMessageOfType<ClientStateMessage>({
    [MessageType.newCostume]: null,
    [MessageType.typing]: null,
    [MessageType.chat]: null,
    [MessageType.voiceStateAvatar]: null,
    [MessageType.emoteAvatar]: null,
    [MessageType.updateAvatar]: null,
    [MessageType.metric]: null,
    [MessageType.point]: null,
  })

  /**
   * A type of message that is sent by the server to update the the local state of a client, in order to represent
   * all of the other avatars in-world.
   */
  export type ServerStateMessage = StateRelayMessage | CreateAvatarMessage | JoinMessage | DestroyAvatarMessage | AvatarChangedMessage | WorldStateMessage

  export const isServerStateMessage = makeIsMessageOfType<ServerStateMessage>({
    [MessageType.newCostume]: null,
    [MessageType.typing]: null,
    [MessageType.chat]: null,
    [MessageType.voiceStateAvatar]: null,
    [MessageType.emoteAvatar]: null,
    [MessageType.createAvatar]: null,
    [MessageType.join]: null,
    [MessageType.destroyAvatar]: null,
    [MessageType.avatarChanged]: null,
    [MessageType.worldState]: null,
    [MessageType.point]: null,
  })

  /**
   * A type of message that is sent to update the world state for all clients.
   */
  export type StateMessage = ClientStateMessage | ServerStateMessage

  export const isStateMessage = (message: Message): message is StateMessage => {
    return isClientStateMessage(message) || isServerStateMessage(message)
  }
}

// all encoders can in practice encode all types of messages, but we typehint the message argument with encoderCreator
export const GenericEncoder = encoderCreator<Message>()

// prevent throws from the UUID encoder and return a parsed value of '00000000-0000-0000-0000-000000000000'
function encodeUUID(uuid: string): ArrayLike<number> {
  try {
    return parse(uuid)
  } catch {}
  return [0]
}

// prevent throws from the UUID decoder and return '00000000-0000-0000-0000-000000000000' if any errors occur.
function decodeUUID(buf: ArrayLike<number>): string {
  try {
    return stringify(new Uint8Array(buf))
  } catch {
    // ....
  }

  return '00000000-0000-0000-0000-000000000000'
}
