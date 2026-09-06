import { meshVoxBuffer } from './mesh'
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

export async function loadVox({ renderJob, flipX, megavox, wantCollider, timeoutMs, colorMap, ...urlOrBuffer }: JobRecord): Promise<any> {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Job ${renderJob} timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  const workPromise = (async () => {
    const data = 'url' in urlOrBuffer ? await loadVoxUrl(urlOrBuffer.url) : urlOrBuffer.buffer

    if (cancelledJobs.has(renderJob)) {
      return { renderJob, cancelled: true }
    }

    try {
      const mesh = meshVoxBuffer(data, { flipX, megavox, wantCollider, colorMap })
      if (cancelledJobs.has(renderJob)) return { renderJob, cancelled: true }
      return {
        renderJob,
        pos: mesh.pos,
        rgb: mesh.rgb,
        idx: mesh.idx,
        meta: mesh.meta,
        size: mesh.size,
        ...(mesh.colliderPositions
          ? {
              colliderPositions: mesh.colliderPositions,
              colliderIndices: mesh.colliderIndices,
            }
          : {}),
      }
    } catch (e: any) {
      let originalUrlInfo = ''
      if ('url' in urlOrBuffer) {
        try {
          const searchParams = new URL(urlOrBuffer.url, 'https://voxels.com').searchParams
          originalUrlInfo = `: ${searchParams.get('url') || urlOrBuffer.url}`
        } catch (err) {
          console.log('failed to parse .vox url - ', urlOrBuffer.url)
        }
      }
      throw new Error(`failed reading .vox ${e?.message || e}${originalUrlInfo}`)
    }
  })()

  return Promise.race([workPromise, timeoutPromise])
}

export function cancelJob(renderJob: number) {
  cancelledJobs.add(renderJob)
}
