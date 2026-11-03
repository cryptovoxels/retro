// Browser smoke test: real loader, CSS, Babylon, and both cross-origin workers.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'

for (const version of ['1.10.0', '1.10.1']) {
  execFileSync(process.execPath, ['scripts/bundle-node.mjs', 'client'], { stdio: 'inherit', env: { ...process.env, RELEASE_VERSION: version } })
}
execFileSync(process.execPath, ['scripts/bundle-node.mjs', 'web'], { stdio: 'inherit' })

const helper = await build({ entryPoints: ['common/utils.ts'], bundle: true, format: 'esm', write: false })
const server = createServer((_req, res) => res.end('<!doctype html><html><head></head><body></body></html>'))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const requests = []
  const errors = []
  let failedFile = ''
  let workerOrigins = 0
  page.on('request', (request) => {
    if (request.url() === `${origin}/worker-origin-check`) workerOrigins++
  })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route(`${origin}/helper.js`, (route) => route.fulfill({ contentType: 'text/javascript', body: helper.outputFiles[0].text }))
  await page.route(`${origin}/client-loader.js`, (route) => route.fulfill({ contentType: 'text/javascript', body: readFileSync('dist/client-loader.js') }))
  await page.route('https://versions.voxels.com/**', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url.pathname)
    const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
    if (url.pathname === '/releases.json') {
      return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ latest: '1.10.1', versions: ['1.10.1', '1.10.0'] }) })
    }
    if (url.pathname === failedFile) return route.fulfill({ status: 503, headers })
    const [, version, file] = url.pathname.split('/')
    if (file === 'client.js') {
      return route.fulfill({
        headers,
        contentType: 'text/javascript',
        body: `import { releaseWorker } from '${origin}/helper.js';
          window.loadedVersion = ${JSON.stringify(version)};
          const workers = ['monoworker.js', 'voxel-thumb.js'].map((file, i) => releaseWorker(new URL(file, import.meta.url), i === 1));
          window.workerResults = Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('worker timeout')), 10000);
            worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message)); };
            worker.onmessage = (e) => {
              if (e.data.id !== 'probe') return;
              clearTimeout(timer); worker.terminate(); resolve(e.data.value);
            };
            worker.postMessage({id:'probe',type:'APPLY',path:['ping'],argumentList:[]});
          })));
        `,
      })
    }
    try {
      let body = readFileSync(`.build/client${url.pathname}`)
      if (file === 'monoworker.js') body = Buffer.concat([body, Buffer.from(";fetch(new URL('/worker-origin-check', self.location.origin));")])
      return route.fulfill({ headers, contentType: file.endsWith('.js') ? 'text/javascript' : 'text/css', body })
    } catch {
      return route.fulfill({ status: 404, headers })
    }
  })
  async function boot(version) {
    await page.goto(origin)
    await page.evaluate((version) => {
      localStorage.setItem('clientVersion', version)
      const script = document.createElement('script')
      script.type = 'module'
      script.src = '/client-loader.js'
      document.head.appendChild(script)
    }, version)
  }
  for (const [choice, expected] of [
    ['', '1.10.1'],
    ['1.10.0', '1.10.0'],
  ]) {
    requests.length = 0
    await boot(choice)
    await page.waitForFunction(() => window.workerResults)
    assert.deepEqual(await page.evaluate(() => window.workerResults), [true, true])
    assert.equal(await page.evaluate(() => window.loadedVersion), expected)
    assert.equal(await page.evaluate(() => !!window.BABYLON), true)
    assert(requests.includes(`/${expected}/app.css`))
    assert(requests.includes(`/${expected}/babylon.js`))
    assert(requests.includes(`/${expected}/monoworker.js`))
    assert(requests.includes(`/${expected}/voxel-thumb.js`))
    assert(
      requests.every((url) => url === '/releases.json' || url.startsWith(`/${expected}/`)),
      requests.join('\n'),
    )
  }
  assert.equal(workerOrigins, 2)
  for (const file of ['app.css', 'babylon.js', 'client.js']) {
    failedFile = `/1.10.1/${file}`
    await boot('')
    await page.getByRole('button', { name: 'Use latest release' }).waitFor()
  }
  failedFile = ''
  await boot('missing-version')
  await page.getByRole('button', { name: 'Use latest release' }).waitFor()
  await page.getByRole('button', { name: 'Use latest release' }).click()
  await page.waitForLoadState()
  assert.equal(await page.evaluate(() => localStorage.getItem('clientVersion')), null)
  assert.deepEqual(errors, [])
  console.log('Client release smoke passed: latest, pinned, CSS, Babylon, both workers, recovery.')
} finally {
  await browser.close()
  server.close()
}
