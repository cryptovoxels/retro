// ABOUTME: Singleton Comlink handle for the voxel-thumb worker + requestThumb entrypoint.

import * as Comlink from 'comlink'
import { createComlinkWorker } from '../../../common/helpers/comlink-worker'
import type { VoxelThumb } from '../workers/voxel-thumb'

const SIZE = 512
const BABYLON_SRC = '/vendor/library-9.25.0.min.js'
const urls = new Map<string, Promise<string>>()

let apiPromise: Promise<VoxelThumb> | null = null
let babylonPromise: Promise<void> | null = null

function ensureBabylon(): Promise<void> {
  if ((globalThis as any).BABYLON) return Promise.resolve()
  if (babylonPromise) return babylonPromise
  babylonPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = BABYLON_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      babylonPromise = null
      reject(new Error('failed to load babylon'))
    }
    document.head.appendChild(s)
  })
  return babylonPromise
}

async function getApi() {
  if (!apiPromise) {
    apiPromise = (async () => {
      const handle = await createComlinkWorker<VoxelThumb>(
        () => new Worker(new URL('../workers/voxel-thumb.ts', import.meta.url)),
        async () => {
          await ensureBabylon()
          return import('../workers/voxel-thumb').then((m) => m.api)
        },
        { workerName: 'voxel-thumb' },
      )

      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE

      if (handle.isWorker && typeof (canvas as any).transferControlToOffscreen === 'function') {
        const off = (canvas as any).transferControlToOffscreen() as OffscreenCanvas
        await handle.worker.init(Comlink.transfer(off, [off]) as any)
      } else {
        await ensureBabylon()
        await handle.worker.init(canvas)
      }

      return handle.worker
    })().catch((e) => {
      apiPromise = null
      throw e
    })
  }
  return apiPromise
}

export function requestThumb(src: string, background = '#ff00aa'): Promise<string> {
  const key = `${src}|${background}`
  let p = urls.get(key)
  if (p) return p

  p = (async () => {
    try {
      const api = await getApi()
      const bytes = await api.render(src, background)
      return URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }))
    } catch (e) {
      urls.delete(key)
      throw e
    }
  })()

  urls.set(key, p)
  return p
}
