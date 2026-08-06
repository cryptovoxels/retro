import { debounce } from 'lodash'
import { User } from './user'
import Controls from './controls/controls'
import { CAMERA_HEIGHT, coords, decodeCoords, encodeCoords } from '../common/helpers/utils'
import Connector from './connector'
import { Animations, isCongaSyncedDance } from './avatar-animations'
import * as States from './states'
import { app, AppEvent } from '../web/src/state'
import Avatar, { LoadUserAvatar } from './avatar'
import { decodeCoordsFromURL } from './utils/helpers'
import { wantsXR } from '../common/helpers/detector'
import { Action, AvatarIdentity } from '../common/messages'
import { cameraPosition, cameraRotation, setCameraPosition, setCameraRotation } from './utils/camera'
import VoiceChat from './voice-chat'

const identityEquals = (a: AvatarIdentity, b: AvatarIdentity) => a.wallet === b.wallet && a.name === b.name
const identityFromUser = (user: User): AvatarIdentity => ({ wallet: user.wallet, name: user.name })

export default class Persona {
  user: User
  connector: Connector
  controls: Controls
  firstPersonView: boolean
  position: BABYLON.Vector3
  rotation: BABYLON.Vector3
  avatar: Avatar | undefined = undefined
  avatarSignature: AvatarIdentity | null = null
  voiceChat = new VoiceChat(this)
  onAnimationChanged: BABYLON.Observable<Animations> = new BABYLON.Observable()
  private facingForward: boolean
  // this is in theory a pushdown automata, eg. https://gameprogrammingpatterns.com/state.html#pushdown-automata
  private state: States.CharacterState[] = [new States.Idle()]
  private readonly scene: BABYLON.Scene
  private readonly parent: BABYLON.TransformNode
  private readonly wantsXR: boolean

  constructor(
    scene: BABYLON.Scene,
    parent: BABYLON.TransformNode,
    connector: Connector,
    controls: Controls,
    public readonly uuid: string,
  ) {
    this.scene = scene
    this.parent = parent
    this.controls = controls
    this.connector = connector
    this.position = BABYLON.Vector3.Zero()
    this.rotation = new BABYLON.Vector3(0, 0, 0)
    this._animation = Animations.Idle
    this.facingForward = true
    this.firstPersonView = true
    window.persona = this

    this.user = window.user
    this.wantsXR = wantsXR() // Cache it

    const loadAvatar = debounce(async () => {
      const avatarSignature = identityFromUser(this.user)

      if (this.avatarSignature === null || !identityEquals(avatarSignature, this.avatarSignature)) {
        this.avatarSignature = avatarSignature
        const avatar = await LoadUserAvatar(this.scene, this.parent, this.uuid, { name: this.user.name, wallet: this.user.wallet })

        // Check that the signature captured in scope is the same as the one stored on the instance. This means
        // `loadAvatar` was not called again in the time between asynchronously loaded the avatar and now.
        if (identityEquals(avatarSignature, this.avatarSignature)) {
          this.avatar?.disposeLocalAndRemote()
          this.avatar = avatar
          this.avatar.nametag = false
          await this.avatar.load()
          // AvatarLoad may have fired before this finished and skipped loadCostume because !isLoaded(). Catch up now.
          this.avatar.attachmentManager?.loadCostume()
        } else {
          avatar.disposeLocalAndRemote()
        }
      }
    }, 500)

    // load avatar on startup for all users (anonymous or logged in)
    loadAvatar()

    // see if we need to reload avatar on state change
    app.on(AppEvent.Change, loadAvatar)

    // refresh costume when avatar data (including costume) is fetched from API
    app.on(AppEvent.AvatarLoad, () => {
      if (this.avatar?.isLoaded()) {
        this.avatar.attachmentManager?.loadCostume()
      }
    })

    setTimeout(() => {
      this.controls.idleLook?.start()
    }, 1000)
  }

  private _animation: Animations

  get costumeId() {
    return this.avatar?.attachmentManager?.costume_id
  }
  get animation() {
    return this._animation
  }

  set animation(animation: Animations) {
    this._animation = animation
    this.onAnimationChanged.notifyObservers(animation)
  }

  // fixme
  get audio() {
    return window._audio
  }

  get description() {
    return this.user
  }

  get orientation(): [number, number, number, number] {
    const rotation = this.rotation.clone()

    // Spin avatar around to face the other way
    if (!this.facingForward) {
      rotation.y += Math.PI
    }

    const orientation = rotation.toQuaternion()
    return [orientation.x, orientation.y, orientation.z, orientation.w]
  }

  get absolutePosition() {
    return this.controls.worldOffset.position.add(this.position)
  }

  // teleports a user without adding the previous location to the browser. Might be good for moving players

  isMoving() {
    // car motion moves the camera every frame - don't treat that as walking
    if (this.controls.vehicleFeature) return false
    return !cameraPosition(this.scene).equalsWithEpsilon(this.position, this.wantsXR ? 0.05 : 0.02)
  }

  naviport(value: string) {
    const coords = decodeCoords(value)

    if (!coords) {
      console.warn('Invalid coords', value)
      return
    }

    this.teleportNoHistory(coords)
  }

  // teleport a user with and push the previous location to the browsers history
  teleport(coordsOrUrl: string | coords) {
    console.log('teleported to', coordsOrUrl)

    const coords = typeof coordsOrUrl === 'string' ? decodeCoordsFromURL(coordsOrUrl) : coordsOrUrl
    if (!coords) {
      console.warn('Invalid coords', coordsOrUrl)
      return
    }
    this.teleportNoHistory(coords)

    // Push the DESTINATION into history. Use oldPushState so the monkey-patched
    // pushState in main.tsx does not fire urlchange/naviport with the pre-teleport
    // URL (that race snapped hyperlink teleports back near the clicked graphic).
    const encoded = encodeCoords(coords)
    const queryParams = new URLSearchParams(location.search)
    queryParams.set('coords', encoded)
    const params = queryParams.toString().replace('%40', '@').replace(/%2C/g, ',')
    const href = params ? `${location.pathname}?${params}` : location.pathname
    const currentParcel = this.connector.currentOrNearestParcel()
    const name = currentParcel?.name || currentParcel?.address || encoded
    const push = (history as any).oldPushState?.bind(history) ?? history.pushState.bind(history)
    push(encoded, name, href)

    this.connector.sendMetric(Action.Teleport)
  }

  // out of a restricted area.
  teleportNoHistory(coords: coords) {
    console.log(`Teleporting to ${coords.position.x}, ${coords.position.y}, ${coords.position.z}`)
    window.graphic?.postProcesses?.cover()
    this.audio?.playSound('persona.teleport')

    this.controls.resetWorldOffset(coords.position)
    setCameraPosition(this.scene, coords.position)

    if (coords.rotation) {
      const r = cameraRotation(this.scene)
      setCameraRotation(this.scene, new BABYLON.Vector3(r.x, coords.rotation.y, r.z))
    }

    // make sure we see the features of new area immediately (otherwise we have to wait up to 5 seconds)
    this.connector.refreshNearestParcels()

    // clear out previous grounded and wait for new ground to load so that we don't fall before parcel has loaded
    this.controls.invalidateGroundLoaded()

    this.controls.idleLook?.start()

    // cached dest already meshed — no MeshLoaded; lift after one frame so grey still reads
    if (window.grid?.currentOrNearestParcel()?.voxelMesh) {
      this.scene.onBeforeRenderObservable.addOnce(() => {
        window.graphic?.postProcesses?.reveal()
      })
    }
    // ocean / slow load escape (MeshLoaded also calls reveal; once-guard is fine)
    setTimeout(() => window.graphic?.postProcesses?.reveal(), 3e3)
  }

  popState(controls: Controls) {
    if (this.state.length == 1) {
      console.warn('refusing to remove last persona.state')
      return
    }
    this.state.pop()?.exit(this, controls)
    this.state[this.state.length - 1].enter(this, controls)
  }

  // replace top most state in the state stack and runs the 'enter' and 'exit' actions
  // if newState is true then we pop the last state on the stack, returns the number
  // state changes that happened
  setState(transition: States.Transition | void, controls: Controls): boolean {
    if (!transition) {
      return false
    }
    transition.state ? this.state.push(transition.state) : this.state.pop()?.exit(this, controls)
    this.state[this.state.length - 1].enter(this, controls)
    return true
  }

  update(position: BABYLON.Vector3, rotation: BABYLON.Vector3, controls: Controls) {
    const newStates = this.state[this.state.length - 1].handleControls(this, controls)
    this.setState(newStates, controls)

    this.state[this.state.length - 1].update(this, controls)

    this.position.copyFrom(position)
    this.rotation.x = rotation.x

    // spin the avatar around when walking backwards (but only in 3rd person view)
    this.facingForward = this.firstPersonView || controls.facingForward
    // if in third person mode, only set avatar direction when walking (so that the avatar isn't following the camera direction)
    // while driving, face the car yaw every frame
    if (this.firstPersonView || controls.vehicleFeature || this.state[this.state.length - 1] instanceof States.Moving) {
      this.rotation.y = rotation.y
    }

    // Conga: copy dance/emote from the person in front; the leader's animation reaches the whole line via network hops.
    if (this.connector.inConga && controls.congaTarget && !controls.congaTarget.isDisposed()) {
      const frontAnim = controls.congaTarget.getTransform().animation
      if (isCongaSyncedDance(frontAnim)) {
        this._animation = frontAnim
      }
    }

    // driving: stay seated (isMoving is false, but Idle would still set Walk off)
    if (controls.vehicleFeature) {
      this._animation = Animations.Sitting
    }

    //Directly call move avatar function to move current user avatar
    if (this.avatar?.isLoaded()) {
      this.avatar?.move({
        position: this.position,
        orientation: this.rotation.toQuaternion(),
        animation: this._animation,
        timestamp: Date.now(),
      })
    }
  }

  isSwimming(SWIM_LEVEL: number): undefined | boolean {
    if (this.position.y < SWIM_LEVEL && !this.connector.enteredParcel) {
      return true
    }
    if (this.position.y > CAMERA_HEIGHT) {
      return false
    }
    // no change
    return undefined
  }

  setIdleFirstPerson(value: boolean) {
    const rootState = this.state[0]
    if (rootState instanceof States.Idle) {
      rootState.firstPersonView = value
    }
  }
}
