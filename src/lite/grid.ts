import { createMessageHandler } from '../../common/helpers/comlink-worker'
import { getGridMono } from '../mono-pool'
import type { GridWorkerOutput } from '../monoworker/grid'
import type { Lite } from './index'
import { LiteParcel } from './parcel'
import { pumpAdd } from './pump'

// medium draw distance, hardcoded (WorldDistances medium = 128, unload = 1.1x)
const LOAD = 128
const UNLOAD = 140

export function liteGrid(lite: Lite) {
  const parcels = new Map<number, LiteParcel>()
  let last = 0

  const ready = getGridMono().then(async ({ worker, isWorker }) => {
    await worker.load()
    worker.setMessageCallback(
      createMessageHandler((m: GridWorkerOutput) => {
        if (m.type === 'Loaded') {
          if (parcels.has(m.parcelId)) return
          const p = new LiteParcel(lite, m.description, m.fieldBuffer as any)
          parcels.set(m.parcelId, p)
          pumpAdd(async () => {
            await p.generate()
            // colliders exist now, safe to fall
            lite.body.gravity = true
            worker.handleParcelGenerated(m.parcelId)
          })
        } else if (m.type === 'Unloaded') {
          parcels.get(m.parcelId)?.dispose()
          parcels.delete(m.parcelId)
        }
      }, isWorker),
    )
    worker.init(LOAD, UNLOAD)
    return worker
  })

  return {
    tick() {
      const now = performance.now()
      if (now - last < 200) return
      last = now
      const p = lite.body.position
      // distance only, no frustum planes: deterministic loading
      void ready.then((w) => w.cameraUpdate([p.x, p.y, p.z]))
    },
  }
}
