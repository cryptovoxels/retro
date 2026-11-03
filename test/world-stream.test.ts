import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/utils/camera', () => ({ cameraPosition: (scene: any) => scene.activeCamera.position }))
vi.mock('../common/helpers/detector', () => ({ isMobile: () => false }))
import { WorldStream, type StreamStep } from '../src/world-stream'
import { featureOrder, instanceKey } from '../src/utils'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

let time: number
let scene: any
let grid: any
let stream: WorldStream
function parcel(id = 1, steps: StreamStep[] = []) {
  return {
    id,
    x1: -5,
    x2: 5,
    y1: -5,
    y2: 5,
    z1: -5,
    z2: 5,
    build: vi.fn(function* () {
      yield* steps
    }),
    stop: vi.fn(),
    release: vi.fn(function* () {
      yield { run: () => {} }
    }),
  } as any
}
function frame() {
  scene.onAfterRenderObservable.notifyObservers(scene)
}
async function walk(x: number) {
  while (scene.activeCamera.position.x < x) {
    scene.activeCamera.position.x = Math.min(x, scene.activeCamera.position.x + 50)
    time += 250
    frame()
    await settle()
  }
}
beforeEach(() => {
  time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  scene = {
    onAfterRenderObservable: new BABYLON.Observable(),
    onDisposeObservable: new BABYLON.Observable(),
    activeCamera: { position: new BABYLON.Vector3(), getForwardRay: () => ({ direction: new BABYLON.Vector3(0, 0, 1) }) },
    meshes: [],
    getEngine: () => ({ getLoadedTexturesCache: () => [] }),
  }
  grid = {
    currentW: 0,
    isolating: false,
    currentParcel: vi.fn(),
    currentOrNearestParcel: vi.fn(),
    refreshNearestParcels: vi.fn(),
    refreshEnteredParcel: vi.fn(),
    getByID: vi.fn(),
    load: vi.fn((record: any) => parcel(record.id)),
    subscribeParcel: vi.fn(),
    unload: vi.fn(),
  }
  ;(window as any).draw = { distance: 128 }
  ;(window as any).connector = { controls: {} }
  stream = new WorldStream(scene)
  stream.connect(grid)
})
afterEach(() => {
  stream.clear()
  vi.restoreAllMocks()
})

describe('WorldStream residency', () => {
  it('keeps completed objects while turning and crossing nearby parcel boundaries', async () => {
    const p = parcel()
    stream.add(p)
    frame()
    for (let i = 0; i < 60; i++) {
      scene.activeCamera.getForwardRay = () => ({ direction: new BABYLON.Vector3(Math.sin(i), 0, Math.cos(i)) })
      scene.activeCamera.position.x = i % 20
      time += 250
      frame()
    }
    expect(p.build).toHaveBeenCalledTimes(1)
    expect(p.stop).not.toHaveBeenCalled()
    expect(grid.unload).not.toHaveBeenCalled()
  })

  it('retains a parcel outside the load radius and resets its grace period on return', async () => {
    const p = parcel()
    stream.add(p)
    frame()
    await walk(220)
    time += 9000
    frame()
    expect(p.stop).not.toHaveBeenCalled()
    scene.activeCamera.position.x = 180
    frame()
    await walk(220)
    time += 9000
    frame()
    expect(p.stop).not.toHaveBeenCalled()
    time += 1100
    frame()
    expect(grid.unload).toHaveBeenCalledWith(p)
  })

  it('pins the current parcel and the vehicle home parcel', async () => {
    const p = parcel()
    stream.add(p)
    grid.currentParcel.mockReturnValue(p)
    await walk(600)
    time += 20000
    frame()
    expect(p.stop).not.toHaveBeenCalled()
    grid.currentParcel.mockReturnValue(undefined)
    ;(window as any).connector.controls.vehicleFeature = { parcel: p }
    frame()
    expect(p.stop).not.toHaveBeenCalled()
    ;(window as any).connector.controls.vehicleFeature = null
    frame()
    time += 10001
    frame()
    expect(grid.unload).toHaveBeenCalledWith(p)
  })

  it('invalidates distant work immediately after a teleport', async () => {
    const p = parcel()
    stream.add(p)
    frame()
    scene.activeCamera.position.x = 2000
    frame()
    expect(p.stop).toHaveBeenCalled()
    expect(grid.unload).toHaveBeenCalledWith(p)
  })

  it('shrinks residency under measured resource pressure instead of rotating a parcel pool', async () => {
    const p = parcel()
    p.x1 = 115
    p.x2 = 125
    stream.add(p)
    scene.meshes = [{ getTotalVertices: () => 20_000_000, getTotalIndices: () => 0 }]
    frame()
    expect(grid.unload).toHaveBeenCalledWith(p)
    time += 1000
    frame()
    expect(p.build).toHaveBeenCalledTimes(1)
  })
})

describe('WorldStream scheduling', () => {
  it('uses available frame time, rather than a single item per frame', () => {
    let built = 0
    const steps = Array.from({ length: 10 }, () => ({
      run: () => {
        built++
        time += 0.5
      },
    }))
    stream.add(parcel(1, steps))
    frame()
    expect(built).toBe(4)
    frame()
    expect(built).toBe(8)
  })

  it('starts independent work without waiting for network completion', async () => {
    const wait = deferred()
    const starts = vi.fn(() => wait.promise)
    const done = vi.fn()
    stream.add(parcel(1, [...Array.from({ length: 12 }, () => ({ run: starts })), { run: done, wait: true }]))
    frame()
    expect(starts).toHaveBeenCalledTimes(12)
    frame()
    expect(starts).toHaveBeenCalledTimes(12)
    expect(done).not.toHaveBeenCalled()
    wait.resolve()
    await settle()
    frame()
    expect(starts).toHaveBeenCalledTimes(12)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('builds another parcel while asset requests remain unresolved', () => {
    const network = deferred()
    const starts = vi.fn(() => network.promise)
    const finish = vi.fn()
    stream.add(parcel(1, [...Array.from({ length: 12 }, () => ({ run: starts })), { run: finish, wait: true }]))
    frame()
    expect(starts).toHaveBeenCalledTimes(12)

    const mesh = vi.fn()
    stream.add(parcel(2, [{ run: mesh, wait: true }]))
    frame()
    expect(mesh).toHaveBeenCalledTimes(1)
    expect(finish).not.toHaveBeenCalled()
  })

  it('does not start features until geometry finishes', async () => {
    const mesh = deferred()
    const feature = vi.fn()
    stream.add(parcel(1, [{ run: () => mesh.promise, wait: true }, { run: feature }]))
    frame()
    frame()
    expect(feature).not.toHaveBeenCalled()
    mesh.resolve()
    await settle()
    frame()
    expect(feature).toHaveBeenCalledTimes(1)
  })

  it('continues after one feature fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done = vi.fn()
    stream.add(parcel(1, [{ run: () => Promise.reject(new Error('broken asset')) }, { run: done, wait: true }]))
    frame()
    await settle()
    frame()
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('budgets disposal and construction together', async () => {
    let disposed = 0
    const old = parcel()
    old.release = function* () {
      for (let i = 0; i < 20; i++)
        yield {
          run: () => {
            disposed++
            time += 1
          },
        }
    }
    stream.add(old)
    frame()
    await walk(220)
    const built = vi.fn(() => {
      time += 0.5
    })
    const next = parcel(2, [{ run: built }])
    next.x1 = 215
    next.x2 = 225
    stream.add(next)
    time += 10001
    frame()
    expect(built).toHaveBeenCalledTimes(1)
    expect(disposed).toBeGreaterThan(0)
    expect(disposed).toBeLessThan(20)
  })

  it('invalidates queued GPU uploads on world teardown', async () => {
    const upload = vi.fn()
    const promise = stream.commit(upload)
    const check = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    stream.clear()
    frame()
    await check
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('WorldStream fetching', () => {
  it('aborts obsolete batches and ignores late results after teleporting', async () => {
    const response = deferred<any[]>()
    const worker = { nearbyLots: vi.fn(async () => [parcel()]), fetchLots: vi.fn((_ids: number[], _signal: AbortSignal) => response.promise) }
    stream.connect(grid, worker as any)
    frame()
    await settle()
    frame()
    expect(worker.fetchLots).toHaveBeenCalledTimes(1)
    const signal = worker.fetchLots.mock.calls[0][1] as AbortSignal
    scene.activeCamera.position.x = 2000
    frame()
    expect(signal.aborted).toBe(true)
    response.resolve([{ record: { id: 1 } }])
    await settle()
    frame()
    expect(grid.load).not.toHaveBeenCalled()
  })

  it('does not construct fetched parcels until the frame scheduler runs', async () => {
    const worker = { nearbyLots: vi.fn(async () => [parcel()]), fetchLots: vi.fn(async () => [{ record: { id: 1 } }]) }
    stream.connect(grid, worker as any)
    frame()
    await settle()
    frame()
    await settle()
    expect(grid.load).not.toHaveBeenCalled()
    frame()
    expect(grid.load).toHaveBeenCalledTimes(1)
  })

  it('does not restart a retained parcel fetch when the camera turns', async () => {
    const response = deferred<any[]>()
    const worker = { nearbyLots: vi.fn(async () => [parcel()]), fetchLots: vi.fn((_ids: number[], _signal: AbortSignal) => response.promise) }
    stream.connect(grid, worker as any)
    frame()
    await settle()
    frame()
    for (let i = 0; i < 20; i++) {
      time += 250
      frame()
      await settle()
    }
    expect(worker.fetchLots).toHaveBeenCalledTimes(1)
    response.resolve([])
    await settle()
  })
})

describe('feature dependencies', () => {
  it('orders groups before descendants and terminates for malformed cycles', () => {
    const features: any = [
      { uuid: 'child', type: 'cube', groupId: 'inner' },
      { uuid: 'inner', type: 'group', groupId: 'outer' },
      { uuid: 'outer', type: 'group', groupId: 'inner' },
    ]
    const ordered = featureOrder(features)
    expect(ordered.map((f) => f.uuid)).toEqual(['outer', 'inner', 'child'])
  })

  it('instances matching appearance while retaining nested material differences', () => {
    const a: any = { type: 'cube', uuid: 'a', position: [0, 0, 0], material: { color: 'red' } }
    const b: any = { position: [1, 0, 0], uuid: 'b', material: { color: 'red' }, type: 'cube' }
    expect(instanceKey(a)).toBe(instanceKey(b))
    expect(instanceKey(a)).not.toBe(instanceKey({ ...b, material: { color: 'blue' } }))
    expect(instanceKey({ type: 'video' } as any)).toBeUndefined()
  })
})

it('restores the configured radius after leaving and reconnecting to the world', async () => {
  const worker = { nearbyLots: vi.fn(async () => []), fetchLots: vi.fn() }
  stream.connect(grid, worker as any)
  frame()
  await settle()
  stream.clear()
  stream.connect(grid, worker as any)
  frame()
  await settle()
  expect(worker.nearbyLots.mock.calls).toHaveLength(2)
  expect((worker.nearbyLots.mock.calls as any)[1][1]).toBe(128)
})

it('does not let an old build finish a replacement build', async () => {
  const old = deferred()
  const obsolete = vi.fn()
  const fresh = vi.fn()
  const p = parcel(1, [{ run: () => old.promise }, { run: obsolete, wait: true }])
  stream.add(p)
  frame()
  p.build = function* () {
    yield { run: fresh }
  }
  stream.rebuild(p)
  old.resolve()
  await settle()
  frame()
  expect(fresh).toHaveBeenCalledTimes(1)
  expect(obsolete).not.toHaveBeenCalled()
})
