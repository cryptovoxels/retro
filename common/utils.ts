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
