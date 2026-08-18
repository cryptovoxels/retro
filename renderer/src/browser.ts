// ABOUTME: One Chromium + serial queue. Injects vox/parcel JSON; page never fetches models from DB.

import { chromium, type Browser, type Page } from 'playwright'
import { embedUrls, parcelPreviewUrls } from './embed'

const HOLD_MS = 60_000
const PARCEL_HOLD_MS = 90_000
const MAX_QUEUE = 8
const BG = '#e0e0e0'
const SIZE = 512
const HEADED = process.env.RENDERER_HEADED === '1'

type PageKind = 'wearable' | 'parcel'

let pageBase = ''
let browser: Browser | null = null
let page: Page | null = null
let pageKind: PageKind | null = null
let chain: Promise<unknown> = Promise.resolve()
let queueDepth = 0
const inflight = new Map<string, Promise<Buffer>>()

/** Call once after Express is listening so the page loads over http (babylon CDN works). */
export function setPageBase(url: string) {
  pageBase = url.replace(/\/$/, '')
}

/** Launch Chromium + load babylon page early so the first request is not cold. */
export async function warmBrowser() {
  if (HEADED) {
    console.log('[renderer] headed mode - skip warm, window opens on first render')
    return
  }
  try {
    console.log('[renderer] ensurePage: start')
    const p = await ensurePage('wearable')
    const about = await p.evaluate(() => ({
      userAgent: navigator.userAgent,
      vendor: navigator.vendor,
      platform: navigator.platform,
      language: navigator.language,
    }))
    console.log('[renderer] chromium', browser?.version(), about)
  } catch (e) {
    console.error('[renderer] browser warm failed', e)
  }
}

function readyCheck(kind: PageKind) {
  return kind === 'wearable' ? () => typeof (window as any).renderVoxThumb === 'function' : () => typeof (window as any).renderParcelPreview === 'function'
}

async function pageIsReady(p: Page, kind: PageKind) {
  try {
    return await p.evaluate(readyCheck(kind))
  } catch {
    return false
  }
}

async function ensurePage(kind: PageKind) {
  if (!pageBase) throw new Error('page base not set')

  if (page && !page.isClosed() && pageKind === kind) {
    if (await pageIsReady(page, kind)) return page
    console.log('[renderer] ensurePage: cached page not ready, resetting')
    await resetPage()
  } else if (page && pageKind !== kind) {
    console.log('[renderer] ensurePage: switching', pageKind, '->', kind)
    await resetPage()
  }

  if (!browser || !browser.isConnected()) {
    console.log('[renderer] ensurePage: launching chromium')
    browser = await chromium.launch({
      headless: !HEADED,
      devtools: HEADED,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--use-gl=swiftshader',
        // Preview page is localhost; voxel textures live on voxels.com / cdn.cryptovoxels.com.
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    })
    console.log('[renderer] ensurePage: launched', browser.version())
  }

  try {
    page = await browser.newPage({ ignoreHTTPSErrors: true })
    page.on('pageerror', (e) => console.error('[renderer] pageerror', e.message, e.stack))
    page.on('console', (m) => {
      const loc = m.location()
      const where = loc.url ? ` ${loc.url}:${loc.lineNumber}` : ''
      console.log(`[renderer] page.${m.type()}${where} ${m.text()}`)
    })
    page.on('requestfailed', (req) => {
      console.error('[renderer] reqfail', req.failure()?.errorText, req.method(), req.url())
    })
    page.on('response', (res) => {
      if (res.status() >= 400) console.error('[renderer] http', res.status(), res.url())
    })
    const path = kind === 'wearable' ? '/page/index.html' : '/page/parcel.html'
    const url = `${pageBase}${path}`
    console.log('[renderer] ensurePage: goto', url)
    await page.goto(url, { waitUntil: 'load', timeout: 90_000 })
    console.log('[renderer] ensurePage: waiting ready', kind)
    await page.waitForFunction(readyCheck(kind), null, { timeout: 90_000 })
    pageKind = kind
    console.log('[renderer] ensurePage: ready', kind)
    return page
  } catch (e) {
    await resetPage()
    throw e
  }
}

async function resetPage() {
  try {
    await page?.close()
  } catch {
    // ignore
  }
  page = null
  pageKind = null
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  if (queueDepth >= MAX_QUEUE) {
    const err: any = new Error('render queue full')
    err.code = 'BUSY'
    return Promise.reject(err)
  }
  queueDepth++
  const run = chain.then(fn, fn)
  chain = run.then(
    () => {},
    () => {},
  )
  run.finally(() => {
    queueDepth--
  })
  return run
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutP = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err: any = new Error('render timed out')
      err.code = 'TIMEOUT'
      reject(err)
    }, ms)
  })
  // Prevent orphan timeout reject from becoming an unhandledRejection (process crash).
  timeoutP.catch(() => {})
  try {
    return await Promise.race([work, timeoutP])
  } catch (e: any) {
    await work.catch(() => {})
    await resetPage()
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function renderWearableOnce(vox: Buffer): Promise<Buffer> {
  const p = await ensurePage('wearable')
  const b64 = vox.toString('base64')
  const webpB64 = await p.evaluate(
    async ({ b64, bg, size }) => {
      const fn = (window as any).renderVoxThumb
      if (typeof fn !== 'function') throw new Error('renderVoxThumb missing')
      return fn(b64, bg, size)
    },
    { b64, bg: BG, size: SIZE },
  )
  if (typeof webpB64 !== 'string' || !webpB64) throw new Error('empty render')
  return Buffer.from(webpB64, 'base64')
}

async function renderParcelOnce(record: Record<string, unknown>): Promise<Buffer> {
  const p = await ensurePage('parcel')
  if (HEADED) {
    await p.evaluate(() => {
      ;(window as any).__keepPreview = true
    })
  }
  const embeds = await embedUrls(parcelPreviewUrls(record))
  const webpB64 = await p.evaluate(
    async ({ rec, embeds }) => {
      const fn = (window as any).renderParcelPreview
      if (typeof fn !== 'function') throw new Error('renderParcelPreview missing')
      return fn(rec, embeds)
    },
    { rec: record, embeds },
  )
  if (typeof webpB64 !== 'string' || !webpB64) throw new Error('empty render')
  // Parcel scene is heavy; reset unless headed so you can inspect the live page.
  if (!HEADED) await resetPage()
  return Buffer.from(webpB64, 'base64')
}

/** Render vox bytes to webp. Dedupes by uuid. Throws err.code BUSY | TIMEOUT. */
export function renderWearable(uuid: string, vox: Buffer): Promise<Buffer> {
  const key = `w:${uuid}`
  const existing = inflight.get(key)
  if (existing) return existing

  const p = enqueue(async () => withTimeout(renderWearableOnce(vox), HOLD_MS)).finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, p)
  return p
}

/** Render parcel record to webp. Dedupes by id. Throws err.code BUSY | TIMEOUT. */
export function renderParcel(id: number, record: Record<string, unknown>): Promise<Buffer> {
  const key = `p:${id}`
  const existing = inflight.get(key)
  if (existing) return existing

  const p = enqueue(async () => withTimeout(renderParcelOnce(record), PARCEL_HOLD_MS)).finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, p)
  return p
}

export async function closeBrowser() {
  await page?.close().catch(() => {})
  page = null
  pageKind = null
  await browser?.close().catch(() => {})
  browser = null
}
