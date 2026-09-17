// #region agent log
// ABOUTME: temporary rss debug instrumentation, delete when done
import { appendFileSync, mkdirSync } from 'fs'

const EP = 'http://127.0.0.1:7655/ingest/53bfc83e-fc60-46e1-b593-0d715a1e3f0d'
const FILE = process.env.DEBUG_LOG_FILE || '.cursor/debug-607f5f.log'

export function dbg(location: string, message: string, data: any, hypothesisId: string) {
  const line = JSON.stringify({ sessionId: '607f5f', runId: process.env.DEBUG_RUN || 'run1', hypothesisId, location, message, data, timestamp: Date.now() })
  fetch(EP, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '607f5f' }, body: line }).catch(() => {})
  try {
    mkdirSync('.cursor', { recursive: true })
    appendFileSync(FILE, line + '\n')
  } catch {}
}

export const mb = (n: number) => Math.round((n / 1048576) * 10) / 10

// held: bodies past sniff waiting on / inside upload. alive: fetched body buffers not yet finalized by GC.
export const gauges = { held: 0, heldBytes: 0, alive: 0, aliveBytes: 0, fetches: 0, fetchBytes: 0, voxelbr: 0, voxelbrRaw: 0, voxDraft: 0, imgDraft: 0, imgBytes: 0, maxHeld: 0, maxHeldBytes: 0 }
const reg = new FinalizationRegistry<number>((n) => {
  gauges.alive--
  gauges.aliveBytes -= n
})
;(globalThis as any).__dbg = dbg
;(globalThis as any).__g = gauges
;(globalThis as any).__track = (buf: ArrayBuffer, n: number) => {
  gauges.alive++
  gauges.aliveBytes += n
  gauges.fetches++
  gauges.fetchBytes += n
  reg.register(buf, n)
}
// #endregion
