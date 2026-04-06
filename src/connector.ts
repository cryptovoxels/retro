import { v7 as uuid } from 'uuid'
import * as messages from '../common/messages'
import { MessageType } from '../common/messages'
import { PanelType } from '../web/src/components/panel'
import { app, AppEvent } from '../web/src/state'
import Avatar, { AvatarRecord, LoadAvatar } from './avatar'
import { AVATAR_VIEW_DISTANCE } from './constants'
import type Controls from './controls/controls'
import type Grid from './grid'
import Persona from './persona'
import type { Scene } from './scene'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'
import { ConnectionState } from './utils/socket-client'
import { Transform } from './utils/transform'
import { signal } from '@preact/signals'

const UPDATE_AVATAR_INTERVAL_MS = 200

// convert HTML entities via DOM APIs
let converter: HTMLTextAreaElement | null = null
// Encoded string type is to just make sure that we don't accidentally pass an encoded string to a function that expects
// a decoded string. Makes it a little more tedious to use, but should help prevent bugs.
type EncodedString = string & { __encodedString: never }
type DecodedString = string & { __decodedString: never }
const entityEncode = (str: string) => {
  if (!converter) {
    converter = document.createElement('textarea')
  }
  converter.innerText = str
  return converter.innerHTML as EncodedString
}

const entityDecode = (str: EncodedString): DecodedString => {
  if (!converter) {
    converter = document.createElement('textarea')
  }
  converter.innerHTML = str
  return converter.value as DecodedString
}

const NEARBY_AVATARS_CACHE_MAX_AGE = 5 * 1000
const CANONICAL_NEARBY_DISTANCE = 32
const AVATAR_TIMEOUT_MS = 5 * 60 * 1000 // If we haven't seen an avatar in 5 minutes, we'll assume they're gone

/**
 * If an avatar disappears implicitly (i.e. we don't get an explicit destroy/leave message) for it, this represents the
 * grace period that it's given to reappear before we dispose it. For example, it might be missing from a successive
 * join message, depending on what order clients rejoin the multiplayer server in.
 */
const AVATAR_DISPOSE_DELAY_MS = 10_000

export type ChatMessageRecord = Readonly<{
  avatar: Avatar['uuid'] | undefined
  name?: string
  text: string
  timestamp: number
}>

export const messageList = signal<ChatMessageRecord[]>([])

const LOCAL_CHANNEL = 'local' as const
const GLOBAL_CHANNEL = 'global' as const

export default class Connector extends TypedEventTarget<{ avatar_joined: string }> {
  readonly onConnectionStateChanged: BABYLON.Observable<ConnectionState> = new BABYLON.Observable()
  loadNearbyAvatarsInterval: NodeJS.Timeout | null = null
  controls: Controls
  connectedAt: Date | undefined
  isOpen = false
  persona: Persona
  avatarTimeoutInterval: NodeJS.Timeout | null = null
  currentParcelId: number | undefined
  multiplayerClient!: WebSocket
  private lazyAvatarDisposer = createLazyDisposer<string>(AVATAR_DISPOSE_DELAY_MS, ({ item: avatarUuid }) => this.disposeAvatar(avatarUuid))
  private readonly scene: Scene
  private readonly parent: BABYLON.TransformNode
  grid: Grid
  private nearbyAvatarsToSelfCached: { avatars: Readonly<Avatar[]>; timestamp: number } | null = null

  private static clientUUID: string = uuid()

  updateAvatarInterval: any

  constructor(scene: Scene, parent: BABYLON.TransformNode, grid: Grid, controls: Controls) {
    super()
    this.scene = scene
    this.parent = parent
    this.grid = grid
    this.controls = controls

    this.persona = new Persona(scene, parent, this, controls, Connector.clientUUID)
    window.connector = this

    // reconnect to socket when login state changes
    app.on(AppEvent.Login, this.onLogin)
    app.on(AppEvent.Logout, this.onLogout)

    this.updateAvatarInterval = setInterval(this.sendAvatar, UPDATE_AVATAR_INTERVAL_MS)

    this.loadNearbyAvatarsInterval = setInterval(() => {
      this.loadUnloadAvatars()
    }, 333)

    this.avatarTimeoutInterval = setInterval(() => {
      if (this.connectionState.status !== 'connected') return

      // dispose avatars that haven't been seen in a while
      for (const avatar of this._avatarsByUuid.values()) {
        if (avatar.lastSeen < Date.now() - AVATAR_TIMEOUT_MS) {
          console.debug('Avatar timed out', avatar.uuid, 'last seen', avatar.lastSeen)
          avatar.disposeLocal()
        }
      }
    }, 60 * 1000)

    //   {
    //     version: '1',
    //     apiLocation: multiplayerApiLocation,
    //     spaceId: this.scene.config.spaceId,
    //   },
    //   {
    //     uuid: this.persona.uuid,
    //     identity: () => this.persona.user.identity,
    //     avatar: () => ({
    //       animationCode: this.persona.animation,
    //       position: this.persona.position.asArray() as [number, number, number],
    //       orientation: this.persona.orientation,
    //     }),
    //     parcel: () => this.grid.currentOrNearestParcel()?.id || null,
    //   },
    //   createLogger(createConsoleLoggerEngine(console, 'info')),
    // )

    window.addEventListener('beforeunload', () => this.disconnect(), { once: true })
  }

  sendAvatar = () => {
    if (this.connectionState.status !== 'connected') {
      // console.log('cant send avatar update, not connected')
      return
    }

    this.send({
      type: MessageType.updateAvatar,
      uuid: Connector.clientUUID,
      animation: this.persona.animation,
      position: this.persona.position.asArray() as [number, number, number],
      orientation: this.persona.orientation,
    })
  }

  get websocketUrl() {
    if (process.env.NODE_ENV === 'development') {
      let url = `ws://localhost:3780/socket?client_uuid=${Connector.clientUUID}`
      if (this.scene.config.spaceId) {
        url += `&space_id=${this.scene.config.spaceId}`
      }
      return url
    }

    const url = new URL(window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/mp/socket'
    url.search = `?client_uuid=${Connector.clientUUID}`
    if (this.scene.config.spaceId) {
      url.search += `&space_id=${this.scene.config.spaceId}`
    }
    url.hash = ''
    return url.toString()
  }

  private _avatarsByUuid = new Map<string, Avatar>()

  get avatarsByUuid(): Map<string, Avatar> {
    return this._avatarsByUuid
  }

  get avatars(): ReadonlyArray<Avatar> {
    return Array.from(this._avatarsByUuid.values())
  }

  get connectionState(): ConnectionState {
    switch (this.multiplayerClient?.readyState) {
      case WebSocket.OPEN:
        return { status: 'connected' }
      case WebSocket.CONNECTING:
        return { status: 'reconnecting' }
      case WebSocket.CLOSED:
        return { status: 'disconnected', lastCloseCode: null }
      default:
        return { status: 'reconnecting' }
    }
  }

  get enteredParcel() {
    return this.grid.enteredParcel
  }

  get isLoggedIn() {
    return app.signedIn
  }

  /**
   * lookup an avatar that is within the area of the user.
   * @param uuid uuid of an avatar to lookup
   * @returns avatar|null
   */
  getLocalAvatar = (uuid: string): Avatar | null => {
    const avatar = this._avatarsByUuid.get(uuid)

    if (!avatar) {
      return null
    }

    if (avatar && avatar.distanceFromCamera >= AVATAR_VIEW_DISTANCE) {
      return null
    }

    return avatar
  }

  currentOrNearestParcel() {
    return this.grid.currentOrNearestParcel()
  }

  currentParcel(forceScan?: boolean) {
    return this.grid.currentParcel(forceScan)
  }

  get nearParcelId() {
    return this.currentOrNearestParcel()?.id ?? 0xffffff
  }

  nearestParcel() {
    return this.grid.nearestParcel()
  }

  nearestEditableParcel() {
    return this.grid.nearestEditableParcel()
  }

  refreshNearestParcels() {
    return this.grid.refreshNearestParcels()
  }

  deleteFeature(parcelId: number, featureUuid: string, currentParcelId: number) {
    return this.grid.deleteFeature(parcelId, featureUuid, currentParcelId)
  }

  onLogin = () => {
    console.log('app.on login reconnect')
    this.reconnect()
    this.grid.reconnect()
  }

  onLogout = () => {
    console.log('app.on logout reconnect')
    this.reconnect()
    this.grid.reconnect()
  }

  connect() {
    console.debug('connecting to', this.websocketUrl)
    this.multiplayerClient = new WebSocket(this.websocketUrl)
    this.multiplayerClient.binaryType = 'arraybuffer'

    this.multiplayerClient.addEventListener('message', this.onMessage)

    this.multiplayerClient.addEventListener('connecting', () => {
      this.isOpen = false
      this.onConnectionStateChanged.notifyObservers({ status: 'reconnecting' })
    })

    this.multiplayerClient.addEventListener('interrupted', () => {
      this.isOpen = false
      this.onConnectionStateChanged.notifyObservers({ status: 'reconnecting' })
    })

    this.multiplayerClient.addEventListener('open', async () => {
      this.isOpen = true
      this.connectedAt = new Date()

      if (app.state.key) {
        const loginMessage: messages.LoginMessage = {
          type: messages.MessageType.login,
          token: app.state.key!,
        }

        this.multiplayerClient.send(messages.encode(loginMessage))
        this.sendCostume()

        this.costumeInterval = setInterval(this.sendCostume, 1000)
      }
      // this.persona.user.update(name || undefined, wallet || undefined)

      // update the parcels the user can edit on connect
      // really this collection shouldn't be necessary, but it is for backwards compat with building
      if (this.grid.length === 0 && this.grid.fastbootParcel && this.grid.fastbootParcel.canEdit) {
        this.persona.user.parcels = [this.grid.fastbootParcel]
      } else {
        this.persona.user.parcels = this.grid.filter((p) => p.canEdit)
      }

      this.onConnectionStateChanged.notifyObservers({ status: 'connected' })

      // await this.getChatHistory()
    })

    this.multiplayerClient.addEventListener('disconnected', () => {
      this.isOpen = false
      this.onConnectionStateChanged.notifyObservers({ status: 'disconnected', lastCloseCode: -1 })

      clearInterval(this.costumeInterval)
    })
  }

  costumeInterval: any

  sendCostume = () => {
    const createAvatarMessage: messages.CreateAvatarMessage = {
      type: messages.MessageType.createAvatar,
      uuid: Connector.clientUUID,
      description: {
        name: app.state.name,
        wallet: app.state.wallet!,
      },
    }

    this.multiplayerClient.send(messages.encode(createAvatarMessage))
  }

  async reconnect() {
    this.multiplayerClient.close()
    // wait a bit before reconnecting to give the server a chance to clean up
    await new Promise((resolve) => setTimeout(resolve, 100))

    this.connect()
  }

  disconnect() {
    this.multiplayerClient.close()
  }

  getNearbyAvatarsToSelf(): Readonly<Avatar[]> {
    if (!this.persona.avatar) {
      return []
    }

    const timestamp = new Date().getTime()
    if (this.nearbyAvatarsToSelfCached === null || timestamp > this.nearbyAvatarsToSelfCached.timestamp + NEARBY_AVATARS_CACHE_MAX_AGE) {
      // refresh the cache
      this.nearbyAvatarsToSelfCached = {
        avatars: this.getNearbyAvatars(this.persona.avatar.position, CANONICAL_NEARBY_DISTANCE, false),
        timestamp,
      }
    }

    return this.nearbyAvatarsToSelfCached.avatars
  }

  getNearbyAvatars(position: BABYLON.Vector3, maxDistance: number, includeSelf = true): Array<Avatar> {
    const result: Avatar[] = []
    for (const avatar of this.avatars) {
      if (avatar.getDistanceFrom(position) < maxDistance) {
        result.push(avatar)
      }
    }
    // add ourselves if needed
    if (includeSelf && this.persona.avatar && this.persona.avatar?.getDistanceFrom(position) < maxDistance) {
      result.push(this.persona.avatar)
    }
    return result
  }

  send(message: messages.Message.ClientStateMessage): void {
    this.multiplayerClient.send(messages.encode(message))
  }

  loadUnloadAvatars() {
    // Load and unload avatars based on their distance
    for (const avatar of this._avatarsByUuid.values()) {
      if (avatar.isDisposed() && avatar.nearby(6)) {
        // we load the avatar 6 meters before they are viewable to give a bit of space for the loading to happen
        avatar.load()
      } else if (avatar.isLoaded() && !avatar.nearby(12)) {
        // we unload an avatar 6 meters beyond we load them to prevent load/unload hysteresis for avatars at the 'border'
        avatar.disposeLocal()
      }
    }
  }

  async onCreateAvatar(message: messages.CreateAvatarMessage) {
    if (this.persona.uuid === message.uuid) return // hey its me, your friend, yourself!
    // we currently dont have the age information from the server, but since we recently got the msg from the MP server we assume now.
    let joined = Date.now()
    // support avatar reload
    let avatarTransform: Readonly<Transform> | null = null
    this.lazyAvatarDisposer.cancelDisposal(message.uuid)

    // check to see if we already have this avatar in world (happens on re-login)
    const existing = this._avatarsByUuid.get(message.uuid)
    if (existing) {
      existing.recordSeen()
      // check that they are up to date
      if (equalsIgnoringCase(existing.description.wallet, message.description.wallet) && existing.description.name === message.description.name) {
        // they are up to date, nothing to do
        return
      }
      console.debug('Reloading avatar', existing.uuid, 'with new info')

      // keep the existing transform etc
      joined = existing.joinedAt
      avatarTransform = existing.getTransform()

      // existing doesn't have all the info.. reload em
      this.disposeAvatar(message.uuid)
    }

    // this is dangermouse casting, these things aren't the same but the avatar code must handle it, I don't want to fuk with it right now
    const avatarRecord = message.description as unknown as AvatarRecord

    const avatar = await LoadAvatar(this.scene, this.parent, joined, message.uuid, avatarRecord)
    this._avatarsByUuid.set(message.uuid, avatar)

    // if we have a transform, apply it (should be pretty rare)
    if (avatarTransform) {
      avatar.move({
        position: avatarTransform.position,
        orientation: avatarTransform.orientation,
        animation: avatarTransform.animation,
        timestamp: avatarTransform.timestamp,
      })
    }
    this.dispatchEvent(createEvent('avatar_joined', message.uuid))
  }

  onDestroyAvatar(message: messages.DestroyAvatarMessage) {
    // Ensure we don't have a disposal queued, in case the avatar re-joins in a short amount of time
    this.lazyAvatarDisposer.cancelDisposal(message.uuid)

    this.disposeAvatar(message.uuid)
  }

  onWorldState(message: messages.WorldStateMessage) {
    message.avatars.forEach((msg) => this.onMoveAvatar(msg))
  }

  async onJoin(message: messages.JoinMessage) {
    const joinMessageAvatarsByUuid: Map<string, messages.CreateAvatarMessage> = new Map()
    const avatarsToAdd: messages.CreateAvatarMessage[] = []
    for (const a of message.createAvatars) {
      joinMessageAvatarsByUuid.set(a.uuid, a)
      const existing = this._avatarsByUuid.get(a.uuid)
      if (!existing) {
        this.lazyAvatarDisposer.cancelDisposal(a.uuid)
        avatarsToAdd.push(a)
      } else {
        // ensure we have the latest avatar record
        if (equalsIgnoringCase(existing.wallet, a.description.wallet)) {
          existing.recordSeen()
        } else {
          console.debug('Reloading avatar', existing.uuid, 'with new info', a.description.wallet, existing.wallet)
          // destroy and recreate
          this.disposeAvatar(a.uuid)
          avatarsToAdd.push(a)
        }
      }
    }

    // add avatars
    await Promise.all(avatarsToAdd.map((a) => this.onCreateAvatar(a)))

    // delete avatars
    setDifference(this._avatarsByUuid, joinMessageAvatarsByUuid).forEach((uuid) => this.lazyAvatarDisposer.markForDisposal(uuid))

    // update avatars
    message.avatars.forEach((msg) => this.onMoveAvatar(msg))
  }

  async onMoveAvatar(message: messages.UpdateAvatarMessage) {
    if (message.uuid === this.persona.uuid) return // hey its me, your friend, yourself!
    let avatar = this._avatarsByUuid.get(message.uuid)
    if (!avatar) {
      // received update for unknown avatar, will load a partial
      this.lazyAvatarDisposer.cancelDisposal(message.uuid)

      avatar = await LoadAvatar(this.scene, this.parent, Date.now(), message.uuid, { name: '', wallet: null })

      if (!avatar) {
        throw new Error(`Failed to load avatar ${message.uuid}`)
      }

      this._avatarsByUuid.set(message.uuid, avatar)
      this.dispatchEvent(createEvent('avatar_joined', message.uuid))
    }

    avatar.move({
      position: BABYLON.Vector3.FromArray(message.position),
      orientation: BABYLON.Quaternion.FromArray(message.orientation),
      animation: message.animation,
      timestamp: Date.now(),
    })

    avatar.recordSeen()
  }

  onAvatarChanged(msg: messages.AvatarChangedMessage) {
    const wallet = msg.wallet.toLowerCase()
    for (const avatar of this._avatarsByUuid.values()) {
      if (avatar.wallet?.toLowerCase() === wallet) {
        avatar.onAvatarChanged(msg.cacheKey)
        avatar.recordSeen()
      }
    }

    if (wallet === app.state.wallet?.toLowerCase()) {
      // Update user avatar
      this.persona.avatar?.onAvatarChanged(msg.cacheKey)
    }
  }

  typing() {
    const message: messages.TypingMessage = {
      type: messages.MessageType.typing,
      uuid: this.persona.uuid,
    }

    this.send(message)
  }

  sendMetric(action: messages.Action, parcel?: number) {
    // Set nearest parcel if possible
    if (!parcel) {
      const nearest = this.nearestParcel()

      if (nearest) {
        parcel = nearest.id
      }
    }

    const position = this.persona.avatar!.position.floor().asArray() as messages.vec3

    const message: messages.MetricMessage = {
      type: messages.MessageType.metric,
      action,
      position,
      parcel,
    }
    this.send(message)
  }

  emote(emote: string) {
    if (emote.length === 0) {
      return
    }

    // Metrics
    this.sendMetric(messages.Action.Emote)

    this.persona.avatar?.emote(emote, null, true)

    // only send supported emotes to MP
    if (!messages.Emotes.includes(emote)) {
      return
    }

    emote = entityEncode(emote)

    const message: messages.AvatarEmoteMessage = {
      type: messages.MessageType.emoteAvatar,
      uuid: this.persona.uuid,
      emote,
    }

    this.send(message)
  }

  sendRefreshCostume(cacheKey: number) {
    const message: messages.NewCostumeMessage = {
      type: messages.MessageType.newCostume,
      uuid: this.persona.uuid,
      cacheKey,
    }

    this.send(message)

    this.emote('🎇')
  }

  onMessage = async (event: MessageEvent) => {
    const result = messages.decode(event.data)

    if (result.type === 'error') {
      console.error('🧨 error', result)
      return
    }

    const msg = result.message
    // console.log('data', msg)

    // if (typeof event.data === 'string') {
    //   msg = JSON.parse(event.data)
    // } else if (event.data instanceof Blob) {
    //   msg = decode(await event.data.arrayBuffer()) as messages.Message
    // } else {
    //   console.log('🧨 unknown event data', event.data)
    //   return
    // }

    switch (msg.type) {
      case messages.MessageType.worldState:
        this.onWorldState(msg)
        break
      case messages.MessageType.join:
        await this.onJoin(msg)
        break
      case messages.MessageType.destroyAvatar:
        this.onDestroyAvatar(msg)
        break
      case messages.MessageType.chat:
        this.onChat(msg)
        break
      case messages.MessageType.emoteAvatar:
        this.onEmoteMessage(msg)
        break
      case messages.MessageType.newCostume:
        this.onNewCostumeMessage(msg)
        break
      case messages.MessageType.typing:
        this.onTypingMessage(msg)
        break
      case messages.MessageType.createAvatar:
        await this.onCreateAvatar(msg)
        break
      case messages.MessageType.avatarChanged:
        this.onAvatarChanged(msg)
        break
      case messages.MessageType.point:
        // to be nerfed
        break
      default: {
        // const _never: never = msg
        console.error(`Unknown message type ${JSON.stringify(msg)}`)
      }
    }
  }

  findAvatar(uuid: string) {
    if (this.persona.avatar && this.persona.avatar.uuid === uuid) {
      return this.persona.avatar
    } else {
      return this._avatarsByUuid.get(uuid)
    }
  }

  findAvatarByWallet(wallet: string) {
    const lowerWallet = wallet.toLowerCase()
    if (this.persona.avatar && this.persona.description.wallet?.toLowerCase() === lowerWallet) {
      return this.persona.avatar
    }

    for (const avatar of this._avatarsByUuid.values()) {
      if (avatar.wallet?.toLowerCase() === lowerWallet) {
        return avatar
      }
    }
    return null
  }

  onChat(message: messages.ChatMessage, messageTimestamp = Date.now(), deliverQuietly = false) {
    // avatar might not exist if they are in a space, or have disconnected etc
    const avatar = this._avatarsByUuid.get(message.uuid)

    if (!avatar) {
      console.warn('Cannot find avatar')
      return
    }

    avatar.addChat(message.text)
    this.addChat(message.text, avatar)
  }

  onEmoteMessage(message: messages.AvatarEmoteMessage) {
    const avatar = this.getLocalAvatar(message.uuid)

    if (!avatar) {
      return
    }

    const emote = entityDecode(message.emote as EncodedString)

    avatar.emote(emote, undefined, true)
    avatar.recordSeen()
  }

  onNewCostumeMessage(message: messages.NewCostumeMessage) {
    const avatar = this.getLocalAvatar(message.uuid)

    if (!avatar) {
      return
    }

    // send the cacheKey we received to synchronize new loading (and not smash the server with random key)
    avatar.attachmentManager?.refreshCostume(message.cacheKey)
    avatar.recordSeen()
  }

  onTypingMessage(message: messages.TypingMessage) {
    const avatar = this.getLocalAvatar(message.uuid)

    if (!avatar) {
      return
    }

    avatar.displayTyping()
    avatar.recordSeen()
  }

  sendMessage(text: string) {
    this.sendMetric(messages.Action.Chat)

    // Show speech bubble?
    this.persona.avatar?.addChat(text)

    this.addChat(text, this.persona.avatar)

    // For scripting purposes:
    // const parcel = this.currentParcel()
    // if (parcel && parcel.parcelScript && this.persona.avatar) {
    //   parcel.parcelScript.dispatch('chat', this.persona.avatar, { text })
    // }

    const message: messages.ChatMessage = {
      type: messages.MessageType.chat,
      channel: LOCAL_CHANNEL,
      name: this.persona.user.name,
      uuid: this.persona.uuid,
      text,
    }

    this.send(message)
  }

  private addChat(message: string, avatar: Avatar | undefined) {
    const list = messageList.value.slice()
    list.push({
      avatar: avatar?.uuid,
      text: message,
      timestamp: Date.now(),
    })

    // only keep the last 100 messages in memory
    while (list.length > 100) {
      list.shift()
    }

    messageList.value = list
  }

  // private async getChatHistory() {
  //   if (this.messages[GLOBAL_CHANNEL].length > 0) {
  //     // already have chat history
  //     console.debug('Skipping chat restore. Already have chat history')
  //     return
  //   }

  //   const history = await fetchFromMPServer<{ messages?: { m: messages.ChatMessage; ts: number }[] }>('/api/chat.json')
  //   if (!history || !history.messages) {
  //     console.error('Failed to fetch chat history')
  //     return
  //   }

  //   // if we received messages while loading back them up
  //   // hopefully this will prevent messages from being lost but risks duplicates
  //   const current = [...this.messages[GLOBAL_CHANNEL]]
  //   this.messages[GLOBAL_CHANNEL].length = 0

  //   // add messages to the chat in reverse order
  //   for (let i = history.messages.length - 1; i >= 0; i--) {
  //     const message = history.messages[i]
  //     if (current.find((m) => m.text === message.m.text && m.timestamp === message.ts)) continue
  //     this.onChat(message.m, message.ts)
  //   }

  //   this.messages[GLOBAL_CHANNEL].push(...current)
  //   this.onMessagesChange.notifyObservers()
  // }

  private async addDummyAvatar(uuid: string, name: string): Promise<Avatar | null> {
    if (!uuid.trim() || !name.trim()) {
      // you aren't giving me much to work with here...
      return null
    }
    // load up a dummy avatar
    this.lazyAvatarDisposer.cancelDisposal(uuid)

    // once get avatar by UUID api is live we can get the full avatar info here
    // in mean time we just create a dummy avatar and assume that mp will send us the full avatar info soon

    const avatar = await LoadAvatar(this.scene, this.parent, Date.now(), uuid, { name: name, wallet: null })

    this._avatarsByUuid.set(uuid, avatar)
    this.dispatchEvent(createEvent('avatar_joined', uuid))

    return avatar
  }

  private disposeAvatar(uuid: string) {
    const avatar = this._avatarsByUuid.get(uuid)
    if (avatar) {
      this._avatarsByUuid.delete(uuid)

      avatar.disposeLocalAndRemote()
    }
  }
}

function setDifference<T>(a: Set<T> | Map<T, any>, b: Set<T> | Map<T, any>): Set<T> {
  const result = new Set<T>()

  a.forEach((x) => {
    if (!b.has(x)) {
      result.add(x)
    }
  })

  return result
}

type LazyDisposer<T> = {
  markForDisposal(item: T): void
  cancelDisposal(item: T): void
}

const createLazyDisposer = <T>(disposeDelayMs: number, onDisposeListener: (event: { item: T }) => void): LazyDisposer<T> => {
  const disposeTimeoutByItem = new Map<T, NodeJS.Timeout>()

  return {
    markForDisposal: (item) => {
      // Don't reset the disposal timeout if we already have one - should be able to continuously mark an item for
      // disposal and it only resets if the disposal was cancelled
      if (!disposeTimeoutByItem.has(item)) {
        disposeTimeoutByItem.set(
          item,
          setTimeout(() => {
            onDisposeListener({ item })
          }, disposeDelayMs),
        )
      }
    },
    cancelDisposal: (item) => {
      const disposeTimeout = disposeTimeoutByItem.get(item)
      if (disposeTimeout) {
        clearTimeout(disposeTimeout)
        disposeTimeoutByItem.delete(item)
      }
    },
  }
}

function equalsIgnoringCase(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false

  return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0
}
