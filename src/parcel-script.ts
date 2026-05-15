import * as assert from 'assert'
import { cameraPosition } from './utils/camera'
import { isEqual } from 'lodash'
import type { QuickJSContext, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten'
import { getQuickJS } from 'quickjs-emscripten'
import { recordParcelEvent } from '../common/helpers/apis'
import { isMobile } from '../common/helpers/detector'
import { currentVersion } from '../common/version'
import { app } from '../web/src/state'
import Avatar from './avatar'
import Feature from './features/feature'
import VidScreen from './features/vid-screen'
import type Parcel from './parcel'
import FeatureBasicGUI from './ui/gui/gui'
import {
  ScriptingActions,
  ScriptingMessage,
  ScriptingMessage_ActionGui,
  ScriptingMessage_Animate,
  ScriptingMessage_Create,
  ScriptingMessage_Emote,
  ScriptingMessage_KickMessage,
  ScriptingMessage_Snapshot,
  ScriptingMessage_Teleport,
  ScriptingMessage_Update,
  ScriptingMessage_UpdateGui,
  ScriptingMessage_VidScreen,
} from './utils/scripting-messages'

const DISTANT = 12
const tryparse = (e: any) => {
  try {
    return JSON.parse(e)
  } catch {
    return null
  }
}

let QUICK_JS: QuickJSWASMModule | null = null
let SCRIPTING_HOST_SRC: string | null = null

export default class ParcelScript {
  // The order of these static methods and variables matter
  static instances: Map<number | string, ParcelScript> = new Map()
  parcel: Parcel
  socket: WebSocket = undefined!
  interval: any
  iframe: HTMLIFrameElement = undefined!
  updatePacket: { type: 'move'; rotation: [number, number, number]; position: [number, number, number] } = undefined!
  messageHandler: any
  onScriptStarted: BABYLON.Observable<boolean> = new BABYLON.Observable()
  lastTestBoundResult: 'away' | 'nearby' | 'within'
  runtime: QuickJSRuntime | null = null
  context: QuickJSContext | null = null
  connected: boolean = false
  disabled = true

  constructor(scene: BABYLON.Scene, parcel: Parcel) {
    this.parcel = parcel
    this.lastTestBoundResult = 'away'

    if (window.config.isBot) {
      this.disabled = true
    }

    if (isMobile()) {
      this.disabled = true
    }

    this.createRuntime()
  }

  private async createRuntime() {
    if (this.disabled) {
      return
    }

    if (!QUICK_JS) {
      QUICK_JS = await getQuickJS()
      // console.log('Created QuickJS module')
      const version = process.env.NODE_ENV === 'development' ? Math.random().toString(36) : currentVersion
      SCRIPTING_HOST_SRC = await fetch(`/scripting-host.js?v=${version}`).then((res) => res.text())
    }

    if (this.runtime) {
      // If for some reason runtime already exists, dispose of it
      this.runtime.dispose()
      this.runtime = null
    }

    // Set limits
    this.runtime = QUICK_JS.newRuntime()
    this.runtime.setMaxStackSize(64 * 1024)
    this.runtime.setMemoryLimit(1024 * 1024)
  }

  _recentlyClicked = false // whether the user has clicked something or not within the last second.

  get recentlyClicked() {
    return this._recentlyClicked
  }

  set recentlyClicked(clicked: boolean) {
    setTimeout(() => {
      this._recentlyClicked = false
    }, 1000)
    this._recentlyClicked = clicked
  }

  get scene() {
    return this.parcel.scene
  }

  get connector() {
    return window.connector
  }

  get user() {
    return window.user
  }

  get persona() {
    return window.persona
  }

  get avatarAttachmentManager() {
    return this.persona.avatar?.attachmentManager
  }

  get playerAttachments() {
    if (!this.avatarAttachmentManager) {
      return []
    }
    return this.avatarAttachmentManager.attachments.map((attachment) => {
      // only expose these avatar properties to the script
      return {
        wid: attachment.wid,
        bone: attachment.bone,
      }
    })
  }

  get player() {
    return {
      token: this.walletOrRandomToken,
      name: this.user && this.user.name,
      wallet: this.user && this.user.wallet,
      uuid: this.persona.uuid,
      collectibles: this.playerAttachments,
    }
  }

  // This is necessary for socket/player management. We use the wallet as socket id or a random uuid for anonymous users.
  get walletOrRandomToken() {
    return this.user.wallet || this.makeRandomToken(7)
  }

  isWithin(): boolean {
    if (!this.scene.activeCamera) {
      return false
    }
    return this.parcel.contains(cameraPosition(this.scene))
  }

  isNearby(): boolean {
    return !!this.persona.avatar && !!this.parcel.featureBounds.intersectsPoint(this.persona.avatar.absolutePosition)
  }

  isDistant(): boolean {
    return !this.isWithin() && this.parcel.transform.position.subtract(cameraPosition(this.scene)).length() > DISTANT
  }

  parcelOrSpaceId() {
    return this.parcel.spaceId || this.parcel.id
  }

  update() {
    if (!this.connected) {
      return
    }

    if (!this.updatePacket) {
      this.updatePacket = {
        type: 'move',
        rotation: [0, 0, 0],
        position: [0, 0, 0],
      }
    }
    // Avoid spamming of move message
    let shouldUpdate = false
    const position = this.persona.position.subtract(this.parcel.transform.position)

    if (!isEqual(this.updatePacket.position, position.asArray())) {
      // Send parcel relative position
      position.toArray(this.updatePacket.position)
      shouldUpdate = true
    }
    const rotation = this.persona.rotation
    if (!isEqual(this.updatePacket.rotation, rotation.asArray())) {
      // Send parcel relative position
      rotation.toArray(this.updatePacket.rotation)
      shouldUpdate = true
    }
    if (shouldUpdate) {
      this.send(this.updatePacket)
    }
  }

  getMemory = () => {
    if (!this.context)
      return {
        memory: 0,
      }

    const memory = this.runtime?.computeMemoryUsage()
    const m = this.runtime?.dumpMemoryUsage()
    console.log('Parcel Script Memory Usage:', m)
    const value = memory?.value
    memory?.dispose()
    return {
      memory: value || 0,
    }
  }

  testBounds() {
    if (!this.connected) {
      return
    }

    if (this.isWithin()) {
      // player entered the parcel
      if (this.lastTestBoundResult !== 'within') {
        this.enterParcel()
        this.lastTestBoundResult = 'within'
      }

      this.update()
    } else if (!this.isWithin() && this.isNearby()) {
      // player left
      if (this.lastTestBoundResult == 'within') {
        // went from inside to nearby
        this.exitParcel()
        this.enterNearby()
        this.lastTestBoundResult = 'nearby'
      } else if (this.lastTestBoundResult == 'away') {
        // went from inside to nearby
        this.enterNearby()
        this.lastTestBoundResult = 'nearby'
      }
      this.update()
    } else if (!this.isNearby() && this.lastTestBoundResult !== 'away') {
      this.exitNearby()
      this.lastTestBoundResult = 'away'
    }
  }

  enterNearby() {
    this.send({ type: 'playernearby', player: this.player })
  }

  enterParcel() {
    this.send({ type: 'playerenter', player: this.player })
  }

  exitParcel() {
    this.send({ type: 'playerleave', player: this.player })
  }

  exitNearby() {
    this.send({ type: 'playeraway', player: this.player })
  }

  cryptoHash(message: { hash: string; to: string; quantity: number; chain_id: number; erc20Address: string | undefined }) {
    this.send({ type: 'cryptohash', event: message })
  }

  scriptWasEdited = () => {
    this.send({ type: 'script-updated' })
  }

  reload() {
    this.stop()
    this.connect()
    console.log('[Scripting] Parcel Script reloaded')
  }

  stop() {
    this.onScriptStarted.notifyObservers(false)
    this.dispose()
  }

  async getContext() {
    while (!this.runtime) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    if (this.context) {
      this.context.dispose()
      this.context = null
    }

    if (!this.context) {
      // Prepare vm
      const vm = this.runtime.newContext()
      // console.log('Created QuickJS context')

      // Create console.log
      const logHandle = vm.newFunction('log', (...args) => {
        const nativeArgs = args.map(vm.dump)
        console.log(`Parcel[${this.parcel.id}]: `, ...nativeArgs)
      })

      // Partially implement `console` object
      const consoleHandle = vm.newObject()
      vm.setProp(consoleHandle, 'log', logHandle)
      vm.setProp(vm.global, 'console', consoleHandle)
      consoleHandle.dispose()
      logHandle.dispose()

      // Expose eval function
      const evalHandle = vm.newFunction('eval', (code) => {
        const nativeCode = vm.dump(code)
        const result = vm.evalCode(nativeCode, 'eval', { type: 'global' })
        if (result.error) {
          const error = vm.dump(result.error)
          console.error('Eval error in eval feature script', JSON.stringify(error))
          result.error.dispose()
          // throw new Error(error)
        } else {
          const value = vm.dump(result.value)
          result.value.dispose()
          return value
        }
      })
      vm.setProp(vm.global, 'eval', evalHandle)
      evalHandle.dispose()

      // Implement postMessage
      const postMessageHandle = vm.newFunction('postMessage', (...args) => {
        const nativeArgs = args.map(vm.dump)

        const message = JSON.parse(nativeArgs[0])
        this.onMessage(message)
      })
      vm.setProp(vm.global, 'postMessage', postMessageHandle)
      postMessageHandle.dispose()

      // Set context
      this.context = vm
    }

    // Return context
    return this.context
  }

  isSpace = () => {
    return typeof this.parcelOrSpaceId() === 'string'
  }

  async connect() {
    console.log('ParcelScript#connect')

    const vm = await this.getContext()

    let result = vm.evalCode(SCRIPTING_HOST_SRC!, 'scripting-host.js', { type: 'global' })
    if (result.error) {
      // const error = vm.dump(result.error)
      console.error('Error in parcel script', JSON.stringify(vm.dump(result.error)))
      result.error.dispose()
    } else {
      result.value.dispose()
    }

    result = vm.evalCode(
      `
      var parcel = new ${this.isSpace() ? `Space('${this.parcelOrSpaceId()}')` : `Parcel(${this.parcelOrSpaceId()})`}
      parcel.parse(${JSON.stringify(this.parcel.summary)});
      parcel.start();
    `,
      'parcel-setup-lines.js',
      { type: 'global' },
    )

    if (result.error) {
      console.error('Error in parcel script', JSON.stringify(vm.dump(result.error)))
      result.error.dispose()
    } else {
      // console.log('Scripting host loaded')
      result.value.dispose()
    }

    // this.send({ type: 'script-updated' })
    // Add connected script instance to the parcelScript record
    ParcelScript.instances.set(this.parcelOrSpaceId(), this)

    this.connected = true

    const join = {
      type: 'join',
      player: this.player,
    }

    this.send(join)

    // Create interval
    this.interval = setInterval(() => this.testBounds(), 200)

    // this.messageHandler = this.onMessage.bind(this)
    // window.addEventListener('message', this.onMessage)

    // this.iframe = iframe

    this.onScriptStarted.notifyObservers(!!this.connected)
  }

  dispose() {
    if (this.interval) {
      clearInterval(this.interval)
    }
    // Remove dropped script instance from the parcelScript record
    ParcelScript.instances.delete(this.parcelOrSpaceId())
    // mark player as away
    this.lastTestBoundResult = 'away'
    this.exitParcel()
    this.exitNearby()
    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null!
    }

    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler)

      this.messageHandler = null
    }

    if (this.socket) {
      this.socket.close()
      this.socket = null!
    }

    // Properly dispose of QuickJS context and runtime to prevent memory leaks
    if (this.context) {
      this.context.dispose()
      this.context = null
    }

    this.parcel.featuresList?.map((f) => {
      f.disposeBasicGui()
      f.createdByScripting && f.dispose()
    })
  }

  disconnect() {
    this.connected = false

    if (this.interval) {
      clearInterval(this.interval)
    }

    if (this.socket) {
      this.socket.close()
    }
  }

  dispatch(type: any, featureOrAvatar: Feature | Avatar, event: any) {
    if (type == 'click') {
      const metadata: any = { position: featureOrAvatar.position.asArray() }
      if (featureOrAvatar instanceof Avatar) {
        metadata['avatarClicked'] = { uuid: featureOrAvatar.uuid, wallet: featureOrAvatar.wallet }
      }

      // Record event to surveyor.crvox.com
      recordParcelEvent({
        parcel_id: typeof this.parcel.id == 'string' ? this.parcel.id : this.parcel.id.toString(),
        avatar: { uuid: this.connector.persona.uuid, wallet: this.connector.persona.avatar?.wallet },
        feature:
          featureOrAvatar instanceof Feature
            ? {
                uuid: featureOrAvatar.uuid,
                id: featureOrAvatar.description.id,
                type: featureOrAvatar.type,
              }
            : null,
        metadata,
        event_type: 'click',
      })

      // set recentlyClicked to true; becomes false in 1000ms
      this.recentlyClicked = true
    }

    this.send({
      type,
      uuid: featureOrAvatar.uuid,
      event: event,
    })
  }

  getFeatureByUUID(uuid: any): Feature {
    return this.parcel.featuresList.find((f) => f.uuid === uuid)!
  }

  onMessage = (packet: any) => {
    // might be disposed
    if (!this.connected) {
      return
    }

    let data = packet.data

    if ('data' in packet) {
      data = packet.data
    } else {
      data = packet
    }

    if (data.length > 32000) {
      console.error('Too long packet > 32000 bytes')
      return
    }

    let msg: any

    try {
      if (typeof data === 'string') {
        msg = JSON.parse(data)
      } else {
        msg = data
      }
    } catch (e) {
      console.error('Invalid script json ' + data)
      return
    }

    switch (msg.type) {
      case ScriptingActions.Snapshot:
        this.handleSnapshot(msg)
        break
      case ScriptingActions.Create:
        this.handleFeatureCreate(msg)
        break
      case ScriptingActions.Update:
        this.handleFeatureUpdate(msg)
        break
      case ScriptingActions.Destroy:
        this.handleFeatureDestroy(msg)
        break
      case ScriptingActions.Remove:
        this.handleFeatureRemove(msg)
        break
      case ScriptingActions.Chat:
        this.handleChat(msg)
        break
      case ScriptingActions.Play:
        this.handlePlay(msg)
        break
      case ScriptingActions.Pause:
        this.handlePause(msg)
        break
      case ScriptingActions.Unpause:
        this.handleUnpause(msg)
        break
      case ScriptingActions.Stop:
        this.handleStop(msg)
        break
      case ScriptingActions.Animate:
        this.handleAnimate(msg)
        break
      case ScriptingActions.Screen:
        this.handleVidScreen(msg)
        break
      case ScriptingActions.Teleport:
        this.handleTeleportPlayer(msg)
        break
      case ScriptingActions.Emote:
        this.handleEmote(msg)
        break
      case ScriptingActions.CreateFeatureGui:
        this.handleCreateFeatureGUI(msg)
        break
      case ScriptingActions.DestroyFeatureGui:
        this.handleDestroyFeatureGUI(msg)
        break
      case ScriptingActions.UpdateFeatureGui:
        this.handleUpdateFeatureGUI(msg)
        break
      case ScriptingActions.PlayerKick:
        this.handlePlayerKick(msg)
        break
    }
  }

  handleSnapshot(msg: ScriptingMessage_Snapshot) {
    this.parcel.update(msg.parcel)
  }

  handleFeatureCreate(msg: ScriptingMessage_Create) {
    this.parcel.createFeature(msg.content)
  }

  handleFeatureUpdate(msg: ScriptingMessage_Update) {
    const f = this.getFeatureByUUID(msg.uuid)

    if (!f) {
      return
    }

    if (f) {
      f.update(msg.content)
    }
  }

  handleFeatureDestroy(msg: ScriptingMessage) {
    const f = this.getFeatureByUUID(msg.uuid)

    if (!f) {
      return
    }

    this.parcel.destroyFeature(f)
  }

  handleFeatureRemove(msg: ScriptingMessage) {
    const f = this.getFeatureByUUID(msg.uuid)

    if (!f) return

    f.dispose()
  }

  handlePlay(msg: ScriptingMessage) {
    const f = this.getFeatureByUUID(msg.uuid)
    if (!f) return
    if (!(f as any)['play']) return

    const setRollOffFactor = (f: any): number => {
      if (!['audio', 'youtube', 'video'].includes(f.type)) return (f.description as any).rollOffFactor
      if (this.isWithin()) return (f.description as any).rollOffFactor
      if (((f.description as any).rolloffFactor || 1) >= 0.8) f.rollOffFactor
      return 1.2
    }

    ;(f.description as any).rolloffFactor = setRollOffFactor(f) || 1.0
    ;(f as any)['play']?.()
  }

  handlePause(msg: ScriptingMessage) {
    const f = this.getFeatureByUUID(msg.uuid)

    if (!f) return

    if ((f as any)['pause']) {
      ;(f as any)['pause']()
    }
  }

  handleUnpause(msg: ScriptingMessage) {
    const f = this.getFeatureByUUID(msg.uuid)

    if (!f) return

    if ((f as any)['unpause']) {
      ;(f as any)['unpause']()
    }
  }

  handleStop(msg: ScriptingMessage) {
    const f = this.getFeatureByUUID(msg.uuid)

    if (!f) return

    if ((f as any)['stop']) {
      ;(f as any)['stop']()
    }
  }

  handleAnimate(msg: ScriptingMessage_Animate) {
    const feature = this.getFeatureByUUID(msg.uuid)

    if (!feature) return

    const animations = msg.animations.map((animation) => BABYLON.Animation.Parse(animation))

    feature.playAnimation(animations)
  }

  handleVidScreen(msg: ScriptingMessage_VidScreen) {
    const feature = this.getFeatureByUUID(msg.uuid) as VidScreen

    if (!feature) return

    feature.updateScreen(msg.screen)
  }

  handleTeleportPlayer(msg: ScriptingMessage_Teleport) {
    if (!msg.coordinates || msg.coordinates == '') {
      return
    }

    if (this.persona.uuid !== msg.uuid) {
      return
    }
    this.persona.teleport(`/play?coords=${msg.coordinates}`)
  }

  handleEmote(msg: ScriptingMessage_Emote) {
    if (!msg.emote || msg.emote == '') {
      return
    }

    const avatar = this.connector.findAvatar(msg.uuid)

    if (!avatar) {
      return
    }
    avatar.emote(msg.emote)
  }

  handleCreateFeatureGUI(msg: ScriptingMessage_ActionGui) {
    const f = this.getFeatureByUUID(msg.uuid)

    if (!f || !msg.gui) return

    if (f.basicGui) {
      f.disposeBasicGui()
    }
    f.basicGui = new FeatureBasicGUI(f, msg.gui.uuid, { listOfControls: msg.gui.listOfControls, billBoardMode: msg.gui.billBoardMode })
    f.basicGui?.generate()
  }

  handleDestroyFeatureGUI(msg: ScriptingMessage) {
    const f = this.getFeatureByUUID(msg.uuid)

    if (!f) return

    f.disposeBasicGui()
  }

  handleUpdateFeatureGUI(msg: ScriptingMessage_UpdateGui) {
    const f = this.getFeatureByUUID(msg.uuid)

    if (!f || !f.basicGui) return

    const control = f.basicGui.getControlByUuid(msg.control.uuid)
    const i = f.basicGui.listOfControls.indexOf(control!)
    if (i > -1) {
      f.basicGui.listOfControls[i] = msg.control
    }
    f.basicGui.refresh()
  }

  handlePlayerKick(msg: ScriptingMessage_KickMessage) {
    if (!msg.uuid) {
      return
    }

    const avatar = this.connector.findAvatar(msg.uuid)

    if (!avatar) {
      return
    }

    const currentParcel = this.connector.currentParcel()?.spaceId || this.connector.currentParcel()?.id

    if (currentParcel !== this.parcelOrSpaceId()) {
      return
    }

    if (msg.reason) {
      app.showSnackbar(`${msg.reason}`)
    } else {
      app.showSnackbar(`Parcel ${this.parcelOrSpaceId()} teleported you out.`)
    }
    if (!window.config.isSpace) {
      this.persona?.teleportNoHistory({ position: new BABYLON.Vector3(0, 1.5, 0), rotation: new BABYLON.Vector3(0, 0, 0) })
    } else {
      window.location.replace('/')
    }
  }

  handleChat(msg: any) {
    //Doesn't work cause chat doesn't throw a thing anymore
    // See possibilities though
    console.log(msg)
  }

  private makeRandomToken(length: any) {
    let result = ''
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const charactersLength = characters.length
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength))
    }
    return result
  }

  private send(msg: any) {
    assert(msg.type)

    if (!this.connected) {
      return
    }

    // console.log('Sending message to parcel', msg)

    const vm = this.context

    if (!vm) {
      return
    }

    // Set user player
    Object.assign(msg, {
      player: this.player,
    })

    // console.log('Sending message to parcel', msg)

    const result = vm.evalCode(`onmessage({ data: ${JSON.stringify(msg)} })`, 'scripting-host-onmessage.js', { type: 'global' })

    if (result.error) {
      console.log('Execution failed:', JSON.stringify(vm.dump(result.error)))
      result.error.dispose()
    } else {
      // console.log("Success:", vm.dump(result.value))
      result.value.dispose()
    }
  }
}
