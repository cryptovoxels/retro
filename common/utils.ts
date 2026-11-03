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

export function releaseWorker(url: URL, classic = false) {
  const options: WorkerOptions = { type: classic ? 'classic' : 'module' }
  if (url.origin === location.origin) return new Worker(url, options)
  const source = classic ? `importScripts(${JSON.stringify(url.href)})` : `import ${JSON.stringify(url.href)}`
  const blob = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  try {
    return new Worker(blob, options)
  } finally {
    URL.revokeObjectURL(blob)
  }
}
