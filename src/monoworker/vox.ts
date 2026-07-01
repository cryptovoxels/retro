import { TriangleLimitExceededError, voxReader } from '../../common/vox-import/vox-reader'
import type { JobRecord } from '../../common/vox-import/vox-import'

const cancelledJobs = new Set<number>()

async function loadVoxUrl(url: string): Promise<ArrayBuffer> {
  return fetch(url)
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

export async function loadVox({ renderJob, flipX, megavox, maxTriangles, dryRun, wantCollider, timeoutMs, ...urlOrBuffer }: JobRecord): Promise<any> {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Job ${renderJob} timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  const workPromise = (async () => {
    const data = 'url' in urlOrBuffer ? await loadVoxUrl(urlOrBuffer.url) : urlOrBuffer.buffer

    if (cancelledJobs.has(renderJob)) {
      return { renderJob, cancelled: true }
    }

    return new Promise((resolve, reject) => {
      voxReader(data, renderJob, flipX, megavox, maxTriangles, dryRun, wantCollider, (data) => {
        if (cancelledJobs.has(renderJob)) {
          return resolve({ renderJob, cancelled: true })
        }

        if (data instanceof TriangleLimitExceededError) {
          return reject(data)
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
          renderJob,
          positions: data.positions,
          indices: data.indices,
          colors: data.colors,
          size: data.size,
          ...('colliderPositions' in data
            ? {
                colliderPositions: data.colliderPositions,
                colliderIndices: data.colliderIndices,
              }
            : {}),
        })
      })
    })
  })()

  return Promise.race([workPromise, timeoutPromise])
}

export function cancelJob(renderJob: number) {
  cancelledJobs.add(renderJob)
}
