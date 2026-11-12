import { decodeCoords } from '../common/helpers/utils'
import { cameraPosition } from './utils/camera'
import { markLoaded } from './utils/loading-done'
import Parcel from './parcel'
import { wantsIsolate } from '../common/helpers/detector'
import { sortBy, throttle } from 'lodash'
import { distanceToAABB } from './utils/boundaries'
import Cookies from 'js-cookie'
import { SocketClient } from './utils/socket-client'
import { displaySuspendedMessage } from './ui/suspended-message'
import type { NdArray } from 'ndarray'
import { GridClientMessage, GridMessage, ParcelAuthMessage, ParcelMetaMessage, ParcelScriptMessage, PatchErrorMessage, PatchMessage, PatchStateMessage, SuspendedMessage } from '../common/messages/grid'
import type { Mono } from './mono'
import { getGridMono } from './mono-pool'
import { app, AppEvent } from '../web/src/state'
import { ParcelPatch, ParcelRecord } from '../common/messages/parcel'
import { PanelType } from '../web/src/components/panel'
import { createSpaceScene, createWorldScene, getWorldTerrain, parcelMeshesAdded, parcelMeshesRemoved, teardownSpaceScene, teardownWorldScene } from './init/world-scene'
import { fetchSpace } from './init/realm'
import type { IslandRecord } from '../common/messages/api-islands'
import { normalizeSpace } from './utils/normalize-space'
import type { MountDesc } from './utils/normalize-space'
import { TypedEvent } from './utils/EventEmitter'
import { ParcelEventMap } from './utils/parcel-event-map'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'

const MAX_EDIT_DISTANCE = 5
const { setInterval } = window

const getGridUrl = (): string => {
  let url

  if (process.env.GRID_SOCKET_URI) {
    url = process.env.GRID_SOCKET_URI
  } else {
    const protocol = location.protocol == 'http:' ? 'ws:' : 'wss:'
    url = `${protocol}//${window.location.host}/grid/socket`
  }

  const queryParams: Record<string, string> = {}

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
  public mountedParcel: Parcel | undefined
  public parcels: Map<Parcel['id'], Parcel> = new Map()
  currentW = 0
  currentSpaceId: string | undefined
  private worldLive = false
  private switching: Promise<void> | null = null

  /** Open world is mounted and no realm switch is in flight - safe to naviport without being overridden. */
  get openWorldReady() {
    return this.currentW === 0 && this.worldLive && !this.switching
  }

  private readonly parcelLoaded: (event: TypedEvent<'MeshLoaded', ParcelEventMap['MeshLoaded']>) => void
  private readonly parcelUnloaded: (event: TypedEvent<'MeshUnloading', ParcelEventMap['MeshUnloading']>) => void

  public enteredParcel: Parcel | undefined = undefined
  public priorParcel: Parcel | undefined = undefined
  public currentIsland: string | undefined = undefined
  public parcel_events = new TypedEventTarget<{ parcel_entered: Parcel['id']; parcel_exited: Parcel['id'] }>()
  private readonly scene: BABYLON.Scene
  private lastParcelScanAt?: number
  private nearestParcels: Array<Parcel> = []
  private workerAPI: Mono | undefined = undefined
  private _workerReadyPromise: Promise<void> | undefined = undefined
  private subscriptions: Set<number | string> = new Set()
  private pingInterval?: number
  private readonly isolateMode: boolean

  get isolating() {
    return this.isolateMode
  }

  constructor(scene: BABYLON.Scene) {
    super('grid', () => getGridUrl())
    this.scene = scene

    this.parcelLoaded = (event) => {
      if (!event.detail) return
      if (this.currentW === 0) parcelMeshesAdded([event.detail])
      // first parcel mesh = world is up. this used to live in reveal(); "Fix reveal"
      // deleted it and the coords-in-URL writer never ran again (it gates on isLoaded).
      markLoaded()
      window.graphic.postProcesses?.reveal()
    }

    this.parcelUnloaded = (event) => {
      if (!event.detail) return
      if (this.currentW === 0) parcelMeshesRemoved([event.detail])
    }

    this.isolateMode = wantsIsolate()
    // listen for graphics level changes
    window.graphic?.addEventListener(
      'settingsChanged',
      throttle(
        async () => {
          const current = this.currentOrNearestParcel()

          current?.generate()
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

    if (this.seeksConnection) {
      this.listenToLeaveWorld()

      const refresh = (requester?: string) => () => {
        if (!this.worldLive) return
        console.debug(`[grid] refreshing parcels after ${requester} event`)
        this.refreshEnteredParcel()
        if (this.enteredParcel) this.enteredParcel.onEnter()
      }
      app.on(AppEvent.Login, refresh('login'))
      app.on(AppEvent.Logout, refresh('logout'))
    }
  }

  get seeksConnection() {
    return true
  }

  // ParcelManager methods - folded into Grid
  get length() {
    return this.parcels.size
  }

  load(description: ParcelRecord, grid: Grid, fieldBuffer?: NdArray<Uint16Array>): Parcel | undefined {
    return this.create(description, grid, fieldBuffer)
  }

  mountParcel(description: MountDesc | ParcelRecord, grid: Grid = this): Parcel | undefined {
    const p = this.create(description, grid)
    if (p) {
      this.mountedParcel = p
      window.main?.stream.connect(this, this.workerAPI)
      window.main?.stream.add(p)
      this.subscribeParcel(p.id, true)
    }
    return p
  }

  unload(parcel: Parcel) {
    // clear any pending tasks for this parcel
    window.main?.stream.forget(parcel)
    this.subscribeParcel(parcel.id, false)

    const gridParcel = this.parcels.get(parcel.id)
    if (!gridParcel) {
      // parcel is not in the grid
      return
    }
    this.parcels.delete(parcel.id)
    gridParcel.removeEventListener('MeshLoaded', this.parcelLoaded)
    gridParcel.removeEventListener('MeshUnloading', this.parcelUnloaded)

    gridParcel.unload()

    if (this.mountedParcel?.id == parcel.id) {
      this.mountedParcel = undefined
    }

    const userIndex = window.user.parcels.indexOf(parcel)
    if (userIndex >= 0) {
      window.user.parcels.splice(userIndex, 1)
    }
  }

  // /admin island drops its proposal straight into the live world. these parcels never came from the
  // worker so it never unloads them either, clearPreview does
  preview: { name: string; ids: Set<Parcel['id']> } | null = null

  async previewIsland(island: IslandRecord, parcels: ParcelRecord[], progress?: (done: number) => void) {
    this.clearPreview()
    const preview = { name: island.name, ids: new Set<Parcel['id']>() }
    this.preview = preview
    await getWorldTerrain()?.addIsland(island)
    if (this.preview !== preview) return
    for (const [i, r] of parcels.entries()) {
      if (i && i % 32 === 0) {
        progress?.(i)
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (this.preview !== preview) return
      }
      try {
        const parcel = this.load(r, this)
        if (parcel) {
          preview.ids.add(parcel.id)
          window.main?.stream.add(parcel)
        }
      } catch (e) {
        console.error('preview parcel', r.id, e)
      }
    }
  }

  clearPreview() {
    if (!this.preview) return
    getWorldTerrain()?.removeIsland(this.preview.name)
    for (const id of this.preview.ids) {
      const p = this.parcels.get(id)
      if (p) this.unload(p)
    }
    this.preview = null
  }

  getByID(id: number | string): Parcel | undefined {
    if (this.mountedParcel && this.mountedParcel.id === id) return this.mountedParcel
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

  /** Spawn a parcel for server-side preview (no grid socket / streaming). */
  spawnPreview(description: ParcelRecord): Parcel | undefined {
    return this.create(description, this)
  }

  protected create(description: MountDesc | ParcelRecord, grid: Grid, fieldBuffer?: NdArray<Uint16Array>): Parcel | undefined {
    const existing = this.parcels.get(description.id)
    if (existing) return undefined
    const p = new Parcel(this.scene, null, description as any, grid, fieldBuffer)
    p.addEventListener('MeshLoaded', this.parcelLoaded, { passive: true })
    p.addEventListener('MeshUnloading', this.parcelUnloaded, { passive: true })
    this.parcels.set(p.id, p)
    if (p.sandbox || p.canEdit) {
      window.user.parcels.push(p)
    }
    return p
  }

  public get isWorkerRunning() {
    return !!this.workerAPI
  }

  public async mountParcelFromHTML() {
    const el = document.querySelector('script#parcel')
    if (!el) return

    let desc: any
    try {
      desc = JSON.parse(el.innerHTML)
    } catch {
      return
    }

    const p = this.mountParcel(desc, this)
    if (!p) return

    this.nearestParcels = [p]
    this.refreshEnteredParcel()
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

  currentStreet() {
    if (this.currentW !== 0 || !this.scene.activeCamera) return
    const { x, z } = cameraPosition(this.scene)
    return getWorldTerrain()?.islands.streetAt(x, z)
  }

  public currentParcel(forceScan = false): Parcel | undefined {
    if (!this.scene.activeCamera) {
      return undefined
    }

    // return the isolate or space as current parcel
    if (this.length === 0 || (this.length === 1 && this.mountedParcel)) return this.mountedParcel

    if (this.mountedParcel?.contains(cameraPosition(this.scene))) {
      this.priorParcel = this.mountedParcel
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
    if (!this.scene.activeCamera) {
      return undefined
    }

    const ray = this.scene.activeCamera.getForwardRay(30)
    const pickInfo = this.scene.pickWithRay(ray)

    // if we are looking at something that is closer than 30 meters away, use that as parcel reference,
    // otherwise use the parcel 5 m in front of camera
    return this.getNearest(16, (pickInfo && pickInfo.pickedPoint) || this.getPointInFrontOfCamera(5))[0]
  }

  /** Parcel whose footprint contains the look-at hit. No nearest/5m fallback (that tagged neighbors onto the wrong lot). */
  public getLookAtParcel(): Parcel | undefined {
    if (!this.scene.activeCamera) {
      return undefined
    }

    const ray = this.scene.activeCamera.getForwardRay(40)
    const pickInfo = this.scene.pickWithRay(ray)
    if (!pickInfo?.pickedPoint) return undefined

    const p = pickInfo.pickedPoint
    let best: Parcel | undefined
    for (const parcel of this.nearestParcels) {
      if (!parcel.contains(p)) continue
      if (!best || parcel.footprintCm2 < best.footprintCm2) best = parcel
    }
    return best
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
    return (this._workerReadyPromise || Promise.resolve()).then(async () => {
      const lots = await this.workerAPI?.nearbyLots(pos.asArray(), 0)
      return lots?.map((lot) => lot.id) || []
    })
  }

  public loadWorker() {
    this._workerReadyPromise = getGridMono().then(async ({ worker }) => {
      this.workerAPI = worker
      await worker.loadIndex()
      window.main?.stream.connect(this, worker)
    })
    return this._workerReadyPromise
  }

  workerLive() {
    return !!this.workerAPI
  }

  public unloadWorker() {
    window.main?.stream.clear()
    this.workerAPI = undefined
  }

  public shutdown() {
    this.unloadWorker()
    this.disconnect()
    this.forEach((parcel) => {
      this.unload(parcel)
    })
    this.nearestParcels = []
    this.priorParcel = undefined
    this.enteredParcel = undefined
    this.worldLive = false
  }

  connectWorld() {
    if (this.worldLive || this.currentW !== 0) return
    if (this.seeksConnection) this.connect()
    this.loadWorker()
    this.worldLive = true
  }

  async switchWorld(w: number, spaceId?: string, resumeCoords?: string): Promise<void> {
    while (this.switching) await this.switching
    this.switching = this.loadWorld(w, spaceId, resumeCoords)
    try {
      await this.switching
    } finally {
      this.switching = null
    }
  }

  private async loadWorld(w: number, spaceId?: string, resumeCoords?: string) {
    if (w === this.currentW) {
      if (w === 0 && this.worldLive) return
      if (w > 0 && spaceId === this.currentSpaceId) return
    }
    if (this.currentW > 0) {
      teardownSpaceScene()
      this.shutdown()
    } else if (this.worldLive) {
      window.connector?.disconnect()
      this.shutdown()
      teardownWorldScene()
    }

    this.currentW = w
    this.currentSpaceId = spaceId

    if (w === 0) {
      await createWorldScene(this.scene)
      this.connectWorld()
      await this._workerReadyPromise
      await this.mountParcelFromHTML()
      if (window.config.isMultiuser) window.connector?.connect()
      const c = resumeCoords
      if (c) window.persona?.moveTo(decodeCoords(c))
      else if (window.connector?.controls) initialWorldSpawn(window.connector.controls)
    } else if (spaceId) {
      createSpaceScene(this.scene)
      if (window.connector?.isOpen) window.connector.disconnect()
      const space = await fetchSpace(spaceId)
      if (!space) return
      const desc = normalizeSpace(space)
      const p = this.mountParcel(desc)
      await p?.generate()
      this.nearestParcels = p ? [p] : []
      this.refreshEnteredParcel()
      spawnSpaceParcel(window.connector?.controls, p)
      const c = resumeCoords
      if (c) window.persona?.moveTo(decodeCoords(c))
    }
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
        parcelId: typeof parcelId === 'number' ? parcelId : 0,
        subscribed: true,
      })
    })
    // notify parcels that we have changed users for features that are only visible to owners
    this.parcels.forEach((parcel) => {
      parcel.afterUserChange()
    })
  }

  protected onClose() {
    clearInterval(this.pingInterval)
    return true
  }

  // This is to make sure we call the 'onExit' event on tab close or when the user leaves the world

  private ping() {
    this.sendMessage({ type: 'ping' })
  }

  private withParcel(parcelId: number | string, callback: (parcel: Parcel) => void) {
    const parcel = this.getByID(parcelId)
    if (parcel) callback(parcel)
  }

  private handleParcelPatch(message: PatchMessage) {
    console.log('handleParcelPatch', message)
    this.withParcel(message.parcelId, (parcel) => parcel.receivePatch(message.patch))
    // this.
  }

  private handleParcelPatchError(message: PatchErrorMessage) {
    this.withParcel(message.parcelId, (parcel) => {
      if (parcel.summary.is_common) void parcel.reload()
    })
    this.displayPatchError(message.error)
  }

  private handleStatePatch(message: PatchStateMessage) {
    this.withParcel(message.parcelId, (parcel) => parcel.receiveStatePatch(message.patch))
  }

  private handleParcelAuth(message: ParcelAuthMessage) {
    this.withParcel(message.parcelId, (parcel) => {
      if ('auth' in message) {
        parcel.authFromSocket(typeof message.auth !== 'string' ? undefined : message.auth)
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
    // Legacy parcel-script reload signal. The QuickJS runtime is gone; behaviours
    // hot-reload by re-attaching when the parcel patches its features list.
    this.withParcel(message.parcelId, (_parcel) => {})
    void message
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

  public subscribeParcel(parcelId: number | string, subscribed: boolean) {
    if (subscribed) {
      this.subscriptions.add(parcelId)
    } else {
      this.subscriptions.delete(parcelId)
    }

    this.sendMessage({
      type: 'subscription',
      parcelId: typeof parcelId === 'number' ? parcelId : 0,
      subscribed,
    })
  }

  public refreshEnteredParcel() {
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

  get hasField() {
    return true
  }
}

function initialWorldSpawn(controls: any) {
  const nudgeL = 5
  const nudgeW = 2
  const alongX = Math.random() < 0.5
  let randomX = Math.random() * (nudgeL * 2) - nudgeL
  let randomZ = Math.random() * (nudgeW * 2) - nudgeW
  if (!alongX) {
    randomX = Math.random() * (nudgeW * 2) - nudgeW
    randomZ = Math.random() * (nudgeL * 2) - nudgeL
  }
  Object.assign(controls.body.position, { x: randomX, y: 2.5, z: randomZ })
}

function spawnSpaceParcel(controls: any, parcel: Parcel | undefined) {
  if (!controls) return
  if (!parcel) {
    Object.assign(controls.body.position, { x: 0, y: 2.5, z: 0 })
    return
  }
  const spawnFeature = parcel.features?.find((f) => f?.type === 'spawn-point')
  if (!spawnFeature) {
    Object.assign(controls.body.position, { x: 0, y: 2.5, z: 0 })
    return
  }
  const pos = spawnFeature.position as number[] | { x: number; y: number; z: number }
  const rot = spawnFeature.rotation as number[] | { x: number; y: number; z: number }
  const px = Array.isArray(pos) ? pos[0] : pos?.x
  const py = Array.isArray(pos) ? pos[1] : pos?.y
  const pz = Array.isArray(pos) ? pos[2] : pos?.z
  const ry = Array.isArray(rot) ? rot[1] : rot?.y
  const roundHalf = (v: number) => Math.round(v * 2) / 2
  const x = roundHalf(parseFloat(String(px || 0)))
  const z = roundHalf(parseFloat(String(pz || 0)))
  const y = parseFloat(String(py || 0)) + 1.75
  Object.assign(controls.body.position, { x, y, z })
  if (controls.camera && ry != null) controls.camera.rotation.y = parseFloat(String(ry))
}
