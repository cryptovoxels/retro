import type { ApiAvatarMessage } from '../common/messages/api-avatars'
import { app } from '../web/src/state'
import { stringEllipsisInCanvas } from '../web/src/utils'
import { AvatarAttachmentManager } from './attachment-manager'
import { AudioEngine } from './audio/audio-engine'
import { RemoteFlySound } from './audio/fly-sound'
import { Animations, loadAnimation } from './avatar-animations'
import type Connector from './connector'
import { AVATAR_VIEW_DISTANCE } from './constants'
import { Entity } from './entity'
import { MeshExtended } from './features/feature'
import type Parcel from './parcel'
import { emote } from './utils/emote'
import { Transform } from './utils/transform'
import { Bubble } from './chat'

const ANONYMOUS_NAME = 'anon'
const DEFAULT_SKIN_SVG =
  '<?xml version="1.0" encoding="UTF-8"?><svg width="644px" style="background-color:white" height="641px" viewBox="0 0 644 641" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>'

enum LoadState {
  None,
  Loading,
  Loaded,
}

export type AvatarRecord = import('../common/messages').AvatarIdentity

const AVATAR_HEIGHT = 1.6
const AVATAR_NAME_OFFSET = 0.5

// distance in meters from camera that we play sounds for this avatar
const SOUND_DISTANCE = 20

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
  private voiceMesh: BABYLON.Mesh | null = null
  private voiceTexture: BABYLON.DynamicTexture | null = null
  private collider: MeshExtended | undefined
  private _bubble: Bubble | null = null
  private clearBubbleTimer: NodeJS.Timeout | undefined
  private typingTimer: NodeJS.Timeout | undefined
  private isTyping = false
  private showNameTag = true
  private _inConga = false
  /** Remote: uuid of the avatar they follow in conga (from multiplayer). Local unused. */
  private _congaFollowsUuid: string | null = null
  private remoteFly?: RemoteFlySound
  private remoteStepAt = 0

  constructor(scene: BABYLON.Scene, parent: BABYLON.TransformNode, joined: number, uuid: string, description: AvatarRecord, isUser = false) {
    super(scene, parent, joined)
    this._uuid = uuid
    this._description = description
    if (isUser) {
      this._isUser = true
      this.tickRate = 1000 / 60
    }
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

  get inConga(): boolean {
    return this._inConga
  }

  set inConga(value: boolean) {
    if (this._inConga === value) return
    this._inConga = value
    this.redrawName()
    if (value && this.nameMesh) {
      this.nameMesh.metadata = { isAvatarPart: true, avatar: this }
      ;(this.nameMesh as any).cvOnLeftClick = () => {
        window.connector.sendMessage(`/conga ${this.name}`)
      }
    } else if (!value && this.nameMesh) {
      delete (this.nameMesh as any).cvOnLeftClick
    }
  }

  get congaFollowsUuid(): string | null {
    return this._congaFollowsUuid
  }

  set congaFollowsUuid(value: string | null | undefined) {
    this._congaFollowsUuid = value ?? null
  }

  get main() {
    return window.main
  }

  static ensureRootAvatar(scene: BABYLON.Scene): Promise<void> {
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

  private static async loadRootAvatar(scene: BABYLON.Scene) {
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

    if (updates.costume_id && this._attachmentManager) {
      this._attachmentManager.loadCostume(undefined, updates.costume_id)
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

    this.collider.cvOnLeftClick = (_pickingInfo) => {
      // Avatars no longer dispatch clicks into the scripting runtime - behaviours
      // attach to features, not avatars.
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
    window.persona?.voiceChat?.toggleLocalMute(this.uuid)
    return true
  }

  private _mutedColors: { diffuse: BABYLON.Color3; emissive: BABYLON.Color3 } | null = null

  // muted = red body + stripped wearables ("muted red anon"), fully reversible with no re-fetch
  setMuted(b: boolean) {
    const m = this._material
    if (!m) return
    if (b) {
      if (!this._mutedColors) {
        this._mutedColors = { diffuse: m.diffuseColor.clone(), emissive: m.emissiveColor.clone() }
      }
      m.diffuseColor.set(1, 0, 0)
      m.emissiveColor.set(0.3, 0, 0)
      this._attachmentManager?.hideAllWearables()
    } else {
      if (this._mutedColors) {
        m.diffuseColor.copyFrom(this._mutedColors.diffuse)
        m.emissiveColor.copyFrom(this._mutedColors.emissive)
        this._mutedColors = null
      }
      this._attachmentManager?.showAllWearables()
    }
  }

  disposeLocalAndRemote = () => {
    this.teleportFX(this.absolutePosition, 'avatar.leave')
    this.disposeLocal()
  }

  show() {
    if (this.armatureMesh && this.armatureMesh.visibility !== 1) {
      this.armatureMesh.visibility = 1
      if (this._avatarMesh) {
        this._avatarMesh.visibility = 1
        this._avatarMesh.getChildMeshes().forEach((m) => {
          m.visibility = 1
        })
      }
      if (this.nameMesh) this.nameMesh.visibility = 1
      this._attachmentManager?.showAllWearables()
    }
  }

  hide() {
    if (this.armatureMesh && this.armatureMesh.visibility !== 0) {
      this.armatureMesh.visibility = 0
      if (this._avatarMesh) {
        this._avatarMesh.visibility = 0
        this._avatarMesh.getChildMeshes().forEach((m) => {
          m.visibility = 0
        })
      }
      if (this.nameMesh) this.nameMesh.visibility = 0
      this._attachmentManager?.hideAllWearables()
    }
  }

  disposeName() {
    if (!this.nameMesh) {
      return
    }

    this.nameMesh.dispose()
    this.nameMesh = null
  }

  // little mic chip above the nameplate: dim when voice is on, green pulse while speaking, red when muted, gone when off.
  setVoiceState(state: 'off' | 'on' | 'muted' | 'speaking', level = 0) {
    if (state === 'off') {
      this.voiceMesh?.setEnabled(false)
      return
    }
    if (!this.voiceMesh) this.makeVoiceMesh()
    const mesh = this.voiceMesh
    if (!mesh) return
    mesh.setEnabled(true)
    const mat = mesh.material as BABYLON.StandardMaterial | null
    if (mat) {
      if (state === 'muted') mat.emissiveColor.set(1, 0.25, 0.25)
      else if (state === 'speaking') mat.emissiveColor.set(0.25, 1, 0.4)
      else mat.emissiveColor.set(0.7, 0.7, 0.7)
    }
    // pulse with how loud you are while speaking; sit still otherwise. (-s y: the neck bone is mirrored, see addName)
    const s = 0.9 * (state === 'speaking' ? 1 + Math.min(level, 1) * 0.5 : 1)
    mesh.scaling.set(s, -s, s)
  }

  private makeVoiceMesh() {
    if (this.voiceMesh || !this.neckBone || !this._avatarMesh) return
    const tex = new BABYLON.DynamicTexture('avatar/voice', { width: 128, height: 128 }, this.scene, true)
    tex.hasAlpha = true
    const ctx = tex.getContext()
    if (ctx) {
      ctx.clearRect(0, 0, 128, 128)
      //@ts-ignore
      ctx.textAlign = 'center'
      //@ts-ignore
      ctx.textBaseline = 'middle'
      ctx.font = '96px sans-serif'
      ctx.fillStyle = '#fff'
      ctx.fillText('🎤', 64, 72)
    }
    tex.update()
    this.voiceTexture = tex

    const mesh = BABYLON.MeshBuilder.CreatePlane('avatar/voice', { size: 0.3 }, this.scene)
    mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y
    mesh.metadata = { isAvatarPart: true }
    mesh.position.set(0, -AVATAR_NAME_OFFSET - 0.28, 0) // sit just above the nameplate
    mesh.attachToBone(this.neckBone, this._avatarMesh)
    mesh.addLODLevel(AVATAR_VIEW_DISTANCE, null)

    const mat = new BABYLON.StandardMaterial('avatar/voice', this.scene)
    mat.blockDirtyMechanism = true
    mat.emissiveTexture = tex
    mat.opacityTexture = tex
    mat.diffuseColor = new BABYLON.Color3(0, 0, 0)
    mat.specularColor = new BABYLON.Color3(0, 0, 0)
    mat.disableLighting = true
    mat.sideOrientation = BABYLON.Mesh.DOUBLESIDE // visible from any angle, like the nameplate
    mesh.material = mat
    this.voiceMesh = mesh
  }

  /**
   * Dispose of the avatar and all the elements attached to it
   * such as: bubbles, names, mesh...
   * @returns void
   */
  public disposeLocal = () => {
    this.nameMesh?.dispose()
    this.nameMesh = null

    this.voiceMesh?.dispose()
    this.voiceMesh = null
    this.voiceTexture?.dispose()
    this.voiceTexture = null

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

    this.remoteFly?.dispose()
    this.remoteFly = undefined

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
    if (BABYLON.Vector3.DistanceSquared(this.position, next.position) > 16 * 16) {
      this.teleportFX(this.absolutePosition, 'avatar.leave')
    }
  }

  protected onAfterUpdate(previous: Readonly<Transform>) {
    const sqrDistance = BABYLON.Vector3.DistanceSquared(this.position, previous.position)
    if (sqrDistance > 16 * 16 && !this.isUser) {
      this.teleportFX(this.absolutePosition, 'avatar.arrive')
    }

    if (this.isUser) return

    this.updateRemoteLocomotionAudio(previous)
  }

  private updateRemoteLocomotionAudio(previous: Readonly<Transform>) {
    if (this.distanceFromCamera >= SOUND_DISTANCE) {
      this.remoteFly?.stop()
      return
    }

    const dx = this.position.x - previous.position.x
    const dz = this.position.z - previous.position.z
    const moving = dx * dx + dz * dz > 0.05 * 0.05
    const anim = this.animation?.state

    if (anim === Animations.Walk || anim === Animations.Run) {
      this.remoteFly?.stop()
      if (moving) {
        const delay = anim === Animations.Run ? 300 : 490
        if (Date.now() - this.remoteStepAt >= delay) {
          this.remoteStepAt = Date.now()
          Avatar.audio?.footstepSounds.playSpatialStep(this.absolutePosition, anim === Animations.Run)
        }
      }
      return
    }

    if (anim === Animations.Floating && moving) {
      const audio = Avatar.audio
      if (!audio) return
      if (!this.remoteFly) {
        this.remoteFly = new RemoteFlySound(this.scene, audio.soundEffectsOut, audio.flySound.buffer)
      }
      if (this.remoteFly.playing) {
        this.remoteFly.setPosition(this.absolutePosition)
      } else {
        this.remoteFly.start(this.absolutePosition)
      }
      return
    }

    this.remoteFly?.stop()
  }

  private useTeleportEffects(position: BABYLON.Vector3) {
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
      this._attachmentManager.loadCostume(undefined, this._description.costumeId)
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
    // bubble parents to null (stays where you spoke), so node.getChildren() won't find it
    this._bubble?.dispose()

    const bubble = new Bubble(this.scene, this.node, text)
    // snapshot the head position in world space; bubble stays where you spoke, doesn't follow you
    const head = this.neckBone?.getTransformNode()?.getAbsolutePosition()
    bubble.parent = null
    if (head) {
      bubble.position.copyFrom(head)
      bubble.position.y += 0.6
    } else {
      bubble.position.copyFrom(this.absolutePosition)
      bubble.position.y += 2
    }

    this._bubble = bubble
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

    if (!ctx) {
      return
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

    const isConga = this._inConga
    ctx.fillStyle = isHighlighted ? '#338d48' : 'rgba(34, 34, 34, 0.8)'
    ctx.beginPath()
    ctx.rect(256 - width / 2, 48, width, 64)
    ctx.fill()

    if (isConga) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.lineWidth = 2
      ctx.strokeRect(256 - width / 2, 48, width, 64)
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.fillText(name, 256, 94)

    if (isConga) {
      ctx.font = "24px 'helvetica neue', sans-serif"
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
      ctx.fillText('conga!', 256, 42)
    }

    this.nameTexture.update(true)
  }
}

// factory function to set up and create a avatar representing other players
export async function LoadAvatar(scene: BABYLON.Scene, parent: BABYLON.TransformNode, joined: number, uuid: string, description: AvatarRecord): Promise<Avatar> {
  await Avatar.ensureRootAvatar(scene)
  return new Avatar(scene, parent, joined, uuid, description)
}

export async function LoadUserAvatar(scene: BABYLON.Scene, parent: BABYLON.TransformNode, uuid: string, description: AvatarRecord): Promise<Avatar> {
  await Avatar.ensureRootAvatar(scene)
  return new Avatar(scene, parent, Date.now(), uuid, description, true)
}

function loadAvatarContainer(scene: BABYLON.Scene, avatarFile: string): Promise<BABYLON.AssetContainer> {
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
