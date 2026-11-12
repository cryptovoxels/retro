import { request } from 'node:https'
import { rootCertificates } from 'node:tls'

const endpoint = process.env.REQUEST_SEARCH_URL
const pending: string[] = []
let sending = false
let dropped = 0

// Use the private DO endpoint. A failed log write must never block an HTTP response.
export function queueRequest(event: { id: string }) {
  if (!endpoint) return
  if (pending.length >= 10000) {
    dropped++
    return
  }
  pending.push(JSON.stringify({ create: { _id: event.id } }) + '\n' + JSON.stringify(event) + '\n')
}

function flushRequests() {
  if (!endpoint || !pending.length || sending) return
  sending = true
  const count = Math.min(500, pending.length)
  try {
    const req = request(
      new URL('/voxels-requests/_bulk?require_alias=true', endpoint),
      {
        method: 'POST',
        rejectUnauthorized: true,
        ca: rootCertificates.concat(process.env.REQUEST_SEARCH_CA || []),
        auth: process.env.REQUEST_SEARCH_AUTH,
        headers: { 'Content-Type': 'application/x-ndjson' },
        signal: AbortSignal.timeout(5000),
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('error', () => {
          sending = false
        })
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) return
            const items = JSON.parse(body).items
            if (!Array.isArray(items) || items.length !== count) return
            // Retry overloads. Duplicate IDs mean an earlier attempt already succeeded.
            if (items.some((item: any) => item.create.status === 429 || item.create.status >= 500)) return
            dropped += items.filter((item: any) => item.create.status >= 400 && item.create.status !== 409).length
            pending.splice(0, count)
          } catch {
            return
          } finally {
            sending = false
          }
          if (pending.length >= 500) setImmediate(flushRequests)
        })
      },
    )
    req.on('error', () => {
      sending = false
    })
    req.end(pending.slice(0, count).join(''))
  } catch {
    sending = false
  }
}

if (endpoint) {
  setInterval(flushRequests, 1000).unref()
  setInterval(() => {
    if (dropped || pending.length >= 500) console.warn('request log backlog', pending.length, 'dropped', dropped)
    dropped = 0
  }, 60000).unref()
}
