import type Parcel from './parcel'
import type Grid from './grid'
import type { Mono } from './mono'
import type { Lot } from './monoworker/world'
import { cameraPosition } from './utils/camera'
import { isMobile } from '../common/helpers/detector'

export type StreamStep = { run: () => void | Promise<unknown>; wait?: boolean }

type Resident = {
  lot: Lot | Parcel
  parcel?: Parcel
  stage: 'queued' | 'fetching' | 'building' | 'ready' | 'retiring'
  steps?: Generator<StreamStep>
  next?: IteratorResult<StreamStep>
  pending: number
  blocked?: boolean
  outside?: number
  retry: number
}

export class WorldStream {
  private residents = new Map<number | string, Resident>()
  private grid?: Grid
  private worker?: Mono
  private epoch = 0
  private scanning = false
  private nextScan = 0
  private requests = new Map<AbortController, Resident[]>()
  private commits: Array<{ run: () => void; cancel: () => void }> = []
  private lastPosition?: BABYLON.Vector3
  private radius = Infinity
  private drawDistance = 0
  private nextMeasure = 0
  private observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>>

  constructor(private scene: BABYLON.Scene) {
    this.observer = scene.onAfterRenderObservable.add(() => this.tick())
    scene.onDisposeObservable.addOnce(() => {
      this.clear()
      scene.onAfterRenderObservable.remove(this.observer)
    })
  }

  connect(grid: Grid, worker?: Mono) {
    this.grid = grid
    this.worker = worker
    this.nextScan = 0
  }

  add(parcel: Parcel) {
    const old = this.residents.get(parcel.id)
    if (old?.parcel === parcel) return
    this.residents.set(parcel.id, { lot: parcel, parcel, stage: 'building', steps: parcel.build(), pending: 0, retry: 0 })
  }

  rebuild(parcel: Parcel) {
    parcel.stop()
    this.residents.delete(parcel.id)
    this.add(parcel)
  }

  forget(parcel: Parcel) {
    const entry = this.residents.get(parcel.id)
    if (entry?.parcel === parcel) this.residents.delete(parcel.id)
    parcel.stop()
  }

  clear() {
    this.epoch++
    for (const controller of this.requests.keys()) controller.abort()
    this.requests.clear()
    for (const job of this.commits) job.cancel()
    this.commits.length = 0
    this.lastPosition = undefined
    for (const entry of this.residents.values()) entry.parcel?.stop()
    this.residents.clear()
    this.grid = undefined
    this.worker = undefined
    this.scanning = false
    this.radius = Infinity
    this.drawDistance = 0
    this.nextMeasure = 0
    this.nextScan = 0
  }

  commit<T>(work: () => T): Promise<T> {
    if (!this.grid) return Promise.reject(new DOMException('World released', 'AbortError'))
    return new Promise((resolve, reject) =>
      this.commits.push({
        run: () => {
          try {
            resolve(work())
          } catch (error) {
            reject(error)
          }
        },
        cancel: () => reject(new DOMException('World released', 'AbortError')),
      }),
    )
  }

  private distance(lot: Lot | Parcel, position: BABYLON.Vector3) {
    return Math.hypot(Math.max(lot.x1 - position.x, 0, position.x - lot.x2), Math.max(lot.y1 - position.y, 0, position.y - lot.y2), Math.max(lot.z1 - position.z, 0, position.z - lot.z2))
  }

  private pinned(entry: Resident) {
    const parcel = entry.parcel
    if (!parcel) return false
    const vehicle = window.connector?.controls?.vehicleFeature
    return this.grid?.currentParcel() === parcel || this.grid?.preview?.ids.includes(parcel.id) || (vehicle && !vehicle.disposed && vehicle.parcel === parcel) || (this.grid?.currentW !== 0 && this.grid?.mountedParcel === parcel)
  }

  private scan(position: BABYLON.Vector3) {
    if (!this.worker || this.scanning || this.grid?.currentW !== 0 || this.grid.isolating) return
    this.scanning = true
    const epoch = this.epoch
    this.worker
      .nearbyLots(position.asArray(), this.radius)
      .then((lots) => {
        if (epoch !== this.epoch) return
        for (const lot of lots) {
          if (!this.residents.has(lot.id)) this.residents.set(lot.id, { lot, stage: 'queued', pending: 0, retry: 0 })
        }
      })
      .catch((error) => console.warn('World index unavailable', error))
      .finally(() => {
        if (epoch === this.epoch) this.scanning = false
      })
  }

  private fetch(batch: Resident[]) {
    const worker = this.worker
    if (!worker) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    this.requests.set(controller, batch)
    for (const entry of batch) entry.stage = 'fetching'
    worker
      .fetchLots(
        batch.map((e) => e.lot.id as number),
        controller.signal,
      )
      .then((results) => {
        if (controller.signal.aborted) return
        for (const entry of batch) {
          if (this.residents.get(entry.lot.id) !== entry) continue
          const result = results.find((r) => r.record.id === entry.lot.id)
          if (!result) {
            entry.stage = 'queued'
            entry.retry = performance.now() + 5000
            continue
          }
          const grid = this.grid!
          entry.steps = (function* () {
            const parcel = grid.getByID(result.record.id) || grid.load(result.record, grid, result.field as any)
            if (!parcel) return
            entry.parcel = parcel
            grid.subscribeParcel(parcel.id, true)
            grid.refreshNearestParcels()
            yield* parcel.build()
          })()
          entry.stage = 'building'
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.warn('World fetch failed', error)
        for (const entry of batch) {
          entry.stage = 'queued'
          entry.retry = performance.now() + 5000
        }
      })
      .finally(() => {
        clearTimeout(timeout)
        for (const entry of batch) {
          if (this.residents.get(entry.lot.id) === entry && entry.stage === 'fetching') {
            entry.stage = 'queued'
            entry.retry = performance.now() + 5000
          }
        }
        controller.abort() // Close the worker's AbortSignal port after completion too.
        this.requests.delete(controller)
      })
  }

  private retire(entry: Resident) {
    if (!entry.parcel) {
      this.residents.delete(entry.lot.id)
      return
    }
    entry.parcel.stop()
    entry.stage = 'retiring'
    entry.next = undefined
    entry.steps = entry.parcel.release()
  }

  private advance(entry: Resident): boolean {
    if (entry.blocked) return false
    entry.next ??= entry.steps?.next()
    const step = entry.next
    if (!step || step.done) {
      if (entry.pending) return false
      if (entry.stage === 'retiring') {
        this.residents.delete(entry.lot.id)
        if (entry.parcel) this.grid?.unload(entry.parcel)
      } else entry.stage = 'ready'
      return false
    }
    if (step.value.wait && entry.pending) return false
    entry.next = undefined
    try {
      const result = step.value.run()
      if (result && typeof result.then === 'function') {
        entry.pending++
        entry.blocked = !!step.value.wait
        result
          .catch((error) => {
            if (this.residents.get(entry.lot.id) === entry && entry.stage !== 'retiring') console.warn(`Parcel ${entry.lot.id} build step failed`, error)
          })
          .finally(() => {
            entry.pending--
            entry.blocked = false
          })
      }
    } catch (error) {
      console.warn(`Parcel ${entry.lot.id} build step failed`, error)
    }
    return true
  }

  private measure() {
    // An estimate of resident buffers/textures, not browser GPU memory introspection.
    let bytes = 0
    for (const entry of this.residents.values()) bytes += entry.parcel?.field?.data.byteLength || 0
    for (const mesh of this.scene.meshes) bytes += mesh.getTotalVertices() * 48 + mesh.getTotalIndices() * 4
    for (const texture of this.scene.getEngine().getLoadedTexturesCache()) bytes += texture.width * texture.height * 4 * (texture.generateMipMaps ? 4 / 3 : 1)
    if (bytes > (isMobile() ? 256 : 768) * 1024 * 1024) this.radius = Math.max(Math.min(32, this.drawDistance), this.radius * 0.8)
  }

  private tick() {
    if (!this.grid || !this.scene.activeCamera) return
    const now = performance.now()
    const position = cameraPosition(this.scene)
    const distance = window.draw?.distance || 128
    if (distance !== this.drawDistance) {
      this.drawDistance = distance
      this.radius = distance
    }
    if (now >= this.nextMeasure) {
      this.nextMeasure = now + 1000
      this.measure()
    }
    if (now >= this.nextScan) {
      this.nextScan = now + 250
      this.grid.refreshNearestParcels()
      this.grid.refreshEnteredParcel()
      this.scan(position)
    }

    const teleported = !!this.lastPosition && BABYLON.Vector3.Distance(position, this.lastPosition) > this.radius * 1.5
    this.lastPosition ??= position.clone()
    this.lastPosition.copyFrom(position)
    const deadline = performance.now() + 2
    const current = this.grid.currentOrNearestParcel()
    const direction = this.scene.activeCamera.getForwardRay().direction
    const builds: Array<{ entry: Resident; priority: number }> = []
    const retiring: Resident[] = []
    const fetches: Resident[] = []
    for (const entry of this.residents.values()) {
      const d = this.distance(entry.lot, position)
      const pinned = this.pinned(entry)
      if (entry.stage !== 'retiring') {
        if (pinned || d <= this.radius * 1.5) entry.outside = undefined
        else entry.outside ??= now
        const pressure = this.radius < this.drawDistance && d > this.radius
        if (!pinned && ((teleported && d > this.radius * 1.5) || pressure || (entry.outside !== undefined && now - entry.outside >= 10000))) this.retire(entry)
      }
      if (entry.stage === 'queued' && d <= this.radius && now >= entry.retry) fetches.push(entry)
      if (entry.blocked || !entry.steps) continue
      if (entry.stage === 'retiring') {
        retiring.push(entry)
        continue
      }
      if (entry.stage !== 'building') continue
      const dx = (entry.lot.x1 + entry.lot.x2) / 2 - position.x
      const dz = (entry.lot.z1 + entry.lot.z2) / 2 - position.z
      const priority = entry.parcel === current ? -Infinity : d + (dx * direction.x + dz * direction.z < 0 ? 16 : 0)
      builds.push({ entry, priority })
    }
    for (const [controller, batch] of this.requests) {
      if (batch.every((entry) => this.residents.get(entry.lot.id) !== entry)) controller.abort()
    }
    if (this.requests.size < 2 && fetches.length) {
      fetches.sort((a, b) => this.distance(a.lot, position) - this.distance(b.lot, position))
      this.fetch(fetches.slice(0, 4))
    }
    // Alternate construction and disposal so neither can monopolize a frame.
    builds.sort((a, b) => a.priority - b.priority)
    while (performance.now() < deadline && (builds.length || retiring.length || this.commits.length)) {
      this.commits.shift()?.run()
      if (performance.now() >= deadline) break
      const next = builds[0]?.entry
      if (next) {
        if (!this.advance(next)) builds.shift()
      } else builds.length = 0
      if (performance.now() >= deadline) break
      const old = retiring[0]
      if (old && !this.advance(old)) retiring.shift()
    }
  }
}
