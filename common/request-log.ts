import type { IncomingMessage, ServerResponse } from 'node:http'
import { queueRequest } from './request-sink'
import { randomUUID } from 'node:crypto'

const deploy = process.env.REQUEST_DEPLOY || process.env.COMMIT_HASH || process.env.BUILD_NUM || 'unknown'

export function requestLog(service: string) {
  return (req: IncomingMessage & { route?: { path?: string } }, res: ServerResponse, next?: () => void) => {
    if (!process.env.REQUEST_SEARCH_URL && process.env.REQUEST_STDOUT !== '1') return next?.()
    const start = performance.now()
    res.once('close', () => {
      const route = req.route?.path
      const path = (req.url || '/').split('?', 1)[0]
      const known = service === 'mp' && ['/', '/ping', '/socket/info', '/api/active-parcels.json', '/api/avatar-changed'].includes(path)
      const fn = service === 'compressor' && path === '/textures/compress'
      const asset = service === 'compressor' && (fn || path === '/compressed' ? new URLSearchParams(req.url?.split('?')[1]).get(fn ? 'key' : 'url') : path)
      const record = {
        event: 'http_request',
        at: new Date().toISOString(),
        id: randomUUID(),
        service: fn ? 'function' : service,
        deploy,
        method: req.method,
        route: typeof route === 'string' ? route : known ? path : 'unmatched',
        status: res.statusCode,
        aborted: !res.writableFinished,
        ms: Math.round(performance.now() - start),
        asset: asset ? asset.match(/(?:^|\/)parcel\/\d+\/[\w-]+\.(?:png|jpe?g|webp|avif|gif)(?=$|[?#])/i)?.[0].replace(/^\//, '') : undefined,
      }
      queueRequest(record)
      if (process.env.REQUEST_STDOUT === '1') console.log(JSON.stringify(record))
    })
    next?.()
  }
}
