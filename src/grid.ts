import { cameraPosition } from './utils/camera'
import Parcel, { ParcelActivationState } from './parcel'
import { isMobile, wantsIsolate } from '../common/helpers/detector'
import { sortBy, throttle } from 'lodash'
import { distanceToAABB } from './utils/boundaries'
import Cookies from 'js-cookie'
import { SocketClient } from './utils/socket-client'
import { displaySuspendedMessage } from './ui/suspended-message'
import type { NdArray } from 'ndarray'
import {
  GridClientMessage,
  GridMessage,
  LightMapUpdateMessage,
  ParcelAuthMessage,
  ParcelHashMessage,
  ParcelMetaMessage,
  ParcelScriptMessage,
  PatchErrorMessage,
  PatchMessage,
  PatchStateMessage,
  SuspendedMessage,
} from '../common/messages/grid'
import { createComlinkWorker, createMessageHandler } from '../common/helpers/comlink-worker'
import { GridWorkerAPI, GridWorkerOutput, GridWorkerParcelLoaded, GridWorkerParcelUnloaded, GridWorkerQueryResponse } from './grid-worker'
import { app, AppEvent } from '../web/src/state'
import { LightmapStatus, ParcelPatch, ParcelRecord } from '../common/messages/parcel'
import { GraphicLevels } from './graphic/graphic-engine'
import { PanelType } from '../web/src/components/panel'
import { DeferredPromise } from 'p-defer'
import { ParcelMesher } from './parcel-mesher'
import { Environment } from './enviroments/environment'
import { TypedEvent } from './utils/EventEmitter'
import { ParcelEventMap } from './utils/parcel-event-map'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'
import { SpacesEnvironment } from './enviroments/space-environment'

const MAX_EDIT_DISTANCE = 5
const { setInterval } = window

const getGridUrl = (spaceId: string | null): string => {
  let url

  if (process.env.GRID_SOCKET_URI) {
    url = process.env.GRID_SOCKET_URI
  } else {
    const protocol = location.protocol == 'http:' ? 'ws:' : 'wss:'
    url = `${protocol}//${window.location.host}/grid/socket`
  }

  const queryParams: Record<string, string> = {}

  if (spaceId) {
    queryParams['space_id'] = spaceId
  }

  // or should this use the localStorage one??

  try {
    var jwtKey = Cookies.get('jwt')
  } catch (e) {
    console.error('Error getting jwt', e)
  }

  if (jwtKey) {
    queryParams['auth_token'] = jwtKey || ''
  }

  url +=
    '?' +
    Object.entries(queryParams)
      .map(([key, value]) => `${key}=${value}`)
      .join('&')

  return url
}

const DEFAULT_UPDATE_INTERVAL_MS = 200

export default class Grid extends SocketClient {
  // ParcelManager properties - folded into Grid
  public fastbootParcel: Parcel | undefined
  public parcels: Map<Parcel['id'], Parcel> = new Map()
  private readonly parcelMeshLoadedEventHandler: (event: TypedEvent<'MeshLoaded', ParcelEventMap['MeshLoaded']>) => void
  private readonly parcelMeshUnloadedEventHandler: (event: TypedEvent<'MeshUnloading', ParcelEventMap['MeshUnloading']>) => void

  public enteredParcel: Parcel | undefined = undefined
  public priorParcel: Parcel | undefined = undefined
  public parent: BABYLON.TransformNode
  public currentIsland: string | undefined = undefined
  public parcel_events = new TypedEventTarget<{ parcel_entered: Parcel['id']; parcel_exited: Parcel['id'] }>()
  private readonly scene: BABYLON.Scene
  private readonly environment: Environment
  static mesher: ParcelMesher
  private lastParcelScanAt?: number
  private nearestParcels: Array<Parcel> = []
  //@todo: refactor the whole system to be more consistent btw onEnter,onNearby,onExit
  private activeParcelPool: Array<Parcel> = []
  // list of parcels within the activeParcelPool that are nearby (using a radius).
  private parcelsWithinProximity: Array<Parcel> = []
  private workerAPI: GridWorkerAPI | undefined = undefined
  private workerCleanup: (() => void) | undefined = undefined
  private isWorker = true
  private _workerReadyPromise: Promise<void> | undefined = undefined
  private subscriptions: Set<number> = new Set()
  private pingInterval?: number
  private _workerInterval?: number // You'd think "ReturnType<typeof setInterval>" would work, wouldn't you.
  private readonly isolateMode: boolean
  private intervals: number[] = []
  private _queryJobs = new Map<number, DeferredPromise<number[]>>()
  private _nextQueryId = 0
  private mesherInitPromise: Promise<void> | undefined = undefined

  constructor(scene: BABYLON.Scene, parent: BABYLON.TransformNode, environment?: Environment, spaceId?: string) {
    super('grid', () => getGridUrl(spaceId || null))
    this.scene = scene

    if (!Grid.mesher) {
      Grid.mesher = new ParcelMesher(scene)
      this.mesherInitPromise = Grid.mesher.initialize()
    }
    // this.mesher = mesher
    this.parent = parent

    if (environment) {
      this.environment = environment
    } else {
      this.environment = new SpacesEnvironment(parent, scene)
    }

    // Initialize ParcelManager event handlers
    this.parcelMeshLoadedEventHandler = (event) => {
      if (!event.detail) return
      this.environment.parcelMeshesAdded([event.detail])
    }

    this.parcelMeshUnloadedEventHandler = (event) => {
      if (!event.detail) return
      this.environment.parcelMeshesRemoved([event.detail])
    }

    this.isolateMode = wantsIsolate()
    // listen for graphics level changes, and regen baked parcels on change
    window.graphic?.addEventListener(
      'settingsChanged',
      throttle(
        async () => {
          // graphics levels have changed, so we need to refresh all baked parcels
          // prioritising the current parcel
          const current = this.currentOrNearestParcel()

          // now regen the rest (but don't wait for them)
          this.filter((p) => p !== current).forEach((p) => {
            p.generate()
          })
        },
        300,
        { leading: true, trailing: true },
      ),
      { passive: true },
    )

    this.addInterval(this.refreshActiveParcels.bind(this), isMobile() ? 2e3 : DEFAULT_UPDATE_INTERVAL_MS)
    this.addInterval(this.refreshEnteredParcel.bind(this), DEFAULT_UPDATE_INTERVAL_MS)
    this.addInterval(this.refreshNearestParcels.bind(this), isMobile() ? 5e3 : 1e3)

    if (this.seeksConnection) {
      this.connect()
      this.listenToLeaveWorld()

      // make sure that we reload the parcels, including the fastboot one, so that editing works in isolate mode and
      // other scenarios where the users logs in or out
      const refresh = (requester?: string) => () => {
        console.debug(`[grid] refreshing parcels after ${requester} event`)
        this.refreshActiveParcels()
        this.refreshEnteredParcel()
        if (this.enteredParcel) {
          // call enter event on entered parcel so that surveyor and bouncer can activate as neccessary
          this.enteredParcel.onEnter()
        }
      }
      app.on(AppEvent.Login, refresh('login'))
      app.on(AppEvent.Logout, refresh('logout'))
    }

    // Set up ParcelManager event listeners
    window.draw?.addEventListener(
      'distance-changed',
      (e) => {
        // update lods
        this.parcels.forEach((parcel) => {
          parcel.updateLodDistance(e.detail)
        })
      },
      { passive: true },
    )

    // refresh shader data (fog distance)
    window.environment?.addEventListener(
      'fog-updated',
      throttle(() => {
        this.parcels.forEach((parcel) => {
          parcel.updateShader()
        })
      }, 300),
      { passive: true },
    )
  }

  get seeksConnection() {
    return !window.config.isOrbit
  }

  // ParcelManager methods - folded into Grid
  get length() {
    return this.parcels.size
  }

  load(parent: BABYLON.TransformNode, description: ParcelRecord, grid: Grid, fieldBuffer?: NdArray<Uint16Array>): Parcel | undefined {
    return this.create(parent, description, grid, false, fieldBuffer)
  }

  loadFastboot(parent: BABYLON.TransformNode, description: ParcelRecord, grid: Grid): Parcel | undefined {
    const p = this.create(parent, description, grid, true)
    if (p) this.fastbootParcel = p
    return p
  }

  unload(parcel: Parcel) {
    // clear any pending tasks for this parcel
    window.main?.pump.clearParcelTasksForID(parcel.id)

    const gridParcel = this.parcels.get(parcel.id)
    if (!gridParcel) {
      // parcel is not in the grid
      return
    }
    this.parcels.delete(parcel.id)
    gridParcel.removeEventListener('MeshLoaded', this.parcelMeshLoadedEventHandler)
    gridParcel.removeEventListener('MeshUnloading', this.parcelMeshUnloadedEventHandler)

    gridParcel.unload()

    if (this.fastbootParcel?.id == parcel.id) {
      this.fastbootParcel = undefined
    }

    const userIndex = window.user.parcels.indexOf(parcel)
    if (userIndex >= 0) {
      window.user.parcels.splice(userIndex, 1)
    }
  }

  getByID(id: number): Parcel | undefined {
    // check the fastboot: this fixes race condition with shared state when parcels have not yet loaded
    if (this.fastbootParcel && this.fastbootParcel.id === id) return this.fastbootParcel
    return this.parcels.get(id)
  }

  getAllParcelsByDistance(): Parcel[] {
    return sortBy(Array.from(this.parcels.values()), (p: Parcel) => p.toCamera().lengthSquared())
  }

  isolate(isolated: Parcel | undefined) {
    // unload all parcels except the one passed
    for (const parcel of this.parcels.values()) {
      if (isolated && parcel.id === isolated.id) continue
      this.unload(parcel)
    }
  }

  forEach(callbackfn: (value: Parcel) => void): void {
    for (const parcel of this.parcels.values()) {
      callbackfn(parcel) // be aware that this does not honour the array forEach spec
    }
  }

  filter(predicate: (p: Parcel) => boolean): Parcel[] {
    const result: Parcel[] = []
    for (const parcel of this.parcels.values()) {
      if (predicate(parcel)) {
        result.push(parcel)
      }
    }
    return result
  }

  private create(parent: BABYLON.TransformNode, description: ParcelRecord, grid: Grid, isFastboot: boolean, fieldBuffer?: NdArray<Uint16Array>): Parcel | undefined {
    const existing = this.parcels.get(description.id)
    if (existing) {
      return undefined
    }
    const p = new Parcel(this.scene, parent, description, grid, Grid.mesher, isFastboot, fieldBuffer)
    p.addEventListener('MeshLoaded', this.parcelMeshLoadedEventHandler, { passive: true })
    p.addEventListener('MeshUnloading', this.parcelMeshUnloadedEventHandler, { passive: true })
    this.parcels.set(p.id, p)
    if (p.sandbox || p.canEdit) {
      window.user.parcels.push(p)
    }
    return p
  }

  public get isWorkerRunning() {
    return !!this.workerAPI
  }

  private get activePoolSize() {
    if (this.isolateMode) return 1
    const settings = window.graphic?.getSettings()

    if (!settings?.level) {
      return 3
    }

    if (settings.level <= GraphicLevels.Low) {
      return 3
    }

    // Use custom max active parcels if in Custom graphics mode
    if (settings.level === GraphicLevels.Custom && settings.customMaxActiveParcels !== undefined) {
      return settings.customMaxActiveParcels
    }

    // Default calculation with a max cap of 30 to prevent performance issues
    return Math.min(30, Math.ceil(window.draw.distance / 12))
  }

  private get nearbyDistance() {
    // isolate keeps activePoolSize at 1; still need normal draw distance so the worker finds the parcel mesh
    if (this.isolateMode) return window.draw.distance
    if (window.config.isOrbit) return 40
    // In Custom mode, parcel activation distance is same as draw distance
    return window.draw.distance
  }

  private get unloadDistance() {
    if (window.config.isOrbit) return 45
    // Unload distance is 10% more than draw distance to avoid flickering
    return window.draw.distance * 1.1
  }

  public async loadFastbootFromHTML() {
    if (this.mesherInitPromise) await this.mesherInitPromise

    const el = document.querySelector('script#parcel') ?? document.querySelector('script#space')
    if (!el) return

    let desc: any
    try {
      desc = JSON.parse(el.innerHTML)
    } catch {
      return
    }

    if (el.id === 'space') {
      Object.assign(desc, desc.content)
      desc.x1 = -desc.width / 2
      desc.x2 = desc.width / 2
      desc.z1 = -desc.depth / 2
      desc.z2 = desc.depth / 2
    }

    const p = this.loadFastboot(this.parent, desc, this)
    if (!p) return

    p.generate()
    this.nearestParcels = [p]
    this.refreshActiveParcels()
    this.refreshEnteredParcel()

    if (el.id === 'space' && this.environment instanceof SpacesEnvironment) {
      this.environment.applyEnvironment(desc.environment)
    }
  }

  public patchParcel(parcelId: number, patch: ParcelPatch) {
    if (!this.isOpen) {
      return this.displayPatchError()
    }
    this.sendMessage({
      type: 'patch',
      parcelId,
      patch,
    })
  }

  public deleteFeature(parcelId: number, featureUuid: string, currentParcelId: number) {
    if (!this.isOpen) {
      return this.displayPatchError()
    }
    this.sendMessage({
      type: 'delete-feature',
      parcelId,
      featureUuid,
      currentParcelId,
    })
  }

  public patchParcelState(parcelId: number, patch: Record<string, any>) {
    this.sendMessage({
      type: 'patch-state',
      parcelId,
      patch,
    })
  }

  public nearestEditableParcel(): Parcel | undefined {
    if (!this.scene.activeCamera) {
      return undefined
    }
    const position = cameraPosition(this.scene)
    const currentParcel = this.currentOrNearestParcel()
    if (currentParcel && currentParcel.canEdit && (currentParcel.contains(position) || this.length <= 1)) {
      // the easy case!
      return currentParcel
    }

    // bias towards the parcel we are looking at
    const forwardRay = this.scene.activeCamera.getForwardRay()
    const point = forwardRay.origin.add(forwardRay.direction.multiplyByFloats(3, 3, 3))

    return this.getNearest(32, point).find((p) => p.canEdit && distanceToAABB(point, p.exteriorBounds) < MAX_EDIT_DISTANCE)
  }

  public refreshNearestParcels() {
    this.currentParcel(true)
    this.nearestParcels = this.getAllParcelsByDistance()

    // did we change closest island
    if (this.nearestParcels.length && this.currentIsland !== this.nearestParcels[0]?.island) {
      this.currentIsland = this.nearestParcels[0]?.island
    }
  }

  public currentParcel(forceScan = false): Parcel | undefined {
    if (!this.scene.activeCamera) {
      return undefined
    }

    // return the isolate or space as current parcel
    if (this.length === 0 || (this.length === 1 && this.fastbootParcel)) return this.fastbootParcel

    // handle selecting spawn parcel when still loading grid
    if (this.fastbootParcel?.contains(cameraPosition(this.scene))) {
      this.priorParcel = this.fastbootParcel
      return this.priorParcel
    }

    // In the presence of nested (inner vs. shell) parcels, exiting early when we are still inside the same
    // parcel is unsafe: We could have moved from the shell to the inner parcel. Little perf loss since
    // we still only update at most every 200ms.
    const timeSinceLastScan = (this.lastParcelScanAt && Date.now() - this.lastParcelScanAt) || Infinity

    if (!forceScan && timeSinceLastScan < DEFAULT_UPDATE_INTERVAL_MS) {
      // Return the last parcel if it has been less than 200ms since we last checked
      return this.priorParcel
    }

    this.lastParcelScanAt = Date.now()

    // find new current parcel
    // If multiple nested parcels contain the camera (possible with shell parcels), choose the smallest
    // (which must be the most nested)
    let containingParcel: Parcel | undefined = undefined
    for (const p of this.nearestParcels) {
      if (!p.contains(cameraPosition(this.scene))) continue

      if (!containingParcel || p.footprintCm2 < containingParcel.footprintCm2) {
        containingParcel = p
      }
    }

    // if not inside parcel, but last parcel is less than 2 meters away, stick with that
    if (!containingParcel && this.priorParcel && distanceToAABB(cameraPosition(this.scene), this.priorParcel.exteriorBounds) < 2) {
      containingParcel = this.priorParcel
    }

    this.priorParcel = containingParcel
    return containingParcel
  }

  public nearestParcel(): Parcel | undefined {
    return this.getNearest(10, this.getCameraPosition())[0]
  }

  public currentOrNearestParcel(): Parcel | undefined {
    let parcel = this.currentParcel() || this.nearestParcel()

    // If shell parcel and can't edit, get inner parcel instead
    if (parcel && parcel.kind == 'outer' && !parcel.canEdit) {
      parcel = this.nearestInnerParcel()
    }

    return parcel
  }

  public getTargetParcel(): Parcel | undefined {
    if (window.config.isSpace) {
      return this.currentOrNearestParcel()
    }
    if (!this.scene.activeCamera) {
      return undefined
    }

    const ray = this.scene.activeCamera.getForwardRay(30)
    const pickInfo = this.scene.pickWithRay(ray)

    // if we are looking at something that is closer than 30 meters away, use that as parcel reference,
    // otherwise use the parcel 5 m in front of camera
    return this.getNearest(16, (pickInfo && pickInfo.pickedPoint) || this.getPointInFrontOfCamera(5))[0]
  }

  public getNearest(count: number, point?: BABYLON.Vector3): Array<Parcel> {
    const target = point ?? this.getCameraPosition()

    // to make tower activation work better, treat parcels on the same y plane as closer (using yMultiplier)
    const distanceOptions = { yMultiplier: 0.8 }

    // sort 32 nearest by bounding box so that we get most accurate results when walking between parcels
    return sortBy(this.nearestParcels.slice(0, count), (p: Parcel) => distanceToAABB(target, p.exteriorBounds, distanceOptions))
  }

  // Calls out to the worker. Returns a promise to an array of parcel IDs, since multiple parcels can contain a point.
  public queryParcelsAtPosition(pos: BABYLON.Vector3): Promise<number[]> {
    // Wait for worker to be ready if it's not yet
    const workerPromise = this._workerReadyPromise || Promise.resolve()

    return workerPromise.then(() => {
      if (!this.workerAPI) {
        throw new Error('queryParcelsAtPosition() called before grid-worker started!')
      }

      const queryId = this._nextQueryId++
      return this.workerAPI.queryParcelsAtPosition(queryId, pos.asArray() as [number, number, number]).then((result) => result.parcelIds)
    })
  }

  public loadWorker() {
    const workerPromise = createComlinkWorker<GridWorkerAPI>(
      // Webpack 5 recognizes this exact pattern and automatically compiles TypeScript workers to separate bundles
      () => new Worker(new URL('./grid-worker.ts', import.meta.url)),
      () => import('./grid-worker').then(({ gridWorker }) => gridWorker),
      { debug: true, workerName: 'grid-worker' },
    ).then(({ worker, cleanup, isWorker }) => {
      this.workerAPI = worker
      this.workerCleanup = cleanup
      this.isWorker = isWorker
      this.setupWorker()
    })

    // Store the promise so methods can await it
    this._workerReadyPromise = workerPromise
    return workerPromise
  }

  private setupWorker() {
    if (!this.workerAPI) return

    // Set up message handler
    const messageHandler = createMessageHandler((message: GridWorkerOutput) => this.handleWorkerMessage(message), this.isWorker)
    this.workerAPI.setMessageCallback(messageHandler)

    // Test basic worker communication
    this.workerAPI.init(10, 20)

    this.updateWorkerSettings()
    window.draw.addEventListener('distance-changed', () => this.updateWorkerSettings(), { passive: true })

    const camArr: [number, number, number] = [0, 0, 0]
    this._workerInterval = setInterval(() => {
      this.getCameraPosition().toArray(camArr)
      const frustumPlanes = this.calculateFrustumPlanes()
      // This event now drives parcel loading and unloading on the grid worker
      this.workerAPI?.cameraUpdate(camArr, frustumPlanes)
      window.main?.pump.setCurrentParcel(this.currentParcel())
    }, DEFAULT_UPDATE_INTERVAL_MS)
  }

  private handleWorkerMessage(message: GridWorkerOutput) {
    switch (message.type) {
      case 'QueryResponse':
        this.handleGridQueryResponse(message)
        break
      case 'Loaded':
        this.handleGridParcelLoaded(message)
        break
      case 'Unloaded':
        this.handleGridParcelUnloaded(message)
        break
      default:
        console.warn('Unknown message type:', message)
    }
  }

  // Only used for debugging.
  public unloadWorker() {
    if (this.workerCleanup) {
      console.info('[grid] Terminating the grid-worker')
      clearInterval(this._workerInterval)
      this.workerCleanup()
      this.workerAPI = undefined
      this.workerCleanup = undefined
    }
  }

  public shutdown() {
    this.unloadWorker()
    this.disconnect()
    this.intervals.forEach((id) => clearInterval(id))
    this.activeParcelPool.forEach((parcel) => {
      this.subscribeParcel(parcel.id, false)
    })
    this.forEach((parcel) => {
      this.unload(parcel)
    })
  }

  protected onMessage(ev: MessageEvent<string>) {
    const message = JSON.parse(ev.data) as GridMessage
    switch (message.type) {
      case 'patch':
        this.handleParcelPatch(message)
        break
      case 'patch-error':
        this.handleParcelPatchError(message)
        break
      case 'patch-state':
        this.handleStatePatch(message)
        break
      case 'parcel-hash':
        this.handleParcelHash(message)
        break
      case 'lightmap-status':
        this.handleParcelLightmapStatus(message)
        break
      case 'suspended':
        this.handleSuspended(message)
        break
      case 'parcel-meta':
        this.handleParcelMeta(message)
        break
      case 'parcel-script':
        this.handleParcelScriptUpdate(message)
        break
      case 'parcel-auth':
        this.handleParcelAuth(message)
        break
      case 'pong':
        break
      default:
        // Statically check that we never get here, assuming our types are correct
        const _never: never = message
        console.error('Unexpected message type:', _never)
        throw new Error('Bad message type')
    }
  }

  protected override onConnect() {
    // Grid connection setup - implementation handled by parent class
  }

  protected override onOpen() {
    clearInterval(this.pingInterval)
    this.pingInterval = setInterval(() => this.ping(), 10000)
    // send existing subscription
    this.subscriptions.forEach((parcelId) => {
      this.sendMessage({
        type: 'subscription',
        parcelId,
        subscribed: true,
      })
    })
    // notify parcels that we have changed users for features that are only visible to owners
    this.activeParcelPool.forEach((parcel) => {
      parcel.afterUserChange()
    })
  }

  protected onClose() {
    clearInterval(this.pingInterval)
    return true
  }

  private addInterval(func: () => void, intervalMs: number) {
    this.intervals.push(setInterval(func, intervalMs))
  }

  // This is to make sure we call the 'onExit' event on tab close or when the user leaves the world

  private ping() {
    this.sendMessage({ type: 'ping' })
  }

  private withParcel(parcelId: number, callback: (parcel: Parcel) => void) {
    const parcel = this.getByID(parcelId)
    if (parcel) callback(parcel)
  }

  private handleParcelPatch(message: PatchMessage) {
    console.log('handleParcelPatch', message)
    this.withParcel(message.parcelId, (parcel) => parcel.receivePatch(message.patch))
    // this.
  }

  private handleParcelPatchError(message: PatchErrorMessage) {
    console.log('handleParcelPatchError')

    this.withParcel(message.parcelId, (parcel) => {
      if (message.rollbackHash) {
        parcel.reload(message.rollbackHash)
      }
    })
    this.displayPatchError(message.error)
  }

  private handleStatePatch(message: PatchStateMessage) {
    this.withParcel(message.parcelId, (parcel) => parcel.receiveStatePatch(message.patch))
  }

  private handleParcelHash(_message: ParcelHashMessage) {
    this.withParcel(_message.parcelId, (parcel) => {
      if (parcel.hash !== _message.hash) {
        parcel.reload(_message.hash || undefined, () => {
          this.updateParcelLightmapStatus(parcel, _message.lightmap_url || null)
        })
      }
      // this.handleParcelLightmapStatus(_message as any)
    })
  }

  private handleParcelAuth(message: ParcelAuthMessage) {
    this.withParcel(message.parcelId, (parcel) => {
      if ('auth' in message) {
        parcel.authFromSocket(typeof message.auth !== 'string' ? undefined : message.auth)
      }
      if ('nftAuth' in message) {
        parcel.parcelBouncer.handleNFTAuth(!!message.nftAuth)
      }
    })
  }

  private handleParcelMeta(message: ParcelMetaMessage) {
    this.withParcel(message.parcelId, (parcel) => {
      if (message.meta) {
        parcel.updateMeta(message.meta)
      }
    })
  }

  private handleParcelScriptUpdate(message: ParcelScriptMessage) {
    this.withParcel(message.parcelId, (parcel) => {
      parcel.parcelScript?.scriptWasEdited()
      parcel.parcelScript?.reload()
    })
  }

  private handleParcelLightmapStatus(message: LightMapUpdateMessage) {
    this.withParcel(message.parcelId, (parcel) => {
      if (message.hash) {
        // update the parcel hash to match the one used for baking
        parcel.hash = message.hash
      }
      this.updateParcelLightmapStatus(parcel, message.lightmap_url)
    })
  }

  updateParcelLightmapStatus(parcel: Parcel, lightmap_url: string | null) {
    parcel.lightmapUpdateObservable.notifyObservers(lightmap_url)
    if (lightmap_url === null) {
      parcel.lightmap_url = null
      parcel.generateVoxelField() // regenerate voxel field to clear lightmap UVs
    }
  }
  private handleSuspended(message: SuspendedMessage) {
    // squeeze interface toggle here
    displaySuspendedMessage(message)
  }

  private sendMessage(message: GridClientMessage) {
    // this.send will only send the message if the connection is open, if it's not, it's a NOOP
    this.send(JSON.stringify(message))
  }

  private displayPatchError(error?: string) {
    if (error) {
      app.showSnackbar(error, PanelType.Danger)
    } else {
      alert('Error saving.\n\nPlease reload to continue editing, current edits may be lost. If this persists, try logging out and log back in or jump on discord and report the error.')
    }
  }

  private subscribeParcel(parcelId: number, subscribed: boolean) {
    if (subscribed) {
      this.subscriptions.add(parcelId)
    } else {
      this.subscriptions.delete(parcelId)
    }

    this.sendMessage({
      type: 'subscription',
      parcelId,
      subscribed,
    })
  }

  private refreshEnteredParcel() {
    const parcel = this.currentParcel()
    if (parcel === this.enteredParcel) {
      return
    }

    if (this.enteredParcel) {
      this.enteredParcel.onExit()
      this.parcel_events.dispatchEvent(createEvent('parcel_exited', this.enteredParcel.id))
    }

    this.enteredParcel = parcel

    if (parcel) {
      // call enter event on new parcel
      parcel.onEnter()
      this.parcel_events.dispatchEvent(createEvent('parcel_entered', parcel.id))
    }
  }

  // This might seem useless for the client, but if the user is in a Parcel with Hosted scripting it's useful
  private listenToLeaveWorld = () => {
    window.addEventListener(
      'beforeunload',
      () => {
        this.enteredParcel?.onExit()
      },
      { once: true, passive: true },
    )
  }

  // Edge case for architect island
  private nearestInnerParcel(): Parcel | undefined {
    // Get nearest using pool size of 8 (to make sure we account for bounding boxes)
    // There are no units on architect island.
    return this.getNearest(8, this.getCameraPosition()).filter((p) => p.kind == 'inner')[0]
  }

  private refreshActiveParcels() {
    // Reprioritize pump queue based on current camera position
    const camPos = this.getCameraPosition()

    // 3 gives us currentParcel + the one we are looking at + the one you looked at last (bare minimum for smoothness)
    const currentParcel = this.currentOrNearestParcel()

    // get parcels near camera (to prioritize things close to player)
    const allNearest = this.getNearest(this.activePoolSize, camPos)

    const filteredNearest: Parcel[] = []
    const cap = Math.floor(this.activePoolSize / 2)
    for (const parcel of allNearest) {
      if (filteredNearest.length >= cap) break

      if (parcel === currentParcel) continue

      // reverse the order
      filteredNearest.unshift(parcel)
    }

    // clone the last pool and ensure that our new candidates are at the front
    const newPool = this.activeParcelPool.filter((p) => !filteredNearest.includes(p) && p !== currentParcel)
    filteredNearest.forEach((parcel) => {
      newPool.unshift(parcel)
    })

    if (currentParcel) {
      newPool.unshift(currentParcel)
    }

    newPool.length = Math.min(newPool.length, this.activePoolSize)

    // deactivate parcels no longer needed
    this.activeParcelPool.forEach((parcel) => {
      if (!newPool.includes(parcel) && parcel && parcel.activationStatus !== ParcelActivationState.Inactive) {
        this.subscribeParcel(parcel.id, false)

        parcel.deactivate()
      }
    })

    // activate newly added parcels
    newPool.forEach((parcel) => {
      if (parcel && parcel.loaded && parcel.activationStatus === ParcelActivationState.Inactive) {
        this.subscribeParcel(parcel.id, true)

        parcel.activate()
      }
    })

    this.activeParcelPool = newPool

    const DISTANCE_TO_PROXIMITY = 15
    this.activeParcelPool.forEach((parcel) => {
      // Iterate throught the active pool of parcels to generate a radius of parcels that we want to have script activated.
      // The pros: Around large parcels you won't start scripts of features that are far away
      // The cons: Around small parcels you don't start scripts of features that are somewhat close-ish
      let distanceToPlayer = Infinity
      if (this.scene.activeCamera) {
        distanceToPlayer = distanceToAABB(cameraPosition(this.scene), parcel.exteriorBounds)
      }
      if (this.parcelsWithinProximity.includes(parcel)) {
        // parcel is included in the currently active list of parcel scripts
        if (distanceToPlayer > DISTANCE_TO_PROXIMITY) {
          // parcel is now far away, disconnect scripting engine
          this.parcelsWithinProximity.splice(this.parcelsWithinProximity.indexOf(parcel), 1)
          parcel.onExitNearby()
        }
      } else {
        if (distanceToPlayer <= DISTANCE_TO_PROXIMITY) {
          // new pool parcel has a new parcel
          // Player is in the area of the parcel
          this.parcelsWithinProximity.push(parcel)
          parcel.onEnterNearby()
        }
      }
    })
  }

  private getPointInFrontOfCamera(distance: number): BABYLON.Vector3 {
    if (!this.scene.activeCamera) {
      console.info('[grid] No camera found for grid#getPointInFrontOfCamera')
      return BABYLON.Vector3.Zero()
    }
    const forwardRay = this.scene.activeCamera.getForwardRay()
    return forwardRay.origin.add(forwardRay.direction.multiplyByFloats(distance, 0, distance))
  }

  private getCameraPosition(): BABYLON.Vector3 {
    return cameraPosition(this.scene)
  }

  private calculateFrustumPlanes(): number[][] | undefined {
    if (!this.scene.activeCamera) {
      return undefined
    }

    try {
      // Get the combined transform matrix directly from the camera (as recommended in Babylon.js forums)
      const transformMatrix = this.scene.activeCamera.getTransformationMatrix()

      // Calculate frustum planes from the transform matrix (camera space)
      const frustumPlanes = BABYLON.Frustum.GetPlanes(transformMatrix)

      // Get the world offset to transform from camera space to world space
      const worldOffset = this.parent.position

      // Transform frustum planes from camera space to world space
      // For plane equation ax + by + cz + d = 0, translating by offset (ox, oy, oz):
      // New d = d + normal.dot(offset)
      return frustumPlanes.map((plane) => {
        const newD = plane.d + (plane.normal.x * worldOffset.x + plane.normal.y * worldOffset.y + plane.normal.z * worldOffset.z)
        return [plane.normal.x, plane.normal.y, plane.normal.z, newD]
      })
    } catch (e) {
      // Fallback if frustum calculation fails
      return undefined
    }
  }

  private addParcel(parcelDescription: ParcelRecord, fieldBuffer?: NdArray<Uint16Array>): Parcel | undefined {
    let p: Parcel | undefined

    if (this.fastbootParcel && parcelDescription.id === this.fastbootParcel.id) {
      p = this.fastbootParcel
    } else {
      p = this.load(this.parent, parcelDescription, this, fieldBuffer)
    }

    if (!p) {
      return undefined
    }

    if (p.sandbox || p.canEdit) {
      // do this async
      setTimeout(() => {
        if (!p || p.field) return
        console.log('calling loadField() for parcel', p.id)
        p.loadField()
      }, 10)
    }

    if (this.fastbootParcel && parcelDescription.id === this.fastbootParcel.id) {
      this.fastbootParcel = undefined
    }

    return p
  }

  private handleGridParcelUnloaded(data: GridWorkerParcelUnloaded) {
    window.main?.pump.clearParcelTasksForID(data.parcelId)
    this.withParcel(data.parcelId, (parcel) => {
      // Unload parcel directly - no pump needed
      this.unload(parcel)
    })
  }

  private handleGridQueryResponse(response: GridWorkerQueryResponse) {
    const d = this._queryJobs.get(response.queryId)
    if (d) {
      this._queryJobs.delete(response.queryId)
      d.resolve(response.parcelIds)
    } else {
      console.info(`[grid] Saw query result for unknown queryId ${response.queryId}`)
    }
  }

  private handleGridParcelLoaded(data: GridWorkerParcelLoaded) {
    const parcelToLoad = this.addParcel(data.description, data.fieldBuffer)
    if (!parcelToLoad) return

    // Generate parcel directly - grid-worker already handles flow control
    if (parcelToLoad.isFastboot || parcelToLoad.loaded) {
      this.workerAPI?.handleParcelGenerated(parcelToLoad.id)
      return
    }

    parcelToLoad.loading = true
    parcelToLoad.loaded = false

    // Generate immediately - no pump needed since grid-worker manages concurrency
    parcelToLoad
      .generate()
      .then(() => {
        // Send feedback to grid-worker that this parcel generation is complete
        this.workerAPI?.handleParcelGenerated(parcelToLoad.id)
      })
      .catch((error) => {
        console.error(`[grid] Failed to generate parcel ${parcelToLoad.id}:`, error)
        // Still send feedback to prevent grid-worker from getting stuck
        this.workerAPI?.handleParcelGenerated(parcelToLoad.id)
      })
  }

  private updateWorkerSettings() {
    if (!this.workerAPI) throw new Error('Worker not loaded')

    // this is the main thing that controls GPU memory usage in CV
    // use aggressive unloading on mobile (to prevent crashing)
    this.workerAPI.init(this.nearbyDistance, this.unloadDistance)
  }

  get hasField() {
    return true
  }
}
