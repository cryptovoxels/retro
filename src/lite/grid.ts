import { getGridMono } from '../mono-pool'
import type { Lite } from './index'
import { LiteParcel } from './parcel'

export function liteGrid(lite: Lite) {
  const parcels = new Map<number, { parcel?: LiteParcel; outside?: number; record: any }>()
  const ready = getGridMono().then(async ({ worker }) => {
    await worker.loadIndex()
    return worker
  })
  let last = 0
  let busy = false
  return {
    tick() {
      const now = performance.now()
      if (busy || now - last < 250) return
      last = now
      busy = true
      const p = lite.body.position
      const position = [p.x, p.y, p.z]
      void ready
        .then(async (worker) => {
          for (const [id, entry] of parcels) {
            const r = entry.record
            const distance = Math.hypot(Math.max(r.x1 - p.x, 0, p.x - r.x2), Math.max(r.z1 - p.z, 0, p.z - r.z2))
            if (distance <= 192) entry.outside = undefined
            else entry.outside ??= now
            if (entry.outside !== undefined && now - entry.outside >= 10000) {
              entry.parcel?.dispose()
              parcels.delete(id)
            }
          }
          const lots = await worker.nearbyLots(position, 128)
          const batch = lots.filter((lot) => !parcels.has(lot.id)).slice(0, 4)
          if (!batch.length) return
          const controller = new AbortController()
          try {
            for (const { record, field } of await worker.fetchLots(
              batch.map((lot) => lot.id),
              controller.signal,
            )) {
              const parcel = new LiteParcel(lite, record, field as any)
              parcels.set(record.id, { parcel, record })
              await parcel.generate()
              lite.body.gravity = true
            }
          } finally {
            controller.abort()
          }
        })
        .catch((error) => console.warn('Lite world load failed', error))
        .finally(() => {
          busy = false
        })
    },
  }
}
