// ABOUTME: One Chromium + serial queue. Injects vox as base64; page never fetches models.

import { chromium, type Browser, type Page } from 'playwright'

const HOLD_MS = 25_000
const MAX_QUEUE = 8
const BG = '#e0e0e0'
const SIZE = 512

let pageBase = ''
let browser: Browser | null = null
let page: Page | null = null
let chain: Promise<unknown> = Promise.resolve()
let queueDepth = 0
const inflight = new Map<string, Promise<Buffer>>()

/** Call once after Express is listening so the page loads over http (babylon CDN works). */
export function setPageBase(url: string) {
  pageBase = url.replace(/\/$/, '')
}

async function ensurePage() {
  if (!pageBase) throw new Error('page base not set')
  if (page && !page.isClosed()) return page
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
  }
  page = await browser.newPage()
  await page.goto(`${pageBase}/page/index.html`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => (window as any).__renderReady === true, null, { timeout: 60_000 })
  return page
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

async function renderOnce(vox: Buffer): Promise<Buffer> {
  const p = await ensurePage()
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

/** Render vox bytes to webp. Dedupes by uuid. Throws err.code BUSY | TIMEOUT. */
export function renderWearable(uuid: string, vox: Buffer): Promise<Buffer> {
  const existing = inflight.get(uuid)
  if (existing) return existing

  const p = enqueue(async () => {
    const work = renderOnce(vox)
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            const err: any = new Error('render timed out')
            err.code = 'TIMEOUT'
            reject(err)
          }, HOLD_MS)
        }),
      ])
    } catch (e) {
      await work.catch(() => {})
      throw e
    }
  }).finally(() => {
    inflight.delete(uuid)
  })

  inflight.set(uuid, p)
  return p
}

export async function closeBrowser() {
  await page?.close().catch(() => {})
  page = null
  await browser?.close().catch(() => {})
  browser = null
}
