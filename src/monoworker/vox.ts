import { voxReader } from '../../common/vox-import/vox-reader'

export type LoadVoxArgs = {
  flipX: boolean
  megavox: boolean
  timeoutMs: number
  colorMap?: Record<number, [number, number, number]>
} & ({ url: string } | { buffer: ArrayBuffer })

async function loadVoxUrl(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  return fetch(url, { signal })
    .then(async (response) => {
      if (response.ok) {
        return response
      }

      const isJson = response.headers.get('content-type')?.includes('application/json')
      const data = isJson ? await response.json() : null

      let searchParams: URLSearchParams | undefined = undefined
      try {
        searchParams = new URL(url, 'https://voxels.com').searchParams
      } catch (e) {}

      const originalUrl = searchParams?.get('url') || url
      if (data.message) {
        throw new Error(`failed fetching .vox ${data.message} - ${originalUrl}`)
      } else {
        throw new Error(`failed fetching .vox ${response.status} - ${originalUrl}`)
      }
    })
    .then((r) => r!.arrayBuffer())
}

export async function loadVox({ flipX, megavox, timeoutMs, colorMap, ...urlOrBuffer }: LoadVoxArgs, signal?: AbortSignal): Promise<any> {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`loadVox timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  const workPromise = (async () => {
    if (signal?.aborted) return { cancelled: true }

    const data = 'url' in urlOrBuffer ? await loadVoxUrl(urlOrBuffer.url, signal) : urlOrBuffer.buffer

    if (signal?.aborted) return { cancelled: true }

    return new Promise((resolve, reject) => {
      voxReader(
        data,
        0,
        flipX,
        megavox,
        false,
        (data) => {
          if (signal?.aborted) {
            return resolve({ cancelled: true })
          }

          if (data instanceof Error) {
            let originalUrlInfo = ''
            if ('url' in urlOrBuffer) {
              try {
                const searchParams = new URL(urlOrBuffer.url, 'https://voxels.com').searchParams
                originalUrlInfo = `: ${searchParams.get('url') || urlOrBuffer.url}`
              } catch (e) {
                console.log('failed to parse .vox url - ', urlOrBuffer.url)
              }
            }
            return reject(new Error(`failed reading .vox ${data} - ${originalUrlInfo}`))
          }

          resolve({
            positions: data.positions,
            indices: data.indices,
            colors: data.colors,
            size: data.size,
          })
        },
        colorMap,
      )
    })
  })()

  return Promise.race([workPromise, timeoutPromise])
}
