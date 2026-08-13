// ABOUTME: Comlink worker that renders .vox files to 512 webp thumbs via OffscreenCanvas + Babylon.
// ABOUTME: Parallel fetch, serial GPU render, OPFS cache (memory fallback). Scene logic in common/renderable.

import * as Comlink from 'comlink'
import { createThumbScene, renderVoxThumb } from '../../../common/renderable/vox-thumb'
import type { ThumbScene } from '../../../common/renderable/types'

// babylon via importScripts before anything touches BABYLON
require('./babylon')

const mem = new Map<string, ArrayBuffer>()
const fetchCache = new Map<string, Promise<ArrayBuffer>>()
const pending = new Map<string, Promise<ArrayBuffer>>()

let ctx: ThumbScene | null = null
let chain: Promise<unknown> = Promise.resolve()
let opfsDir: FileSystemDirectoryHandle | null | undefined

function hashKey(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => {},
    () => {},
  )
  return run
}

async function getOpfsDir() {
  if (opfsDir !== undefined) return opfsDir
  try {
    const storage = (globalThis as any).navigator?.storage
    if (!storage?.getDirectory) {
      opfsDir = null
      return null
    }
    const root = await storage.getDirectory()
    opfsDir = await root.getDirectoryHandle('vox-thumbs', { create: true })
    return opfsDir
  } catch {
    opfsDir = null
    return null
  }
}

async function readCache(key: string): Promise<ArrayBuffer | null> {
  const hit = mem.get(key)
  if (hit) return hit
  try {
    const dir = await getOpfsDir()
    if (!dir) return null
    const fh = await dir.getFileHandle(`${key}.webp`)
    const sync = (fh as any).createSyncAccessHandle?.()
    if (sync) {
      try {
        const size = sync.getSize()
        const buf = new ArrayBuffer(size)
        sync.read(new Uint8Array(buf), { at: 0 })
        mem.set(key, buf)
        return buf
      } finally {
        sync.close()
      }
    }
    const file = await fh.getFile()
    const buf = await file.arrayBuffer()
    mem.set(key, buf)
    return buf
  } catch {
    return null
  }
}

async function writeCache(key: string, bytes: ArrayBuffer) {
  mem.set(key, bytes)
  try {
    const dir = await getOpfsDir()
    if (!dir) return
    const fh = await dir.getFileHandle(`${key}.webp`, { create: true })
    const sync = (fh as any).createSyncAccessHandle?.()
    if (sync) {
      try {
        sync.write(new Uint8Array(bytes), { at: 0 })
        sync.truncate(bytes.byteLength)
        sync.flush()
      } finally {
        sync.close()
      }
      return
    }
    const writable = await (fh as any).createWritable()
    await writable.write(bytes)
    await writable.close()
  } catch {
    // disk optional
  }
}

function fetchVox(src: string) {
  let p = fetchCache.get(src)
  if (!p) {
    p = fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`vox fetch ${r.status}`)
        return r.arrayBuffer()
      })
      .catch((e) => {
        fetchCache.delete(src)
        throw e
      })
    fetchCache.set(src, p)
  }
  return p
}

function init(c: OffscreenCanvas | HTMLCanvasElement) {
  if (!ctx) ctx = createThumbScene(c)
}

function render(src: string, background: string): Promise<ArrayBuffer> {
  const key = hashKey(`${src}|${background}`)
  const existing = pending.get(key)
  if (existing) return existing

  const bufP = fetchVox(src)
  const p = (async () => {
    const hit = await readCache(key)
    if (hit) return hit
    return enqueue(async () => {
      const hit2 = await readCache(key)
      if (hit2) return hit2
      if (!ctx) throw new Error('not inited')
      const buf = await bufP
      const out = await renderVoxThumb(ctx, {
        kind: 'vox',
        bytes: buf,
        background,
        size: 512,
      })
      await writeCache(key, out.bytes)
      return out.bytes
    })
  })()

  pending.set(key, p)
  p.finally(() => pending.delete(key))
  return p
}

const api = {
  ping: () => true as const,
  init,
  render,
}

export type VoxelThumb = typeof api
export { api }

const WGS = (globalThis as any).WorkerGlobalScope
const inWorker = typeof WGS !== 'undefined' && typeof self !== 'undefined' && self instanceof WGS
if (inWorker) Comlink.expose(api)
