// ABOUTME: Wearable + parcel thumb renderer - GET holds until webp ready, then 302 to CDN (or 503 Retry-After).

import './bootstrap'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadParcelRecord, loadWearableVox } from './db'
import { embedUrls, parcelPreviewUrls } from './embed'
import { hasParcelThumb, hasWearableThumb, parcelCdnUrl, ugcConfigured, uploadParcelThumb, uploadWearableThumb, wearableCdnUrl } from './s3'
import { closeBrowser, renderParcel, renderWearable, setPageBase, warmBrowser } from './browser'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RETRY_AFTER = '10'
const ASSET_ORIGIN = process.env.ASSET_PATH || 'https://www.voxels.com'

const app = express()
const port = process.env.PORT || '8080'

function mountRoutes(r: express.Router | express.Express) {
  r.get('/health', (_req, res) => {
    res.status(200).end('up')
  })

  r.get('/v1/wearable/:id.webp', async (req, res) => {
    const id = String(req.params.id || '')
    if (!UUID_RE.test(id)) {
      res.status(400).end('bad id')
      return
    }

    const cdn = wearableCdnUrl(id)
    const ugc = ugcConfigured()

    try {
      if (ugc && (await hasWearableThumb(id))) {
        res.redirect(302, cdn)
        return
      }

      const vox = await loadWearableVox(id)
      if (!vox) {
        res.status(404).end('not found')
        return
      }

      const webp = await renderWearable(id, vox)
      if (!ugc) {
        res.type('image/webp').status(200).send(webp)
        return
      }
      await uploadWearableThumb(id, webp)
      res.redirect(302, cdn)
    } catch (e: any) {
      const code = e?.code
      if (code === 'BUSY' || code === 'TIMEOUT') {
        res.set('Retry-After', RETRY_AFTER)
        res.status(503).end('try again')
        return
      }
      console.error('[renderer]', id, e)
      res.status(500).end('render failed')
    }
  })

  r.get('/v1/parcel/:id.json', async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).end('bad id')
      return
    }
    try {
      const record = await loadParcelRecord(id)
      if (!record) {
        res.status(404).end('not found')
        return
      }
      const embeds = await embedUrls(parcelPreviewUrls(record))
      res.json({ record, embeds })
    } catch (e) {
      console.error('[renderer] parcel json', id, e)
      res.status(500).end('db failed')
    }
  })

  r.get('/v1/parcel/:id.webp', async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).end('bad id')
      return
    }

    const cdn = parcelCdnUrl(id)
    const ugc = ugcConfigured()

    try {
      if (ugc && (await hasParcelThumb(id))) {
        res.redirect(302, cdn)
        return
      }

      const record = await loadParcelRecord(id)
      if (!record) {
        res.status(404).end('not found')
        return
      }

      const webp = await renderParcel(id, record)
      if (!ugc) {
        res.type('image/webp').status(200).send(webp)
        return
      }
      await uploadParcelThumb(id, webp)
      res.redirect(302, cdn)
    } catch (e: any) {
      const code = e?.code
      if (code === 'BUSY' || code === 'TIMEOUT') {
        res.set('Retry-After', RETRY_AFTER)
        res.status(503).end('try again')
        return
      }
      console.error('[renderer] parcel', id, e)
      res.status(500).end('render failed')
    }
  })

  r.get('/', (_req, res) => {
    res.status(200).end('vox renderer')
  })
}

mountRoutes(app)
// Ingress path prefix /renderer forwards the full path; mount the same routes there.
const underRenderer = express.Router()
mountRoutes(underRenderer)
app.use('/renderer', underRenderer)

async function proxyTextures(req: express.Request, res: express.Response) {
  try {
    const url = `${ASSET_ORIGIN}/textures${req.url}`
    const r = await fetch(url)
    if (!r.ok) {
      res.status(r.status).end()
      return
    }
    res.set('content-type', r.headers.get('content-type') || 'image/png')
    res.set('access-control-allow-origin', '*')
    res.send(Buffer.from(await r.arrayBuffer()))
  } catch (e) {
    console.error('[renderer] texture proxy', req.url, e)
    res.status(502).end('proxy fail')
  }
}

// Parcel mesher loads /textures/atlas-ao* relative to the page origin.
app.use('/textures', proxyTextures)
app.use('/renderer/textures', proxyTextures)

app.use('/page', express.static(path.join(__dirname, '../page')))
app.use('/renderer/page', express.static(path.join(__dirname, '../page')))

const server = app.listen(port, () => {
  setPageBase(`http://127.0.0.1:${port}`)
  console.log(`renderer listening on ${port}`)
  void warmBrowser()
})

async function shutdown() {
  server.close()
  await closeBrowser()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Never let a stray promise kill the service (DO restarts loop).
process.on('unhandledRejection', (err) => {
  console.error('[renderer] unhandledRejection', err)
})
process.on('uncaughtException', (err) => {
  console.error('[renderer] uncaughtException', err)
})
