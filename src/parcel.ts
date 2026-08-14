import { ethers } from 'ethers'
import { cameraPosition } from './utils/camera'
import { debounce, throttle } from 'lodash'
import type { NdArray } from 'ndarray'
import ndarray from 'ndarray'
import { v7 as uuid } from 'uuid'
import { defaultColors } from '../common/content/blocks'
import { recordParcelEvent } from '../common/helpers/apis'
import { isBatterySaver, isMobile } from '../common/helpers/detector'
import { ParcelUser } from '../common/helpers/parcel-helper'
import type { ApiParcelMessage } from '../common/messages/api-parcels'
import { FeatureRecord } from '../common/messages/feature'
import type { ParcelGeometry, ParcelKind, ParcelPatch, ParcelRecord, ParcelRef, ParcelSettings } from '../common/messages/parcel'
import { getBufferFromVoxels, getFieldShape, getVoxelsFromBuffer } from '../common/voxels/helpers'
import { VoxelSize } from '../common/voxels/mesher'
import { applyCleanPalette, buildCleanMesh } from './clean-mesher'
import { createWhiteTexture } from './textures/textures'
import type { LanternRecord } from '../common/messages/feature'
import { app } from '../web/src/state'
import { mintParcel } from '../web/src/helpers/mint-parcel'
import Autobuilder from './autobuild'
import { createFeature } from './features/create'
import Feature from './features/feature'
import type Grid from './grid'
import { isShared } from './materials'
import ParcelBouncer from './parcel-bouncer'
import ParcelBudget from './parcel-budget'
import { ParcelMesher } from './parcel-mesher'
import LuaBehaviours from './lua/behaviours'
import { FeaturePump } from './pump/feature-pump'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'
import { tidyVec3 } from './utils/helpers'
import { ParcelEventMap } from './utils/parcel-event-map'
import { GLASS_MAX_VIEW_DISTANCE } from './voxel-field'
import { Action } from '../common/messages'

const isTest = process.env.NODE_ENV === 'test'
export const UNBAKED = '/textures/03-white-square.png'

const NEARBY = isTest ? 92 : 64

const SPRITE_SLICE_DURATION = 0.5

export enum ParcelActivationState {
  Inactive = 'inactive',
  Activating = 'activating',
  Active = 'active',
  Deactivating = 'deactivating',
}

export default class Parcel extends TypedEventTarget<ParcelEventMap> {
  private static defaultSoundSprite: BABYLON.Sound
  readonly id: number
  readonly spaceId: string | undefined
  readonly isFastboot: boolean
  state: Record<string, Partial<FeatureRecord>> = {}
  name? = ''
  owner = ''
  parcel_users: Array<ParcelUser> | null
  suburb = 'Unknown suburb'
  island = 'Unknown island'
  readonly summary: ParcelRecord & { spaceId?: string }
  readonly geometry: ParcelGeometry | undefined
  description: string | undefined
  readonly address: string
  readonly kind: ParcelKind | undefined
  tileset: string | undefined
  palette: string[] | undefined
  brightness: number | undefined
  settings: ParcelSettings
  voxels: string | undefined
  features: FeatureRecord[]
  featuresList: Feature[] = []
  field: NdArray<Uint16Array> | undefined
  voxelMesh: BABYLON.Mesh | undefined
  glassMesh: BABYLON.Mesh | undefined
  content: Partial<ParcelRecord> = {}
  readonly parentNode: BABYLON.TransformNode
  readonly budget: ParcelBudget
  readonly lightmapUpdateObservable: BABYLON.Observable<string | null> = new BABYLON.Observable()
  socketAuth: string | undefined
  label: string | undefined
  featuresActive?: boolean // Are features active for this parcel? IE are we displaying features? May be in generation.
  readonly scene: BABYLON.Scene
  readonly transform: BABYLON.TransformNode & { parcel?: Parcel }
  readonly x1: number
  readonly y1: number
  readonly z1: number
  readonly x2: number
  readonly y2: number
  readonly z2: number
  /** Horizontal footprint in cm^2; used when picking smallest nested parcel. */
  get footprintCm2() {
    return Math.abs((this.x2 - this.x1) * (this.z2 - this.z1))
  }
  hash: string | undefined
  behaviours: LuaBehaviours | null = null
  loaded = false
  loading = false
  readonly featureBounds: BABYLON.BoundingBox
  readonly hardFeatureBounds: BABYLON.BoundingBox // Bounding box beyond the parcel bounds. Max distance from parcel bounds that a feature can be moved to.
  readonly exteriorBounds: BABYLON.BoundingBox
  public readonly grid: Grid
  private readonly mesher: ParcelMesher
  private regeneratingFeatures = false
  private collider: BABYLON.Mesh | undefined
  private activated = false
  private activationState = ParcelActivationState.Inactive
  private fieldUpdateTimeout: NodeJS.Timeout | null = null
  private voxelFieldGen = 0
  private readonly refreshVoxels: () => void
  readonly relight: () => void
  private readonly soundSprite: BABYLON.Sound | null = null
  private readonly _parcelBouncer: ParcelBouncer
  private featuresLoaded = false
  private entered = false
  autobuilt = false
  private bakeEventSource: EventSource | null = null
  tilesetTexture: BABYLON.Texture | null = null

  lightmap_url: string | null = null

  get areFeaturesLoaded() {
    return this.featuresLoaded
  }

  constructor(
    scene: BABYLON.Scene,
    parent: BABYLON.TransformNode,
    record: ParcelRecord & {
      spaceId?: string
    },
    grid: Grid,
    mesher?: ParcelMesher,
    isFastboot = false,
    precomputedField?: NdArray<Uint16Array>,
  ) {
    super()
    this.scene = scene
    if (parent.parent) {
      throw new Error('parcel: Constructing with a non-root parent node unsupported - coordinate translation assumptions will break')
    }
    this.parentNode = parent
    this.grid = grid

    if (mesher) {
      this.mesher = mesher
    } else {
      this.mesher = new ParcelMesher(scene)
      // Initialize but don't block constructor - generation will check if ready
      this.mesher.initialize().catch((err) => console.error('Failed to initialize parcel mesher:', err))
    }
    this.isFastboot = isFastboot

    this.id = record.id
    this.spaceId = record.spaceId
    this.address = record.address || 'Unknown address'
    this.x1 = record.x1
    this.x2 = record.x2
    this.y1 = record.y1
    this.y2 = record.y2
    this.z1 = record.z1
    this.z2 = record.z2
    this.kind = record.kind
    this.tileset = record.tileset || undefined
    this.palette = record.palette || undefined
    this.brightness = record.brightness || 1
    this.features = record.features || []
    this.lightmap_url = record.lightmap_url || null
    this.parcel_users = record.parcel_users || []
    this.voxels = record.voxels
    this.geometry = record.geometry
    this.settings = record.settings || {}

    this.autobuild()

    this.updateMeta(record)

    if (!Parcel.defaultSoundSprite && Parcel.audio) {
      try {
        Parcel.defaultSoundSprite = new BABYLON.Sound('parcel-sound-sprite', `${process.env.SOUNDS_URL}/default-parcel-sprite.wav`, this.scene, null, {
          distanceModel: 'exponential',
          spatialSound: true,
          maxDistance: 32,
          rolloffFactor: 1.2,
          refDistance: 3,
        })
        Parcel.audio.addToParcelBus(Parcel.defaultSoundSprite)
      } catch (e) {
        // fails in perf-test
      }
    }

    if (!this.soundSprite) {
      this.soundSprite = Parcel.defaultSoundSprite
    }

    this.content = record

    this.refreshVoxels = throttle(() => this.generate(), 10, { leading: false, trailing: true })
    this.relight = debounce(() => this.generate(), 150)

    this.transform = new BABYLON.TransformNode(`parcel/${this.id}`, scene)
    this.transform.metadata = { isParcel: true }
    this.transform.position.copyFrom(this.boundingBox.center)
    this.transform.position.y = this.min.y

    this.transform.parent = parent

    // Used to work out which parcel meshes belong to (in feature tool editor)
    this.transform['parcel'] = this

    this.budget = new ParcelBudget(this)

    const streetWidth = 4
    const overHeight = 8
    const underHeight = 1
    // this.sandbox is set via `updateMeta()` above
    this.featureBounds = this.sandbox
      ? this.boundingBox
      : new BABYLON.BoundingBox(new BABYLON.Vector3(this.x1 - streetWidth, this.y1 - underHeight, this.z1 - streetWidth), new BABYLON.Vector3(this.x2 + streetWidth, this.y2 + overHeight, this.z2 + streetWidth), parent._worldMatrix)

    const hardFeatureBound = 25

    // in sandbox, set hardBoundingbox to be the featureBounds
    this.hardFeatureBounds = this.sandbox
      ? new BABYLON.BoundingBox(new BABYLON.Vector3(this.x1 - streetWidth, this.y1 - underHeight, this.z1 - streetWidth), new BABYLON.Vector3(this.x2 + streetWidth, this.y2 + overHeight, this.z2 + streetWidth), parent._worldMatrix)
      : new BABYLON.BoundingBox(
          new BABYLON.Vector3(this.x1 - hardFeatureBound, this.y1 - hardFeatureBound, this.z1 - hardFeatureBound),
          new BABYLON.Vector3(this.x2 + hardFeatureBound, this.y2 + hardFeatureBound, this.z2 + hardFeatureBound),
          parent._worldMatrix,
        )

    // fix parcel offset, but leave enough for exterior signage
    const grace = 0.1
    const offset = 0.25

    // this.sandbox is set via `updateMeta()` above
    this.exteriorBounds = this.sandbox
      ? this.boundingBox
      : new BABYLON.BoundingBox(
          new BABYLON.Vector3(this.x1 + offset - grace, this.y1 + offset - grace, this.z1 + offset - grace),
          new BABYLON.Vector3(this.x2 + offset + grace, this.y2 + offset + grace, this.z2 + offset + grace),
          parent._worldMatrix,
        )

    this._parcelBouncer = new ParcelBouncer(this)
    /**
     * record can contain 'bouncerShouldAllowUser' which was set in play.tsx
     * this is when the server has already done a check to know if the user is allowed inside the parcel
     * (The case being that the user is spawning inside the parcel)
     */
    const r = record as ParcelRecord & { bouncerShouldAllowUser?: any }
    r.bouncerShouldAllowUser && this.parcelBouncer.handleNFTAuth(!!r.bouncerShouldAllowUser)
    delete (record as ParcelRecord & { bouncerShouldAllowUser?: boolean }).bouncerShouldAllowUser
    this.summary = record

    // Use pre-computed field if provided (from grid-worker)
    if (precomputedField) {
      // If precomputedField came from worker, it might be a plain object - reconstruct as ndarray
      const fieldData = precomputedField as any
      if (fieldData.data && fieldData.shape && fieldData.stride) {
        this.field = ndarray(fieldData.data, fieldData.shape, fieldData.stride, fieldData.offset)
      } else {
        // Already a proper ndarray
        this.field = precomputedField
      }
    }
  }

  get needsMint() {
    return this.id >= 9100
  }

  async requestMint() {
    try {
      await mintParcel(this)
    } catch (err) {
      console.error('On-chain minting failed:', err)
    }
  }

  get disableField() {
    return !this.grid.hasField
  }

  private autobuild() {
    if (this.disableField) {
      return
    }

    if (this.voxels && this.voxels.length > 0) {
      return
    }

    const builder = new Autobuilder(this)
    builder.build()

    if (!this.voxels) {
      this.voxels = builder.getVoxels()
    }

    if (!this.features.length) {
      this.features = builder.getFeatures()
    }

    this.autobuilt = true
  }

  private static get audio() {
    return window._audio
  }

  private static get pump(): FeaturePump {
    return window.main?.pump as FeaturePump
  }

  get parcelUsers() {
    return this.parcel_users
  }

  /**
   * Returns all wallets set as "contributor"
   */
  public get contributors() {
    return this.parcel_users?.filter((pu) => pu.role == 'contributor').map((pu) => pu.wallet) || []
  }

  // The parcel page info URL
  public get url() {
    return `/parcels/${this.id}`
  }

  /**
   * Returns all wallets set as parcel owner
   */
  get owners() {
    return [this.owner, ...(this.parcel_users?.filter((pu) => pu.role == 'owner').map((pu) => pu.wallet) || [])]
  }

  get canEdit(): boolean {
    if (app.isAdmin()) {
      return true
    }

    if (this.sandbox) {
      return true
    }

    const userWallet = window.user?.wallet?.toLowerCase()
    if (userWallet) {
      const canEditList = [...this.contributors, ...this.owners].map((x) => (x ? x.toLowerCase().trim() : '')).filter((x) => typeof x === 'string' && x.trim())
      if (canEditList.find((w) => userWallet === w)) {
        return true
      }
    }

    // override canEdit if the role has been assigned by the grid socket
    if (this.socketAuth !== undefined) {
      if (this.socketAuth == 'Temporarily Banned') {
        return false
      }
      return !!this.socketAuth && this.socketAuth !== 'Moderator'
    }

    return false
  }

  get isNearby() {
    return this.toCamera().lengthSquared() < NEARBY * NEARBY
  }

  get paletteColors(): BABYLON.Color3[] {
    if (!this.palette) {
      return defaultColors.map(BABYLON.Color3.FromHexString)
    }
    return this.palette.map((c, i) => c || defaultColors[i]).map(BABYLON.Color3.FromHexString)
  }

  get sandbox() {
    return this.kind == 'scratchpad' || this.settings.sandbox === true
  }

  get hostedScripts() {
    return !!this.settings.hosted_scripts
  }

  get fieldShape(): [number, number, number] {
    return getFieldShape(this)
  }

  get parcelBouncer() {
    return this._parcelBouncer
  }

  get activationStatus() {
    return this.activationState
  }

  private _boundingBox: BABYLON.BoundingBox | null = null

  /**
   * Get the parcel's bounding box: min/max in grid coordinates, minimumWorld/maximumWorld in absolute
   */
  get boundingBox(): BABYLON.BoundingBox {
    if (!this._boundingBox) {
      this._boundingBox = new BABYLON.BoundingBox(this.min, this.max, this.parentNode._worldMatrix)
    }
    return this._boundingBox
  }

  // the standalone bounding boxes cache their world vectors from the parent matrix at
  // construction, and a teleport moves the parcels' parent (resetWorldOffset) without them -
  // every world-space bounds check was then shifted by the teleport distance. call this before
  // comparing any of the boxes in world space; it no-ops until the offset actually changes.
  private boundsWorldOffset: BABYLON.Vector3 | null = null
  syncWorldBounds() {
    if (this.boundsWorldOffset?.equalsWithEpsilon(this.parentNode.position, 0.001)) return
    this.boundsWorldOffset = this.parentNode.position.clone()
    for (const box of [this.boundingBox, this.featureBounds, this.hardFeatureBounds, this.exteriorBounds]) {
      box.reConstruct(box.minimum, box.maximum, this.parentNode._worldMatrix)
    }
  }

  get width() {
    return (this.x2 - this.x1) / VoxelSize
  }

  get height() {
    return (this.y2 - this.y1) / VoxelSize
  }

  get depth() {
    return (this.z2 - this.z1) / VoxelSize
  }

  /**
   * Necessary to avoid z-fighting of inner and outer parcels
   * This is the smallest value to avoid the z-fighting, smaller than that and z-fighting is back
   */
  private get ZFightingNudge() {
    return this.kind == 'inner' ? 0.0025 : 0 // magic value
  }

  /**
   * Minimum parcel bound, in grid coordinates
   */
  private get min(): BABYLON.Vector3 {
    return new BABYLON.Vector3(this.x1, this.y1, this.z1)
  }

  /**
   * Minimum parcel bound, in grid coordinates
   */
  private get max(): BABYLON.Vector3 {
    return new BABYLON.Vector3(this.x2, this.y2, this.z2)
  }

  performanceScores() {
    let indicesCount = 0
    indicesCount += this.voxelMesh?.getTotalIndices() || 0
    indicesCount += this.glassMesh?.getTotalIndices() || 0
    indicesCount += this.collider?.getTotalIndices() || 0
    let animated = 0
    let groups = 0
    let collidables = 0

    this.featuresList.forEach((f) => {
      if (f.isAnimated) animated++
      if (f.type === 'group') groups++
      if (f.mesh instanceof BABYLON.AbstractMesh && !f.mesh.isAnInstance) {
        indicesCount += f.mesh?.getTotalIndices() || 0
      }
      if (f.mesh instanceof BABYLON.AbstractMesh && f.mesh.checkCollisions) {
        collidables++
      }
    })

    return {
      triangles: indicesCount / 3,
      animated: animated,
      groups: groups,
      collidables: collidables,
      features: {
        active: this.featuresList.length,
        total: this.features.length,
      },
    }
  }

  pointWithinHardFeatureBounds(point: BABYLON.Vector3): boolean {
    return this.hardFeatureBounds.intersectsPoint(point)
  }

  /**
   * Get the voxel value for the given parcel-relative point.
   * Returns null if the point doesn't point to a voxel in this parcel.
   * Returns 0 if the voxel is empty.
   */
  voxelValueFromPositionInParcel(pos: BABYLON.Vector3): number | null {
    const coord = this.voxelCoordFromPositionInParcel(pos)
    if (coord) {
      return this.field?.get(coord[0], coord[1], coord[2]) ?? null
    }
    return null
  }

  sendPatch(patch: ParcelPatch) {
    if (this.sandbox) return
    this.grid.patchParcel(this.id, patch)
  }

  sendStatePatch(patch: Record<string, any>) {
    if (this.sandbox) return
    this.receiveStatePatch(patch)
    this.grid.patchParcelState(this.id, patch)
  }

  private async summarize() {
    if (this.field) {
      const voxels = getVoxelsFromBuffer(this.field.data.buffer)
      Object.assign(this.summary, { voxels })
    }

    const features = this.featuresList.map((f) => f.description)
    Object.assign(this.summary, { features })
  }

  get isBaked() {
    return this.lightmap_url != null && this.lightmap_url != UNBAKED
  }

  async requestBake(logger?: (message: string) => void) {
    const BAKER_URL = 'https://bake.voxels.com'

    if (!this.canEdit) {
      logger?.('You cannot bake this parcel')
      return
    }

    this.updateLightmapUrl(null)

    this.generateVoxelField()

    await this.summarize()

    // logger('Summary generated...')

    const parcel = this.summary

    try {
      // Start the baking process and get SSE stream
      const response = await fetch(`${BAKER_URL}/bake/${this.id}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ parcel }),
      })

      if (!response.ok) {
        logger?.('Failed to start bake')
        return
      }

      // Check if the response is actually an SSE stream
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('text/event-stream')) {
        logger?.('Response is not an SSE stream')
        return
      }

      logger?.('Baking started, listening for progress...')

      // Handle the SSE stream from fetch response
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        logger?.('No response body')
        return
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              logger?.(data.message || 'Processing...')

              if (data.imagePath) {
                this.handleBakeComplete(BAKER_URL + data.imagePath, logger)
                return
              }
            } catch (error) {
              logger?.(`Error parsing SSE data: ${error}`)
            }
          }
        }
      }
    } catch (error) {
      logger?.(`Failed to start baking: ${error}`)
      // this.updateLightmapStatus('Failed')
    }
  }

  async unbake(regenerate = true) {
    if (!this.isBaked) return
    this.grid.patchParcel(this.id, { lightmap_url: null })
    this.updateLightmapUrl(null)
    if (regenerate) {
      this.generateVoxelField()
    }
  }

  private async handleBakeComplete(imagePath: string, logger?: (message: string) => void) {
    // this.updateLightmapStatus('Baked')
    logger?.('Bake complete')

    if (!imagePath) {
      logger?.('No image path received from bake completion')
      return
    }

    // const imageUrl = `${BAKER_URL}${imagePath}`
    logger?.('Regenerating mesh')

    this.grid.patchParcel(this.id, { lightmap_url: imagePath })
    this.updateLightmapUrl(imagePath)
    this.activateBakedMaterial(logger)
  }

  private activateBakedMaterial(logger?: (message: string) => void) {
    const texture = new BABYLON.Texture(this.lightmap_url, this.scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE, () => {
      this.mesher.generateBaked(this, this.configureBakedVoxelFieldMeshes.bind(this), texture)
      logger?.('Bake applied')
    })
  }

  updateLightmapUrl(lightmap_url: string | null) {
    // receive new lightmap status from server
    this.lightmap_url = lightmap_url
    this.lightmapUpdateObservable.notifyObservers(lightmap_url)
  }

  updateMeta(meta: ParcelRef) {
    this.name = meta.name || undefined
    this.description = meta.description || undefined
    this.suburb = meta.suburb || 'Unknown suburb'
    this.hash = meta.hash || undefined
    this.island = meta.island || 'Unknown island'
    this.owner = meta.owner && typeof meta.owner === 'object' ? (meta.owner as any).owner : (meta.owner ?? '')
    this.parcel_users = meta.parcel_users || []
    this.settings = meta.settings || {}
    this.lightmap_url = meta.lightmap_url || null
  }

  /**
   * Checks if both this parcel and the bottom parcel (if any) are editable
   * @returns true if both parcels are editable
   */
  isMergeableUnit = () => {
    if ((this.kind && this.kind !== 'unit') || this.y1 <= 0) return false
    const parcelCenter = this.exteriorBounds.center

    const height = this.exteriorBounds.maximum.y - this.exteriorBounds.minimum.y
    // find parcel that contains point 2m under this parcel
    const pointUnderTheParcel = parcelCenter.clone().subtractFromFloats(0, height / 2 + 2, 0)
    // Because getParcels returns multiple parcels we want to make sure the parcel is different to the current one
    const bottomParcel = window.user.getParcels(pointUnderTheParcel).filter((p) => p.id != this.id)[0]
    return this.canEdit && !!bottomParcel?.canEdit
  }

  receivePatch(patch: ParcelPatch) {
    if (patch.features) {
      let showboxRemoved = false
      for (const uuid in patch.features) {
        if (!Object.prototype.hasOwnProperty.call(patch.features, uuid)) continue

        const value = patch.features[uuid]

        const feature = this.getFeatureByUuid(uuid)
        if (!value) {
          // DELETE
          const fi = this.features.findIndex((f) => f?.uuid === uuid)
          if (fi > -1) this.features.splice(fi, 1)
          if (feature) {
            if (feature.type === 'showbox') showboxRemoved = true
            const i = this.featuresList.indexOf(feature)
            if (i > -1) {
              this.featuresList.splice(i, 1)
            }
            feature.dispose()
          }
        } else if (feature) {
          // UPDATE
          feature.update(value)
        } else {
          // ADD
          // todo: if feature value is only partial then the create might fail
          this.createFeature(value as FeatureRecord).then()
        }
      }
      // deleting a showbox can promote the next one to primary - refresh all showboxes
      if (showboxRemoved) {
        this.featuresList.forEach((f) => {
          if (f?.type === 'showbox') (f as any).reconcileActiveStream?.()
        })
      }
    }
    if (patch.voxels) {
      if (typeof patch.voxels === 'string') {
        this.voxels = patch.voxels
      } else {
        this.setField(patch.voxels.positions, patch.voxels.value)
        this.voxels = this.field ? getVoxelsFromBuffer(this.field.data.buffer) : undefined
      }

      this.refreshVoxels()
    }

    if (patch.palette) {
      this.palette = patch.palette
      this.refreshPalette()
    }

    if (patch.brightness) {
      this.brightness = patch.brightness
      this.refreshBrightness()
    }

    if ('lightmap_url' in patch) {
      this.updateLightmapUrl(patch.lightmap_url || null)
      // If voxels were also in the patch, refreshVoxels() -> generateVoxelField()
      // will already rebuild the baked mesh. Avoid double-triggering a second
      // baked generation in parallel -- they race on setVoxelMesh().
      if (this.isBaked && !patch.voxels) {
        this.activateBakedMaterial()
      }
    }
  }

  receiveStatePatch(patch: Record<string, Partial<FeatureRecord>>) {
    const showboxLiveMoved = '__showbox_live' in patch
    if (showboxLiveMoved) {
      const live = (patch as Record<string, any>).__showbox_live
      if (live == null) delete (this.state as any).__showbox_live
      else (this.state as any).__showbox_live = live
    }
    Object.entries(patch).forEach(([uuid, value]) => {
      if (uuid === '__showbox_live') return
      const feature = this.getFeatureByUuid(uuid)

      // cache the value in case the feature hasn't loaded yet
      this.state[uuid] = value
      if (feature) {
        feature.receiveState(value)
      }
    })
    if (showboxLiveMoved) {
      this.featuresList.forEach((f) => {
        if (f?.type === 'showbox') (f as any).reconcileActiveStream?.()
      })
    }
  }

  updateLodDistance(distance: number) {
    if (this.voxelMesh) {
      this.voxelMesh.removeLODLevel(null)
      this.voxelMesh.addLODLevel(distance, null)
    }

    if (this.glassMesh) {
      this.glassMesh.removeLODLevel(null)
      this.glassMesh.addLODLevel(Math.min(distance, GLASS_MAX_VIEW_DISTANCE), null)
    }
  }

  getFeatureByUuid(uuid: string) {
    return this.featuresList.find((f) => f && f.uuid === uuid)
  }

  getFeaturesByType(type: string) {
    return this.featuresList.filter((f) => f && f.type === type)
  }

  // First non-angle showbox in parcel content order (not featuresList load order).
  // Skip uuids that were deleted locally but not yet dropped from this.features.
  primaryShowboxUuid(): string | null {
    for (const f of this.features) {
      if (!f || f.type !== 'showbox' || !f.uuid || f.angleMode) continue
      if (this.getFeatureByUuid(f.uuid)) return f.uuid
    }
    for (const f of this.features) {
      if (f?.type === 'showbox' && f.uuid && this.getFeatureByUuid(f.uuid)) return f.uuid
    }
    for (const f of this.featuresList) {
      if (f?.type !== 'showbox' || (f as any).description?.angleMode) continue
      return f.uuid
    }
    for (const f of this.featuresList) {
      if (f?.type === 'showbox') return f.uuid
    }
    return null
  }

  primaryShowbox(): Feature | undefined {
    const id = this.primaryShowboxUuid()
    return id ? this.getFeatureByUuid(id) : undefined
  }

  update(record: Record<string, any>) {
    // legacy
    delete record.contributors
    Object.assign(this, record)

    this.regenerate()
  }

  toCamera(): BABYLON.Vector3 {
    if (this.scene.activeCamera && 'target' in this.scene.activeCamera) {
      return this.transform.position.subtract(this.scene.activeCamera['target'] as BABYLON.Vector3)
    }
    if (this.scene.activeCamera) {
      return this.transform.position.subtract(cameraPosition(this.scene))
    }
    return new BABYLON.Vector3(0, 0, 0)
  }

  updateShader() {
    if (!this.voxelMesh || !this.voxelMesh.material || !(this.voxelMesh.material instanceof BABYLON.ShaderMaterial)) {
      return
    }

    window.environment?.updateShaderProperties(this.voxelMesh.material)
  }

  onTileSetUpdate: BABYLON.Observable<void> = new BABYLON.Observable<void>()

  setBrightness(brightness: number) {
    this.brightness = brightness
    Object.assign(this.content, { brightness })

    this.refreshBrightness()
    this.sendBrightness()
  }

  setPalette(colors: Array<string> | undefined) {
    this.applyPaletteLive(colors)
    this.sendPalette()
    this.onTileSetUpdate.notifyObservers()
  }

  // instant local tint update (no network) - used while dragging the color wheel
  applyPaletteLive(colors: Array<string> | undefined) {
    this.palette = colors
    Object.assign(this.content, { palette: colors })
    this.refreshPalette()
  }

  setTileset(tileset: any) {
    this.tilesetTexture?.dispose()
    this.tilesetTexture = null

    this.tileset = tileset || false

    Object.assign(this.content, { tileset })

    this.sendTileset()
    this.refreshVoxels()
    this.onTileSetUpdate.notifyObservers()
  }

  resetTileSet() {
    this.tilesetTexture?.dispose()
    this.tilesetTexture = null

    if (!this.voxelMesh) {
      console.warn('parcel.resetTileSet: Parcel not meshed')
      return
    }

    this.mesher.resetTileSet(this)
  }

  loadField() {
    this.field = getBufferFromVoxels(this)
  }

  async generate() {
    this.loaded = true

    if (!this.voxels) {
      return
    }

    if (!this.field) {
      this.loadField()
    }

    try {
      await this.generateVoxelField()
    } catch (error: any) {
      console.error(`Error generating voxel field for parcel ${this.id}`, error)
      this.loaded = false
    }
  }

  async createFeature(description: FeatureRecord, rootFeature?: Feature): Promise<Feature> {
    if (!this.featuresActive) {
      throw new Error('createFeature: parcel is not active')
    }

    if (!description) {
      throw new Error('createFeature: feature description is required')
    }

    if (!this.loaded) {
      throw new Error('createFeature: parcel is not loaded')
    }

    if (!this.budget.consume(description)) {
      throw new Error(`feature type ${description.type} is over budget`)
    }

    const feature = createFeature(this.scene, this, description.uuid || uuid(), description)
    this.featuresList.push(feature)

    if (rootFeature) {
      await feature.generateInstance(rootFeature)
    } else {
      await feature.generate()
    }

    // forward the state once feature has loaded
    if (feature.uuid in this.state) {
      feature.receiveState(this.state[feature.uuid])
    }

    this.onFeatureCreated(feature)

    return feature
  }

  destroyFeature(f: Feature) {
    const i = this.featuresList.findIndex((feature) => feature.uuid === f.uuid)

    if (i >= 0) {
      this.budget.unconsume(f)
      this.featuresList.splice(i, 1)
    }

    f.dispose()
  }

  // rootFeature is used for instancing

  onEnter() {
    this.entered = true

    // Enter
    window.connector.sendMetric(Action.Enter, this.id)

    // On user enter the parcel the bouncer will kick the user if they are not allowed;
    this.parcelBouncer.handleUser().then()

    // Record event to surveyor.crvox.com
    recordParcelEvent({
      parcel_id: typeof this.id == 'string' ? this.id : this.id.toString(),
      avatar: { uuid: window.connector.persona.uuid, wallet: window.user.wallet },
      feature: null,
      metadata: null,
      event_type: 'playerenter',
    })

    if (this.featuresList) {
      this.featuresList.forEach((f) => {
        if (f.onEnter) {
          f.onEnter()
        }
      })
    }
  }

  onExit() {
    this.entered = false

    // Exit
    window.connector.sendMetric(Action.Exit, this.id)

    // Record event to surveyor.crvox.com
    recordParcelEvent({
      parcel_id: typeof this.id == 'string' ? this.id : this.id.toString(),
      avatar: { uuid: window.connector.persona.uuid, wallet: window.connector.persona.avatar?.wallet },
      feature: null,
      metadata: null,
      event_type: 'playerleave',
    })

    if (!this.featuresList) {
      return
    }

    this.featuresList.forEach((f) => {
      if (f.onExit) {
        f.onExit()
      }
    })
  }

  unload() {
    this.loaded = false
    this.loading = false

    if (this.voxelMesh) this.dispatchEvent(createEvent('MeshUnloading', this.voxelMesh))
    if (this.glassMesh) this.dispatchEvent(createEvent('MeshUnloading', this.glassMesh))
    if (this.collider) this.dispatchEvent(createEvent('MeshUnloading', this.collider))

    this.tilesetTexture?.dispose()
    this.tilesetTexture = null

    this.featuresList.forEach((feature) => {
      feature.dispose()
    })
    this.transform.getChildren().forEach((c) => c.dispose())
    // null out disposed voxel mesh to ensure a new one is generated next time
    this.voxelMesh = undefined
    this.glassMesh = undefined
    this.collider = undefined

    this.disconnect()
    this.deactivate()
  }

  awaitVoxelMesh = async (timeoutSeconds: number = 10): Promise<void> => {
    return await new Promise<void>((resolve, reject) => {
      const timeoutMs = timeoutSeconds * 1000
      const startTime = Date.now()

      const checkVoxelMesh = () => {
        if (this.voxelMesh) {
          resolve()
        } else if (Date.now() - startTime >= timeoutMs) {
          reject(new Error(`Timeout waiting for voxel mesh after ${timeoutSeconds} seconds`))
        } else {
          setTimeout(checkVoxelMesh, 10)
        }
      }
      checkVoxelMesh()
    })
  }

  async activate() {
    if (this.activationState !== ParcelActivationState.Inactive) {
      return
    }
    this.activationState = ParcelActivationState.Activating
    if (this.grid.fastbootParcel && this.grid.fastbootParcel.id === this.id) {
      /**
       * Race condition hack: on fastboot we might be activating before the voxel mesh has been created
       * so we wait for it here.
       */
      await this.awaitVoxelMesh()
    }

    if (this.voxelMesh && !this.isBaked && !window.graphic?.realisticLighting) {
      // Load tileset for unbaked parcels. Baked parcels already have the lightmap
      // shader material applied by setLightBakedMaterial; stomping it here applies
      // the unbaked shader to a mesh missing the `ambientOcclusion` attribute, which
      // makes vColorValue 0 and the whole parcel render black.
      this.mesher.setVoxelMaterial(this, this.voxelMesh)
    }

    this.activated = true

    // Create features
    await this.generateFeatures()

    // Create scripts
    if (!this.behaviours) {
      this.behaviours = new LuaBehaviours(this)
    }
    // The pump loads features async, so featuresList is empty here. Initing now
    // builds an empty registry and flips connected=true, so onFeaturesLoaded never
    // re-inits. Defer to onFeaturesLoaded; only init now when there's no pump (tests).
    if (!window.main) await this.behaviours.init()
    // On fastBoot we initiate the parcelBouncer and handle the user.
    // handleUser() generates the box around the parcel if not allowed

    this.parcelBouncer.handleUser().then()
  }

  deactivate() {
    if (this.activationState === ParcelActivationState.Inactive || this.activationState === ParcelActivationState.Deactivating) {
      return
    }

    this.activationState = ParcelActivationState.Deactivating
    this.activated = false
    this.featuresActive = false

    const features = this.featuresList.slice()

    this.parcelBouncer.dispose() // dispose the bouncer.

    window.main?.pump.deactivate(this, features, () => {
      this.activationState = ParcelActivationState.Inactive
      this.featuresLoaded = false
    })
  }

  onContextClick() {
    // console.log('not implemented')
    // window.ui?.parcelTabs?.openDefaultTab()
    return true
  }

  // Needed because baked and unbaked parcels have different ways of determining this.
  public isColliderEnabled = () => false

  // async populateVoxelFieldFromGridWorker(data: MeshData | null) {
  //   if (!this.loading) {
  //     // parcel has been unloaded before meshed finished
  //     // or worst case, mesh arrived before loaded task
  //     console.debug(`Parcel ${this.id} received mesh when not in loading state, discarding`)
  //     return
  //   }
  //   if (this.lightmap_status !== 'Baked' || this.disableLightmaps) {
  //     // accept the grid-workers mesh only if we don't have an active lightmap
  //     this.mesher.generate(this, data, this.configureUnbakedVoxelFieldMeshes.bind(this))
  //     this.loaded = true
  //   } else if (!this.loaded) {
  //     await this.generate()
  //   }
  // }

  set(listOfVectors: [x: number, y: number, z: number][], value: number) {
    if (!this.field) {
      // this might not be loaded because the user has just logged in
      this.loadField()
    }

    this.setField(listOfVectors, value)

    // todo - construct a perceptive hash of the lightmap coordinates and compare it to the current lightmap
    //   eg changing a walls block value does not invalidate the lightmap
    // const invalidatesLightmap = true

    // Removes lightmap real good
    this.unbake(false)

    if (this.fieldUpdateTimeout) {
      clearTimeout(this.fieldUpdateTimeout)
    }

    this.fieldUpdateTimeout = setTimeout(() => {
      this.voxels = this.field ? getVoxelsFromBuffer(this.field.data.buffer) : undefined

      this.sendFieldChange(listOfVectors, value)
      this.refreshVoxels()
    }, 5)
  }

  async reload(cb: any = null) {
    this.disconnect()

    let url = `/grid/parcels/${this.id}/`

    if (process.env.NODE_ENV !== 'production') {
      url = process.env.ASSET_PATH + url
    }

    this.loading = true

    const res = await fetch(url, {
      method: 'get',
      cache: 'no-store',
    })
    if (!res.ok) throw res
    const r = (await res.json()) as ApiParcelMessage
    if (!r.success) {
      return
    }

    Object.assign(this, r.parcel)

    this.loaded = true
    this.loading = false

    // console.log(`[parcel-${this.id}] Reloaded parcel`)
    this.loadField()
    this.regenerate()
    this.refreshBrightness()
    this.refreshPalette()

    // allow bringing up of build menu
    if (this.canEdit && !window.user.parcels.includes(this)) {
      window.user.parcels.push(this)
    }

    if (typeof cb === 'function') {
      cb()
    }
  }

  afterUserChange() {
    this.featuresList.forEach((f) => {
      f.afterUserChange()
    })
  }

  authFromSocket(auth: string | undefined) {
    this.socketAuth = auth
    if (this.canEdit && !window.user.parcels.includes(this)) {
      window.user.parcels.push(this)
    } else if (!this.canEdit && window.user.parcels.includes(this)) {
      // remove parcel from `parcels` array
      const i = window.user.parcels.indexOf(this)
      window.user.parcels.splice(i, 1)
    }
  }

  isExternalFeatureInParcel(feature: Feature) {
    this.syncWorldBounds()
    const featureInsideParentParcel = feature.parcel.contains(feature.positionInGrid)
    const featureInsideOurParcel = this.featureBounds.intersectsPoint(feature.absolutePosition)
    return featureInsideOurParcel && !featureInsideParentParcel
  }

  playSound(id: number, position: Feature | BABYLON.Vector3 | any) {
    if (!this.soundSprite) {
      console.warn('Sound sprite not loaded')
      return
    }

    if (id < 16) {
      // play an individual sprite
      const sound = this.soundSprite.clone()
      if (!sound) {
        console.warn('Sound sprite clone failed!')
        return
      }
      Parcel.audio?.addToParcelBus(sound)

      if (position instanceof Feature) {
        sound.setPosition(position.absolutePosition)
      } else if (position instanceof BABYLON.Vector3) {
        sound.setPosition(position)
        // or should position be relative to the parcel????
      } else {
        if (this.scene.activeCamera) sound.setPosition(cameraPosition(this.scene))
      }

      // console.log('playing sound', id * SPRITE_SLICE_DURATION, SPRITE_SLICE_DURATION)
      sound.play(0, id * SPRITE_SLICE_DURATION, SPRITE_SLICE_DURATION)
    }
  }

  /**
   * Tests that a point is in this strict parcel bounds (in grid coordinates).
   * Compared in grid space on purpose: the cached BoundingBox's world vectors are computed once,
   * so every teleport (resetWorldOffset moves the parcels' parent) left them stale and shifted
   * containment by the teleport distance - current-parcel detection went wrong until reload.
   */
  contains(pointInGrid: BABYLON.Vector3): boolean {
    return pointInGrid.x >= this.x1 && pointInGrid.x <= this.x2 && pointInGrid.y >= this.y1 && pointInGrid.y <= this.y2 && pointInGrid.z >= this.z1 && pointInGrid.z <= this.z2
  }

  nerfTriggers() {
    this.featuresList?.map((feature: Feature) => {
      if (!feature.description.isTrigger) {
        return
      }
      // console.log(feature.type, ' Nerfing trigger.')
      feature.removeAllTriggers()
    })
  }

  needsCustomMaterial(): boolean {
    if (this.tileset) return true
    if (Array.isArray(this.palette) && this.palette.length != 0) {
      if (this.palette.length !== defaultColors.length) return true
      if (!this.palette.every((v: string, k: number) => v == defaultColors[k])) return true
    }
    return !!this.brightness && this.brightness !== 1
  }

  /**
   * Convert the given positionInParcel to the given voxel coordinate
   */
  private voxelCoordFromPositionInParcel(pos: BABYLON.Vector3): [number, number, number] | null {
    if (!this.voxelMesh) {
      return null
    }
    if (!this.field) {
      return null
    }

    const voxelIndex = pos
      .subtract(this.voxelMesh.position)
      .subtractFromFloats(0.25, 0.75, 0.25) // this is the point at which points in the voxelmesh start
      .scale(1 / VoxelSize)
      .floor()
      .asArray() as [number, number, number]

    // Bounds checking
    // TS can't handle C-style for loops with --noUncheckedIndexedAccess: https://github.com/microsoft/TypeScript/pull/39560
    for (const i of [0, 1, 2] as const) {
      if (voxelIndex[i] < 0 || voxelIndex[i] >= (this.field.shape[i] ?? 0)) {
        return null
      }
    }

    return voxelIndex
  }

  private sendFieldChange(fieldChange: [number, number, number][], value: number) {
    if (this.autobuilt) {
      this.sendPatch({
        voxels: this.voxels,
      })
    } else {
      // We never have a selection of multiple voxels of different colors/textures;
      // so instead of sending [number,number,number,number][], we send [number,number,number] and a value.
      this.sendPatch({
        voxels: { positions: fieldChange, value },
      })
    }
  }

  // Called by Controls.refreshGravity() to determine whether all of this parcel's colliders are turned on.

  private sendTileset() {
    // Send false to force the operational transformer to update the key
    this.sendPatch({
      tileset: this.tileset || false,
    })
  }

  private sendBrightness() {
    // Send false to force the operational transformer to update the key
    this.sendPatch({
      brightness: this.brightness || 1,
    })
  }

  private sendPalette() {
    this.sendPatch({
      palette: this.palette,
    })
  }

  private featureToCamera(description: FeatureRecord): BABYLON.Vector3 {
    if (description.position) {
      return this.toCamera().subtract(BABYLON.Vector3.FromArray(tidyVec3(description.position)))
    }
    return this.toCamera()
  }

  private refreshPalette() {
    if (!this.voxelMesh) {
      return
    }

    const material = this.voxelMesh.material
    if (!material) return

    // regenerate if we are still using greedy blocks so that we don't change the pallet of surrounding parcels
    if (isShared(material)) return this.refreshVoxels()

    const palette = this.paletteColors

    // realistic lighting (clean mesh): rewrite vertex colors from stored lighting * palette
    if (applyCleanPalette(this.voxelMesh, palette)) {
      if (this.glassMesh) applyCleanPalette(this.glassMesh, palette)
      // stained spill is baked into light RGB - rebake so walls pick up new tint
      this.refreshVoxels()
      return
    }

    if (palette && palette[1] && material instanceof BABYLON.ShaderMaterial) {
      material.setColor3Array('palette', palette)
    }
  }

  private refreshBrightness() {
    if (!this.voxelMesh) {
      return
    }

    // todo - disabled brightness toggle

    // const material = this.voxelMesh.material as BABYLON.ShaderMaterial

    // // regenerate if we are still using greedy blocks so that we don't change the brightness of surrounding parcels
    // if (isShared(material)) return this.refreshVoxels()

    // material.setFloat('brightness', this.brightness || window.environment?.brightness || 1.5)
  }

  /**
   * There is a race condition with parcel.onEnter() where the parcel is entered before the features are generated;
   * This means the features' onEnter() will never fire.
   * @param f
   */
  private onFeatureCreated = (f: Feature) => {
    if (this.entered && f.onEnter) {
      f.onEnter()
    }
  }

  // Generate features
  private async generateFeatures() {
    if (this.featuresActive) {
      return
    }

    this.featuresActive = true

    this.budget.reset()

    if (this.featuresList) {
      this.featuresList.forEach((f) => f.dispose())
    }

    this.featuresList = []

    // debugger

    const featuresList = this.features.slice()

    // De-duplicate - UUIDs *must* be unique
    const uuids = new Set<string>()
    const features: (FeatureRecord & { uuid: string })[] = []
    featuresList
      .filter((f) => f)
      .forEach((f) => {
        f.uuid = f.uuid || uuid()
        if (f.uuid && !uuids.has(f.uuid)) {
          uuids.add(f.uuid)
          features.push(f as FeatureRecord & { uuid: string })
        }
      })

    // If running without the main pump, cerate features synchronously
    if (!window.main) {
      for (let f of features) {
        await this.createFeature(f)
      }
    } else {
      window.main?.pump.activate(this, features, this.onFeaturesLoaded)
    }
  }

  // Arrow so `this` stays the parcel: the pump calls it as tracking.onDone(parcel),
  // which would otherwise bind `this` to the pump's tracking object and bail instantly.
  private onFeaturesLoaded = () => {
    // bail if the parcel gets deactivated before we finish the load
    if (!this.activated) return

    this.featuresLoaded = true
    this.activationState = ParcelActivationState.Active

    if (isMobile()) {
      this.scene.clearCachedVertexData()
      this.scene.cleanCachedTextureBuffer()
    }

    // Boot the behaviour runtime once features are in scene.
    if ((this.entered || this.activated) && this.behaviours && !this.behaviours.connected) {
      this.behaviours.init().catch((err) => console.error('[behaviours] init', err))
    }
  }

  private disconnect() {
    if (this.behaviours) {
      this.behaviours.dispose()
      this.behaviours = null
    }
  }

  private regenerateFeatures() {
    if (!this.activated || this.regeneratingFeatures) {
      return
    }

    this.regeneratingFeatures = true
    this.deactivate()
    this.activate()
    this.regeneratingFeatures = false
  }

  private regenerate() {
    if (!this.loaded) {
      return
    }

    // clear any pending tasks for parcel to avoid weird feature async load race conditions and double rendering
    Parcel.pump.clearParcelTasksForID(this.id)

    // update features
    this.regenerateFeatures()

    // update voxel meshes
    this.generate().then()
  }

  async generateVoxelField() {
    if (!this.voxels || this.voxels.trim() === '') {
      console.debug(`Skipping meshing for parcel ${this.id} - no voxel data`)
      return
    }

    const gen = ++this.voxelFieldGen

    if (window.graphic?.realisticLighting && this.field) {
      const live = this.featuresList?.filter((f) => f.type === 'lantern').map((f) => f.description) ?? []
      const lanterns = (live.length ? live : this.features.filter((f) => f?.type === 'lantern')) as LanternRecord[]

      // Y matches setVoxelMesh so voxel.ts pick/place math is correct
      const off: [number, number, number] = [-this.width / 4 + 0.25, -0.75 + this.ZFightingNudge, -this.depth / 4 + 0.25]
      const pending = !!(this.tileset && !this.tilesetTexture)
      const { opaque, glass } = await buildCleanMesh(this.field, lanterns, this.scene, off, this.id, this.paletteColors, this.tilesetTexture ?? (pending ? createWhiteTexture(this.scene) : undefined))
      if (pending) {
        const mat = opaque.material as BABYLON.StandardMaterial
        const tex = new BABYLON.Texture(process.env.IMG_HOST + '/' + this.tileset!.slice(1), this.scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, () => {
          this.tilesetTexture = tex
          if (opaque.material === mat) mat.diffuseTexture = tex
        })
      }
      if (gen !== this.voxelFieldGen) {
        this.disposeGeneratedMeshes(opaque, glass)
        return
      }
      this.voxelMesh?.dispose()
      this.voxelMesh = opaque
      opaque.parent = this.transform
      opaque.position.set(off[0], off[1], off[2])
      opaque.isPickable = true
      opaque.checkCollisions = opaque.getTotalVertices() !== 0
      opaque.freezeWorldMatrix()
      // glass is solid, same as the baked path
      this.setGlassMesh(glass, { collidable: true, pickable: true })
      if (this.glassMesh) {
        this.glassMesh.position.set(off[0], off[1], off[2])
        this.glassMesh.freezeWorldMatrix()
      }
      this.dispatchEvent(createEvent('MeshLoaded', opaque))
      return
    }

    // Baked parcels use a different worker + mesh topology than unbaked.
    // Running both in parallel races on setVoxelMesh() and can leave the parcel
    // displaying the loser's mesh (black / untextured / wrong tint).
    if (this.lightmap_url && this.isBaked) {
      const url = this.lightmap_url
      const texture = new BABYLON.Texture(
        url,
        this.scene,
        false,
        false,
        BABYLON.Texture.BILINEAR_SAMPLINGMODE,
        () => {
          if (gen !== this.voxelFieldGen) return
          this.mesher.generateBaked(
            this,
            (opaque, glass) => {
              if (gen !== this.voxelFieldGen) {
                this.disposeGeneratedMeshes(opaque, glass)
                return
              }
              this.configureBakedVoxelFieldMeshes(opaque, glass)
            },
            texture,
          )
        },
        () => {
          if (gen !== this.voxelFieldGen) return
          // Lightmap fetch failed -- fall back to unbaked so the parcel is still visible
          this.mesher.generate(this, null, (opaque, glass, collider) => {
            if (gen !== this.voxelFieldGen) {
              this.disposeGeneratedMeshes(opaque, glass, collider)
              return
            }
            this.configureUnbakedVoxelFieldMeshes(opaque, glass, collider)
          })
        },
      )
      return
    }

    this.mesher.generate(this, null, (opaque, glass, collider) => {
      if (gen !== this.voxelFieldGen) {
        this.disposeGeneratedMeshes(opaque, glass, collider)
        return
      }
      this.configureUnbakedVoxelFieldMeshes(opaque, glass, collider)
    })
  }

  private disposeGeneratedMeshes(...meshes: (BABYLON.Mesh | null | undefined)[]) {
    for (const mesh of meshes) {
      if (!mesh) continue
      if (mesh.material && !isShared(mesh.material)) mesh.material.dispose()
      mesh.dispose()
    }
  }

  private configureUnbakedVoxelFieldMeshes(opaque: BABYLON.Mesh, glass: BABYLON.Mesh, collider: BABYLON.Mesh) {
    this.setVoxelMesh(opaque, { collidable: false, pickable: false })
    this.setGlassMesh(glass, { collidable: false, pickable: false })
    this.setCollider(collider, { collidable: true, pickable: true })

    this.isColliderEnabled = () => !!this.collider?.checkCollisions

    if (this.voxelMesh) this.dispatchEvent(createEvent('MeshLoaded', this.voxelMesh))
    if (this.glassMesh) this.dispatchEvent(createEvent('MeshLoaded', this.glassMesh))
  }

  private async configureBakedVoxelFieldMeshes(opaque: BABYLON.Mesh, glass: BABYLON.Mesh) {
    this.setVoxelMesh(opaque, { collidable: true, pickable: true })
    this.setGlassMesh(glass, { collidable: true, pickable: true })
    this.setCollider(null)

    this.collider?.dispose()

    this.isColliderEnabled = () => !!this.voxelMesh?.checkCollisions
    // baked parcels use a different voxel meshing system to normal parcels
    // this bypasses the normal loaded callback, so we need to manually set loaded to true here
    // without loaded = true, feature activation does not work
    this.loaded = true

    if (this.voxelMesh) this.dispatchEvent(createEvent('MeshLoaded', this.voxelMesh))
    if (this.glassMesh) this.dispatchEvent(createEvent('MeshLoaded', this.glassMesh))
    if (this.collider) this.dispatchEvent(createEvent('MeshLoaded', this.collider))
  }

  private setField = (listOfVectors: [number, number, number][], value: number) => {
    if (!this.field) throw new Error('Cannot set field on parcel without field')

    for (const vector of listOfVectors) {
      this.field.set(...vector, value)
    }
  }

  private setVoxelMesh(mesh: BABYLON.Nullable<BABYLON.Mesh>, cfg?: { collidable: boolean; pickable: boolean }) {
    // Don't dispose cached/shared materials - they're used by other parcels
    if (this.voxelMesh?.material && !isShared(this.voxelMesh.material)) {
      this.voxelMesh.material.dispose()
    }
    this.voxelMesh?.dispose()
    if (!mesh) {
      return
    }
    this.voxelMesh = mesh
    this.setCommonMeshProperties(this.voxelMesh, cfg)
    this.voxelMesh.position.set(-this.width / 4, -(1 + this.ZFightingNudge), -this.depth / 4)
    mesh.freezeWorldMatrix()
  }

  private setGlassMesh(mesh: BABYLON.Nullable<BABYLON.Mesh>, cfg?: { collidable: boolean; pickable: boolean }) {
    // Don't dispose cached/shared materials - they're used by other parcels
    if (this.glassMesh?.material && !isShared(this.glassMesh.material)) {
      this.glassMesh.material.dispose()
    }
    this.glassMesh?.dispose()
    if (!mesh) {
      return
    }
    this.glassMesh = mesh
    this.setCommonMeshProperties(this.glassMesh, cfg)
    this.glassMesh.position.set(-this.width / 4, -(1 + this.ZFightingNudge), -this.depth / 4)
    mesh.freezeWorldMatrix()
  }

  private setCollider(mesh: BABYLON.Nullable<BABYLON.Mesh>, cfg?: { collidable: boolean; pickable: boolean }) {
    this.collider?.material?.dispose()
    this.collider?.dispose()
    if (!mesh) {
      return
    }
    this.collider = mesh
    this.collider.metadata = 'teleportable'
    this.collider.visibility = 0
    this.setCommonMeshProperties(this.collider, cfg)

    const offset = new BABYLON.Vector3(-this.width / 4 + 0.25, -0.25, -this.depth / 4 + 0.25)
    this.collider.position.addInPlace(offset)
    mesh.freezeWorldMatrix()
  }

  private setCommonMeshProperties(mesh: BABYLON.Mesh, cfg?: { collidable?: boolean; pickable: boolean }) {
    mesh.parent = this.transform
    mesh.checkCollisions = !!cfg?.collidable && mesh.getTotalVertices() !== 0
    mesh.isPickable = cfg?.pickable || false
    mesh.setEnabled(true)
  }
}
