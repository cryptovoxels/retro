import { signal } from '@preact/signals'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TinyCache = require('tinycache')

export const wompCache = new TinyCache()
export const parcelCache = new TinyCache()
export const assetCache = new TinyCache()
export const parcelSearchCache = new TinyCache()

// Parcel summary signal set

let summary: Array<ParcelSummary> | undefined
const parcels = new Map()

interface ParcelSummary {
  id: number
  name: string
  address: string
  island: string
}

async function getParcelSummary() {
  const r = await fetch('/api/parcels/summary.json')
  const j = await r.json()

  summary = j.parcels

  for (const key of parcels.keys()) {
    const sum = summary!.find((s: ParcelSummary) => s.id == key)
    parcels.get(key).value = sum
  }
}

export const summaryReady = typeof window === 'object' ? getParcelSummary() : Promise.resolve()

// Returns a parcel summary signal - may return a signal with no value - but the signal
// will be updated once we have fetched
export function getParcel(id: number) {
  if (!parcels.get(id)) {
    parcels.set(id, signal(summary?.find((s) => s.id == id)))
  }

  return parcels.get(id)
}
