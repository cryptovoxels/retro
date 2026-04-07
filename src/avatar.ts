import type { ApiAvatarMessage } from '../common/messages/api-avatars'
import { app } from '../web/src/state'
import { stringEllipsisInCanvas } from '../web/src/utils'
import { AvatarAttachmentManager } from './attachment-manager'
import { AudioEngine } from './audio/audio-engine'
import { Animations, loadAnimation } from './avatar-animations'
import type Connector from './connector'
import { AVATAR_VIEW_DISTANCE } from './constants'
import { Entity } from './entity'
import { FeatureEvent, MeshExtended } from './features/feature'
import type Parcel from './parcel'
import ParcelScript from './parcel-script'
import type Persona from './persona'
import type { Scene } from './scene'
import { emote } from './utils/emote'
import { Transform } from './utils/transform'
import { Bubble } from './chat'

const ANONYMOUS_NAME = 'anon'
const DEFAULT_SKIN_SVG =
  '<?xml version="1.0" encoding="UTF-8"?><svg width="644px" style="background-color:white" height="641px" viewBox="0 0 644 641" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>'
const MAX_NEARBY_AVATARS_FOR_EFFECTS = 50

enum LoadState {
  None,
  Loading,
  Loaded,
}

export interface AvatarRecord {
  name: string
  wallet: string | null
}

const AVATAR_HEIGHT = 1.6
const AVATAR_NAME_OFFSET = 0.5
const NAME_CHAT_OFFSET = 0.6

// fixme get screen refresh rate
const CHAT_READ_DURATION = 3500

// distance in meters from camera that we play sounds for this avatar
const SOUND_DISTANCE = 20

type ActionsMode = 'join' | 'joining' | 'leave' | 'sign-in' | null

export default class Avatar extends Entity {
  private static woody: BABYLON.AssetContainer | undefined
  private static awaitingRootAvatarLoading: (() => void)[] = []
  private static rootAvatarLoadState = LoadState.None
  skeleton: BABYLON.Skeleton | null = null
  private readonly _description: AvatarRecord
  private readonly _uuid: string
  private armatureMesh: BABYLON.Mesh | null = null
  private neckBone: BABYLON.Bone | undefined
  private nameMesh: BABYLON.Mesh | null = null
  private nameTexture: BABYLON.DynamicTexture | null = null
  private actionsMesh: BABYLON.Mesh | null = null
  private actionsTexture: BABYLON.GUI.AdvancedDynamicTexture | null = null
  private actionsMode: ActionsMode = null
  private collider: MeshExtended | undefined
  private clearBubbleTimer: NodeJS.Timeout | undefined
  private typingTimer: NodeJS.Timeout | undefined
  private isTyping = false
  private showNameTag = true
  private _allowFollow = false

  constructor(scene: Scene, parent: BABYLON.TransformNode, joined: number, uuid: string, description: AvatarRecord) {
    super(scene, parent, joined)
    this._uuid = uuid
    this._description = description
  }

  tpose() {
    this.animationOverride = Animations.Tpose

    setTimeout(() => {
      this.skeleton?.returnToRest()
    }, 1000)
  }

  private static get audio(): AudioEngine | undefined {
    return window._audio
  }

  /**
   * returns the connector of this avatar.
   * @returns Connector
   */
  private static get connector(): Connector {
    return window.connector
  }

  /**
   * @returns Persona|null
   */
  private static get persona(): Persona | null {
    return Avatar.connector?.persona || null
  }

  /**
   * return whether or not this avatar is in first person mode or not.
   * @returns boolean
   */
  private static get isFirstPerson(): boolean {
    return Avatar.persona?.firstPersonView || true
  }

  private static get IsCrowded(): boolean {
    return Avatar.connector.getNearbyAvatarsToSelf().length > MAX_NEARBY_AVATARS_FOR_EFFECTS
  }

  private _lastSeen = Date.now()

  public get lastSeen() {
    return this._lastSeen
  }

  set nametag(visible: boolean) {
    if (visible && !this.showNameTag) {
      this.addName()
    }

    if (!visible && this.showNameTag) {
      this.disposeName()
    }

    this.showNameTag = visible
  }

  get isAnon() {
    return this.name === 'anon'
  }

  protected _isUser = false

  /**
   * return whether or not the current avatar is the user.
   * @returns Boolean
   */
  get isUser(): boolean {
    return this._isUser
  }

  _attachmentManager: AvatarAttachmentManager | null = null

  get attachmentManager(): AvatarAttachmentManager | null {
    return this._attachmentManager
  }

  get description(): AvatarRecord {
    return this._description
  }

  private _avatarMesh: BABYLON.Mesh | null = null

  get avatarMesh(): BABYLON.Mesh | null {
    return this._avatarMesh
  }

  private _material: BABYLON.StandardMaterial | null = null

  get material(): BABYLON.StandardMaterial | null {
    return this._material
  }

  private _color = '#eee'

  get color(): string {
    return this._color
  }

  get uuid() {
    return this._uuid
  }

  /**
   * Get display name
   * @returns {string} name, truncated wallet ID or 'anonumous'
   */
  get name() {
    return this._description?.name || this._description?.wallet?.substring(0, 10) || ANONYMOUS_NAME
  }

  /**
   * Get Avatar's wallet
   * @returns {string} a hex string.
   */
  get wallet(): string | undefined {
    return this._description.wallet ?? undefined
  }

  get allowFollow(): boolean {
    return this._allowFollow
  }

  set allowFollow(value: boolean) {
    if (this._allowFollow === value) return
    this._allowFollow = value
    this.redrawName()
    if (value && this.nameMesh) {
      this.nameMesh.metadata = { isAvatarPart: true, avatar: this }
      ;(this.nameMesh as any).cvOnLeftClick = () => {
        window.connector.controls.startFollowing(this)
      }
    } else if (!value && this.nameMesh) {
      delete (this.nameMesh as any).cvOnLeftClick
    }
  }

  get main() {
    return window.main
  }

  static ensureRootAvatar(scene: Scene): Promise<void> {
    return new Promise((resolve) => {
      if (Avatar.rootAvatarLoadState === LoadState.Loaded) {
        resolve()
      } else if (Avatar.rootAvatarLoadState === LoadState.Loading) {
        // these will all be called once the avatar has been loaded
        Avatar.awaitingRootAvatarLoading.push(resolve)
      } else {
        Avatar.loadRootAvatar(scene).then(resolve)
      }
    })
  }

  private static async loadRootAvatar(scene: Scene) {
    if (Avatar.rootAvatarLoadState !== LoadState.None) return
    Avatar.rootAvatarLoadState = LoadState.Loading

    const woody = await loadAvatarContainer(scene, 'avatar.glb')
    const animationsLoadedPromise = loadAnimation(scene)

    Avatar.woody = woody

    await animationsLoadedPromise

    Avatar.rootAvatarLoadState = LoadState.Loaded

    // resolve all of the pending ensureRootAvatar callbacks
    while (Avatar.awaitingRootAvatarLoading.length) {
      Avatar.awaitingRootAvatarLoading.shift()!()
    }
  }

  /**
   * Display three dots in the chat bubble
   * Mainly used when the avatar is typing
   * @returns {void} void
   */
  displayTyping() {
    // display the typing icon for 5 seconds
    clearTimeout(this.typingTimer)
    this.isTyping = true
    this.redrawName()
    this.typingTimer = setTimeout(() => {
      this.isTyping = false
      this.redrawName()
    }, 5e3)
  }

  async onAvatarChanged(cacheKey?: number) {
    if (!this.isLoaded()) {
      return
    }
    const wallet = this.wallet
    const updates = wallet ? await this.fetch(wallet, cacheKey) : null

    if (!updates) {
      return
    }

    this.loadAvatarMesh()

    //any changes in the costume?
    if (!!updates.costume_id && this._attachmentManager) {
      this._attachmentManager.costume_id = updates.costume_id
      this._attachmentManager.refreshCostume(cacheKey)
    }
  }

  highlight = () => {
    this.redrawName(true)
  }

  unhighlight = () => {
    this.redrawName(false)
  }

  /**
   * Method to add events (clicks) to an avatar.
   * This uses the collider mesh.
   * @returns {void} void
   */
  addEvents() {
    if (!this.collider) {
      return
    }

    if (!this.collider.actionManager) {
      this.collider.actionManager = new BABYLON.ActionManager(this.scene)
    }

    this.collider.cvOnLeftClick = (pickingInfo) => {
      const parcel = Avatar.connector.currentParcel() as Parcel
      const point: number[] = []
      const normal: number[] = []

      if (!parcel) {
        return
      }

      if (pickingInfo) {
        if (pickingInfo.pickedPoint) {
          pickingInfo.pickedPoint.subtract(parcel.transform.position).toArray(point)
        }
        pickingInfo.getNormal()?.toArray(normal)
      }

      const e: FeatureEvent = { point, normal }

      const parcelScript = parcel.parcelScript as ParcelScript
      if (parcelScript) {
        parcelScript.dispatch('click', this, e)
      }
    }
  }

  /**
   * Set the skin of the avatar using the given skin.
   * @param {string} svg the svg string representing the skin
   * @returns {void} void
   */
  setSkin(svg: string) {
    if (!this._material) {
      console.warn('cant set skin on without a material')
      return
    }
    // Annoyingly, if nulling out the skin texture, babylon bug makes it show some random texture for
    // short while, so this code will set to empty default texture if existing texture needs to be removed
    if (svg || this._material?.diffuseTexture) {
      if (this._material?.diffuseTexture) {
        this._material.diffuseTexture.dispose()
      }

      const encodedData = 'data:image/svg+xml;base64,' + window.btoa(svg || DEFAULT_SKIN_SVG)

      // SVGs need unique names otherwise texture could refer to the wrong SVG
      const texture = BABYLON.Texture.LoadFromDataString('svg' + this._uuid, encodedData, this.scene, false, false, false)
      this._material.diffuseTexture = texture
      texture.hasAlpha = true
    }
  }

  /**
   * Generates the avatar.
   */
  async load() {
    if (this.state === 'loading') {
      return
    }
    try {
      if (this.isUser) {
        // avatar is anon on spawn and then we load the stuff;
        // This is to make sure we're not waiting for the MP response if the avatar is the user's
        await this.loadAvatarMesh()
      } else {
        // we need to set this here because the this.fetch is asynchronous and there is a race condition with Connector.loadUnloadAvatars()
        // that could cause two running load() at the same time
        this.state = 'loading'
        const wallet = this.wallet
        if (wallet) {
          await this.fetch(wallet)
        }

        await this.loadAvatarMesh()
      }
    } catch (e) {
      console.error('Error loading avatar, disposing', e)
      this.disposeLocal()
    }
  }

  /**
   * Generate particles around the avatar with the given emoji.
   * @param {string} emoji the emoji to display
   * @param {BABYLON.Vector3} [position] position to display the emoji.
   * @param {boolean} [playSound] should a sound be played
   * @returns {void} void
   */
  emote(emoji: string, position: BABYLON.Vector3 | null = null, playSound = false) {
    if (!this.isLoaded()) {
      return
    }

    if (playSound && this.distanceFromCamera < SOUND_DISTANCE) {
      // only play emote sound spatially if it's not from the current player
      Avatar.audio?.playSound('avatar.emote', !this._isUser, position || this.position)
    }

    const origin = position || this.node.absolutePosition
    origin.subtractInPlace(new BABYLON.Vector3(0, 0.3, 0))

    const nicerLooking = Avatar.connector.getNearbyAvatarsToSelf().length <= 50
    emote(emoji, origin, this.scene, nicerLooking)
  }

  onContextClick() {
    return true
  }

  disposeLocalAndRemote = () => {
    this.teleportFX(this.absolutePosition, 'avatar.leave')
    this.disposeLocal()
  }

  /**
   * Show the avatar, including name and wearables
   * Assumes code is not directly setting the visibility of the parts
   */
  show() {
    if (this.armatureMesh && this.armatureMesh.visibility !== 1) {
      this.armatureMesh.visibility = 1
      if (this._avatarMesh) {
        this._avatarMesh.visibility = 1
        this._avatarMesh.getChildMeshes().forEach((m) => {
          m.visibility = 1
        })
      }
      if (this.nameMesh) {
        this.nameMesh.visibility = 1
      }
    }

    this._attachmentManager?.showAllWearables()
  }

  /**
   * Hide the avatar, including name and wearables
   * Assumes code is not directly setting the visibility of the parts
   */
  hide() {
    if (this.armatureMesh && this.armatureMesh.visibility !== 0) {
      this.armatureMesh.visibility = 0
      if (this._avatarMesh) {
        this._avatarMesh.visibility = 0
        this._avatarMesh.getChildMeshes().forEach((m) => {
          m.visibility = 0
        })
      }
      if (this.nameMesh) {
        this.nameMesh.visibility = 0
      }
    }

    this._attachmentManager?.hideAllWearables()
  }

  disposeName() {
    if (!this.nameMesh) {
      return
    }

    this.nameMesh.dispose()
    this.nameMesh = null
  }

  /**
   * Dispose of the avatar and all the elements attached to it
   * such as: bubbles, names, mesh...
   * @returns void
   */
  public disposeLocal = () => {
    this.nameMesh?.dispose()
    this.nameMesh = null

    this.removeActions()

    this._material?.dispose(true, true)
    this._material = null

    this._avatarMesh?.dispose()
    this._avatarMesh = null
    this.armatureMesh?.dispose()
    this.armatureMesh = null
    this.skeleton?.dispose()
    this.skeleton = null
    this.collider?.dispose()
    this.collider = undefined

    this._attachmentManager?.dispose()
    this._attachmentManager = null

    super.dispose()
  }

  /**
   * Get avatar height
   * @returns {number} avatar height in meters
   */
  get height(): number {
    return AVATAR_HEIGHT
  }

  /**
   * Set parent for the avatar (used by pose balls)
   * @param {BABYLON.TransformNode} parent the parent node
   */
  setParent(parent: BABYLON.TransformNode): void {
    this.node.setParent(parent)
  }

  /**
   * Remove parent from the avatar
   */
  unparent(): void {
    this.node.setParent(null)
  }

  public recordSeen() {
    this._lastSeen = Date.now()
  }

  protected setTransform(i: Transform) {
    super.setTransform(i)
    // the body doesnt pitch or lean
    this.node.rotation.set(0, this.orientation.y, 0)
    // but the head pitches
    this.neckBone?.getTransformNode()?.rotationQuaternion?.copyFrom(BABYLON.Quaternion.FromEulerAngles(this._orientation.x, 0, 0))
  }

  // is used before eg. position is changed so that we can compare coming changes
  protected onBeforeUpdate(next: Readonly<Transform>) {
    const sqrDistance = BABYLON.Vector3.DistanceSquared(this.position, next.position)
    if (sqrDistance > 0.1 * 0.1) {
    }
    if (sqrDistance > 16 * 16) {
      this.teleportFX(this.absolutePosition, 'avatar.leave')
    }
  }

  protected onAfterUpdate(previous: Readonly<Transform>) {
    const sqrDistance = BABYLON.Vector3.DistanceSquared(this.position, previous.position)
    if (sqrDistance > 16 * 16 && !this.isUser) {
      this.teleportFX(this.absolutePosition, 'avatar.arrive')
    }
  }

  private useTeleportEffects(position: BABYLON.Vector3) {
    if (Avatar.IsCrowded) {
      return false
    }

    if (!this.isLoaded()) {
      return false
    }

    // no avatar should be spawning at position [0,0,0] it's a buggy position, and if people are idle they might be
    // kicked by the MP server and then reconnected by the client and that would spawn teleport effects for ever under
    // the origin.
    if (position.lengthSquared() === 0) {
      return false
    }

    if (this.distanceFromCamera > AVATAR_VIEW_DISTANCE) {
      return false
    }

    if (!this.lastTeleportAt) {
      return true
    }

    return Date.now() - this.lastTeleportAt >= 2000
  }

  private teleportFX(absolutePosition: BABYLON.Vector3, soundName: 'avatar.arrive' | 'avatar.leave') {
    if (!this.useTeleportEffects(absolutePosition)) {
      return
    }
    this.lastTeleportAt = Date.now()
    this.emote('✨', absolutePosition)
    // play the leave sound from the position we are teleporting from
    const connectionDuration = Avatar.connector.connectedAt ? Date.now() - Avatar.connector.connectedAt.getTime() : 0
    if (connectionDuration > 5e3 && this.distanceFromCamera < SOUND_DISTANCE) {
      Avatar.audio?.playSound(soundName, true, absolutePosition)
    }
  }

  /**
   * Fetch avatar's information from the database includes the avatar's active costume.
   */
  private async fetch(
    wallet: string,
    cacheKey: string | number | null = null,
  ): Promise<{
    name?: string | undefined
    costume_id?: number | undefined
  } | null> {
    let url = `/api/avatars/${wallet}.json`

    // allow synchronized cache busting when loading new costumes
    if (cacheKey) {
      url += `?${cacheKey}`
    }

    const p = await fetch(url)
    if (!p.ok) throw p
    const r = (await p.json()) as ApiAvatarMessage

    const name = (r.avatar && r.avatar.name) || r.avatar?.owner?.slice(0, 10) + '...' || ANONYMOUS_NAME
    const costume = (r.avatar && r.avatar.costume) || {}

    let changes: { name?: string; costume_id?: number } | null = null
    if (this._description.name != name) {
      changes = {
        name: name,
      }
      this._description.name = name
    }

    if (this._attachmentManager?.costume_id != costume.id) {
      // new name
      if (!changes) {
        changes = {}
      }
      changes.costume_id = costume.id
    }

    return changes
  }

  /**
   * Loads the avatar's mesh, its collider, its name and its costume.
   */
  private async loadAvatarMesh() {
    if (this.isLoaded()) {
      this.disposeLocal()
    }

    super.load()

    const container = Avatar.woody

    if (!container) {
      throw new Error("Can't load woody avatar, failed loading of asset container")
    }

    const entries = container.instantiateModelsToScene(() => 'mesh', false)

    this._avatarMesh = entries.rootNodes[0] as BABYLON.Mesh
    this._avatarMesh.isPickable = false
    this._avatarMesh.getChildMeshes().forEach((m) => {
      // This is to make sure we can still click on stuff when in other avatars than Woody
      m.isPickable = false
    })
    this._avatarMesh.flipFaces()
    this._avatarMesh.metadata = { isAvatarPart: true }
    this._avatarMesh.setParent(this.node)

    this.armatureMesh = this._avatarMesh.getChildMeshes()[0] as BABYLON.Mesh
    this.armatureMesh.isPickable = false
    this.armatureMesh.metadata = { isAvatarPart: true }

    this._material = new BABYLON.StandardMaterial('avatar', this.scene)
    this._material.id = 'matAvatar' + this._uuid
    this.armatureMesh.material = this._material

    if (this.isAnon) {
      this._material.diffuseColor.set(1, 1, 1)
      this._material.specularColor.set(1, 1, 1)
      this._material.emissiveColor.set(0.5, 0.5, 0.5)
      // this._material.disableLighting = true
      this._material.specularPower = 1000

      this.armatureMesh.outlineColor = new BABYLON.Color3(0.05, 0.05, 0.05)
      this.armatureMesh.outlineWidth = 0.02
      this.armatureMesh.renderOutline = true
    } else {
      this._material.diffuseColor.set(0.82, 0.81, 0.8)
      this._material.emissiveColor.set(0, 0, 0)
      this._material.specularPower = 1000
    }
    this._material.blockDirtyMechanism = true

    if (!this.isUser) {
      this.collider = BABYLON.MeshBuilder.CreateSphere(
        `avatar/collider`,
        {
          segments: 4,
          diameterX: 0.5,
          diameterY: 1.8,
          diameterZ: 0.5,
        },
        this.scene,
      )
      this.collider.isPickable = true
      this.collider.visibility = 0
      this.collider.metadata = { avatar: this, isAvatarPart: true, captureMoveEvents: true }
      this.collider.setParent(this.node)
    }

    this._avatarMesh.addLODLevel(AVATAR_VIEW_DISTANCE, null)
    this.armatureMesh.addLODLevel(AVATAR_VIEW_DISTANCE, null)
    this.collider?.addLODLevel(AVATAR_VIEW_DISTANCE, null)

    this.skeleton = entries.skeletons[0]
    this.armatureMesh.skeleton = this.skeleton
    this.animation?.copy(this.skeleton)

    const t = this.skeleton?.getBoneIndexByName('mixamorig:Head')
    this.neckBone = this.skeleton.bones[t]
    if (!this.neckBone) {
      console.error('could not find the bone named mixamorig:Head')
    }

    if (this.isUser) {
      // Make sure we don't hide avatar when out of camera frustum if avatar is us
      this._avatarMesh.alwaysSelectAsActiveMesh = true
      this.armatureMesh.alwaysSelectAsActiveMesh = true
    }

    if (this.showNameTag) {
      this.addName()
    }

    this._attachmentManager = new AvatarAttachmentManager(this.scene, this, AVATAR_VIEW_DISTANCE - 1)

    if (this.wallet) {
      this._attachmentManager.loadCostume()
      this.addEvents()
    }

    // Hide by default if this is the current user and it shouldn't be displayed
    if (this.isUser && !window.connector.controls.showSelfAvatar) {
      this.hide()
    }

    // these should always be zero relative to this.parent, but if a user teleports and the system tries to load
    // avatars that it already has data for, the meshes will be offset due to the absolute and relative coordinate
    // systems we are using to fix an z-fighting issue on far away islands
    this._avatarMesh.position.set(0, -AVATAR_HEIGHT, 0)
    this.collider?.position.set(0, -AVATAR_HEIGHT / 2, 0)

    this.loadFinished()
    if (Date.now() - this.joinedAt < 2000) {
      this.teleportFX(this.absolutePosition, 'avatar.arrive')
    }
  }

  /**
   * add the name mesh to the avatar
   * @returns void
   */
  private addName() {
    if (this.nameMesh) {
      return
    }

    if (this.isAnon) {
      return
    }

    // Make a dynamic texture
    const nameTexture = new BABYLON.DynamicTexture(
      'avatar/name-bubble',
      {
        width: 512,
        height: 128,
      },
      this.scene,
      true,
    )
    nameTexture.hasAlpha = true
    this.nameTexture = nameTexture
    this.redrawName()

    this.nameMesh = BABYLON.MeshBuilder.CreatePlane(
      'avatar/name',
      {
        width: 1,
        height: 0.25,
        sideOrientation: BABYLON.Mesh.FRONTSIDE,
      },
      this.scene,
    )
    this.nameMesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y
    this.nameMesh.metadata = { isAvatarPart: true }

    const s = 0.9
    // negate the x-scaling in keeping with the weird config of the neck bone
    this.nameMesh.scaling.set(s, -s, s)
    this.nameMesh.position.set(0, -AVATAR_NAME_OFFSET, 0)
    if (this.neckBone && this._avatarMesh) this.nameMesh.attachToBone(this.neckBone, this._avatarMesh)
    this.nameMesh.addLODLevel(AVATAR_VIEW_DISTANCE, null)

    const material = new BABYLON.StandardMaterial('avatar/name', this.scene)
    material.blockDirtyMechanism = true
    material.diffuseTexture = nameTexture
    material.emissiveTexture = nameTexture
    material.opacityTexture = nameTexture
    material.specularColor = new BABYLON.Color3(0, 0, 0)
    material.sideOrientation = BABYLON.Mesh.DOUBLESIDE
    material.alpha = 0.9
    this.nameMesh.material = material
  }

  addChat(text: string) {
    // Dispose old bubbles
    for (const b of this.node.getChildren()) {
      if (b instanceof Bubble) {
        b.dispose()
      }
    }

    const bubble = new Bubble(this.scene, this.node, text)
    bubble.position.set(0, 0.5, 0)

    setTimeout(() => {
      bubble.dispose()
    }, CHAT_READ_DURATION)
  }

  /**
   * redraw the name of the avatar.
   * @param highlight if true, the name will appear as green (highlight that user)
   * @returns void
   */
  private redrawName(highlight = false) {
    if (!this.nameTexture) {
      return
    }

    const ctx = this.nameTexture.getContext()
    const isHighlighted = highlight
    const sharesRoomWithUser = false

    if (!ctx) {
      return
    }

    // always display name on top when in same room as user
    if (this.nameMesh) {
      this.nameMesh.renderingGroupId = sharesRoomWithUser ? 1 : 0
    }

    // clear previous render
    const size = this.nameTexture.getSize()
    ctx.clearRect(0, 0, size.width, size.height)

    //@ts-ignore
    ctx.textAlign = 'center'
    ctx.font = "bold 44px 'helvetica neue', sans-serif"

    let name = stringEllipsisInCanvas(this.name, ctx, size.width)

    if (this.isTyping) {
      name += '...'
    }

    const paddingLeftRight = 20
    const width = ctx.measureText(name).width + paddingLeftRight * 2

    const isLeading = this._allowFollow
    ctx.fillStyle = isHighlighted ? '#338d48' : isLeading ? 'rgba(46, 125, 50, 0.85)' : 'rgba(34, 34, 34, 0.8)'
    ctx.beginPath()
    ctx.rect(256 - width / 2, 48, width, 64)
    ctx.fill()

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.fillText(name, 256, 94)

    if (isLeading) {
      ctx.font = "24px 'helvetica neue', sans-serif"
      ctx.fillStyle = 'rgba(200, 255, 200, 0.9)'
      ctx.fillText('follow', 256, 42)
    }

    this.nameTexture.update(true)
  }

  private setActions(mode: ActionsMode) {
    if (this.actionsMode !== mode) {
      this.actionsMode = mode
      this.redrawActions()
    }
  }

  private refreshActions() {
    if (!app.signedIn) {
      this.setActions('sign-in')
    } else {
      this.setActions(null)
    }
  }

  private redrawActions() {
    if (!this.actionsTexture) {
      return
    }
    this.actionsTexture.getChildren().forEach((control) => {
      this.actionsTexture?.removeControl(control)
      control.dispose()
    })

    const createButton = (name: string, text: string, background: string, hoverBackground: string, onClick: (() => void) | null) => {
      const button = BABYLON.GUI.Button.CreateSimpleButton(name, text)
      const textColor = '#EEE'

      button.fontSize = 40
      button.background = background
      button.color = textColor
      button.isPointerBlocker = true
      button.cornerRadius = 20

      if (onClick) {
        button.onPointerUpObservable.add(() => {
          onClick()
        })

        button.onPointerEnterObservable.add(() => {
          button.background = hoverBackground
        })

        button.onPointerOutObservable.add(() => {
          button.background = background
        })
      } else {
        button.isEnabled = false
      }

      return button
    }
  }

  private removeActions() {
    this.actionsMesh?.dispose(false, true)
    this.actionsMesh = null
    this.actionsTexture = null
  }
}

/**
 * Splits a string into an array of string given canvas restrictions.
 * @param {CanvasRenderingContext2D} ctx A canvasContext
 * @param {string} text the text to split to lines
 * @param {number} maxWidth the max width of the line.
 * @returns Array of strings
 */
function getTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines = []
  while (text.length) {
    let i: number
    // find maximum line length
    for (i = text.length; ctx.measureText(text.substr(0, i)).width > maxWidth; i--);
    const slice = text.substr(0, i)

    // make sure we wrap on a space
    let j: number | null = null
    if (i !== text.length) {
      for (j = 0; slice.indexOf(' ', j) !== -1; j = slice.indexOf(' ', j) + 1);
    }

    const line = slice.substr(0, j ?? slice.length)
    lines.push(line)
    text = text.slice(line.length)
  }
  return lines
}

function getLineMaxWidth(ctx: CanvasRenderingContext2D, lines: string[]): number {
  return lines.reduce((result, line) => {
    return Math.max(result, ctx.measureText(line).width)
  }, 0)
}

// factory function to set up and create a avatar representing other players
export async function LoadAvatar(scene: Scene, parent: BABYLON.TransformNode, joined: number, uuid: string, description: AvatarRecord): Promise<Avatar> {
  await Avatar.ensureRootAvatar(scene)
  return new Avatar(scene, parent, joined, uuid, description)
}

function loadAvatarContainer(scene: Scene, avatarFile: string): Promise<BABYLON.AssetContainer> {
  return new Promise((resolve, reject) => {
    BABYLON.SceneLoader.LoadAssetContainer(
      `/models/`,
      avatarFile,
      scene,
      (c) => resolve(c),
      null,
      (s, msg) => reject(msg),
    )
  })
}
