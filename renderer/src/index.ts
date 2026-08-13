// ABOUTME: Wearable thumb renderer - GET holds until webp ready, then 302 to CDN (or 503 Retry-After).

import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadWearableVox } from './db'
import { hasWearableThumb, uploadWearableThumb, wearableCdnUrl } from './s3'
import { closeBrowser, renderWearable, setPageBase } from './browser'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RETRY_AFTER = '10'

const app = express()
const port = process.env.PORT || '8080'

app.get('/health', (_req, res) => {
  res.status(200).end('up')
})

app.use('/page', express.static(path.join(__dirname, '../page')))

app.get('/v1/wearable/:id.webp', async (req, res) => {
  const id = String(req.params.id || '')
  if (!UUID_RE.test(id)) {
    res.status(400).end('bad id')
    return
  }

  const cdn = wearableCdnUrl(id)

  try {
    if (await hasWearableThumb(id)) {
      res.redirect(302, cdn)
      return
    }

    const vox = await loadWearableVox(id)
    if (!vox) {
      res.status(404).end('not found')
      return
    }

    const webp = await renderWearable(id, vox)
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

app.get('/', (_req, res) => {
  res.status(200).end('vox renderer')
})

const server = app.listen(port, () => {
  setPageBase(`http://127.0.0.1:${port}`)
  console.log(`renderer listening on ${port}`)
})

async function shutdown() {
  server.close()
  await closeBrowser()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
