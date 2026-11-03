// Check the production assets and both workers without a database or CDN.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const assets = JSON.parse(readFileSync('dist/client-manifest.json'))
const helper = await build({ stdin: { contents: "export { createComlinkWorker } from './common/helpers/comlink-worker'", resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false })
for (const file of Object.values(assets)) {
  assert.match(file, /^\/assets\/[a-z-]+-[a-f0-9]{16}\.(js|css)$/)
  assert(readFileSync('dist' + file).length)
}
const client = readFileSync('dist' + assets.client, 'utf8')
assert(client.includes(assets.mono.split('/').pop()))
assert(client.includes(assets.thumb.split('/').pop()))
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html')
    return res.end(`<!doctype html><link rel="stylesheet" href="${assets.css}"><script src="${assets.babylon}"></script>`)
  }
  if (req.url === '/helper.js') {
    res.setHeader('Content-Type', 'text/javascript')
    return res.end(helper.outputFiles[0].contents)
  }
  try {
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css')
    res.end(readFileSync('dist' + req.url))
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  assert(await page.evaluate(() => !!window.BABYLON))
  const results = await page.evaluate(async ({ mono, thumb }) => {
    const { createComlinkWorker } = await import('/helper.js')
    return Promise.all(
      [mono, thumb].map(async (url, i) => {
        const handle = await createComlinkWorker(
          () => new Worker(url, i ? {} : { type: 'module' }),
          () => {
            throw Error('Unexpected fallback')
          },
        )
        const result = await handle.worker.ping()
        handle.cleanup()
        return result
      }),
    )
  }, assets)
  assert.deepEqual(results, [true, true])
  assert.deepEqual(errors, [])
  console.log('Client assets, CSS, Babylon and both workers passed.')
} finally {
  await browser.close()
  server.close()
}
