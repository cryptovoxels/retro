import type { CachedParcelsMessage } from './messages/api-parcels'

export function ethTrunc(wallet: string | null | undefined) {
  if (!wallet) {
    return ''
  }

  return wallet.slice(0, 5) + '..' + wallet.slice(-3)
}

export const versionsUrl = 'https://versions.voxels.com'

export function clientChoice() {
  try {
    return localStorage.getItem('clientVersion') || ''
  } catch {
    return ''
  }
}

const workerSources = new Map<string, Promise<string>>()

export async function releaseWorker(url: URL, classic = false) {
  const options: WorkerOptions = { type: classic ? 'classic' : 'module' }
  if (url.origin === location.origin) return new Worker(url, options)
  let source = workerSources.get(url.href)
  if (!source) {
    source = fetch(url, { signal: AbortSignal.timeout(30000) })
      .then((response) => {
        if (!response.ok) throw new Error(`Worker download failed: ${response.status}`)
        return response.text()
      })
      .catch((error) => {
        workerSources.delete(url.href)
        throw error
      })
    workerSources.set(url.href, source)
  }
  // Download before starting the ready timer. These bundles have no module imports.
  const blob = URL.createObjectURL(new Blob([await source, `\n//# sourceURL=${url.href}`], { type: 'text/javascript' }))
  try {
    return new Worker(blob, options)
  } finally {
    // Keep the URL alive while the browser starts the worker.
    setTimeout(() => URL.revokeObjectURL(blob), 30000)
  }
}

let parcelRequest: Promise<CachedParcelsMessage> | undefined

export function parcelIndex(refresh = false): Promise<CachedParcelsMessage> {
  if (refresh) parcelRequest = undefined
  return (parcelRequest ??= (async () => {
    let attempts = 0
    for (;;) {
      try {
        const response = await fetch(`${process.env.ASSET_PATH || ''}/api/parcels/cached.json`, {
          cache: attempts || refresh ? 'reload' : 'default',
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) throw new Error(`Parcel index: ${response.status}`)
        const data = await response.json()
        if (!data.parcels) throw new Error('Parcel index unavailable')
        return data
      } catch {
        // The world cannot start without this index. Keep the cube up and recover.
        await new Promise((resolve) => setTimeout(resolve, Math.min(++attempts, 5) * 1000))
      }
    }
  })())
}
