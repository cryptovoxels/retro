// Run against a local test world with a disposable parcel and its owner's login.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = new URL(process.env.SKYNET_ORIGIN || 'http://localhost:9000')
assert(['localhost', '127.0.0.1'].includes(origin.hostname))
const id = Number(process.env.SKYNET_PARCEL)
assert(id && process.env.SKYNET_OWNER_JWT, 'Set SKYNET_PARCEL and SKYNET_OWNER_JWT for your local test parcel')
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
try {
  const owner = await browser.newContext()
  await owner.addCookies([{ name: 'jwt', value: process.env.SKYNET_OWNER_JWT, url: origin.href }])
  const page = await owner.newPage()
  await page.goto(new URL('/parcels/' + id, origin).href, { waitUntil: 'domcontentloaded' })
  await page.getByText('skynet', { exact: true }).click()
  if (process.env.SKYNET_SCREENSHOT)
    await page
      .locator('details')
      .filter({ has: page.getByRole('button', { name: 'create build link' }) })
      .screenshot({ path: process.env.SKYNET_SCREENSHOT })
  await page.getByRole('button', { name: 'create build link' }).click()
  const link = new URL(await page.getByLabel('Skynet build link').inputValue())
  const agent = await browser.newPage()
  await agent.goto(link.href, { waitUntil: 'domcontentloaded' })
  async function ready() {
    await agent.waitForFunction((id) => !!window.skynet && window.grid?.getByID(id)?.loaded, id, { timeout: 90000, polling: 500 })
  }
  await ready()
  assert.equal(new URL(agent.url()).hash, '')
  const bearer = { Authorization: 'Bearer ' + new URLSearchParams(link.hash.slice(1)).get('skynet') }
  const invalid = { positions: [[-1, 0, 0]], value: 1 }
  const denied = await agent.request.post(new URL(`/api/parcels/${id + 1}/skynet/voxels`, origin).href, { headers: bearer, data: invalid })
  assert.equal(denied.status(), 403)
  const bounds = await agent.request.post(new URL(`/api/parcels/${id}/skynet/voxels`, origin).href, { headers: bearer, data: invalid })
  assert.equal(bounds.status(), 400)
  assert.equal((await agent.request.post(new URL(`/api/parcels/${id}/skynet`, origin).href, { headers: bearer })).status(), 401)
  assert(!(await agent.context().cookies()).some((c) => c.name === 'jwt'))
  const positions = [[1, 1, 1]]
  const read = () => agent.evaluate(async (positions) => (await window.skynet.read_voxels({ positions }))[0], positions)
  const write = (value) => agent.evaluate((input) => window.skynet.set_voxels(input), { positions, value })
  const before = await read()
  const after = before === 0 ? 1 : 0
  try {
    assert.deepEqual(await write(after), { saved: true })
    await agent.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    assert.equal(await read(), after)
    console.log(`Parcel ${id} [1,1,1]: ${before} -> ${after}, read ${after} after full page reload.`)
  } finally {
    assert.deepEqual(await write(before), { saved: true })
    await agent.reload({ waitUntil: 'domcontentloaded' })
    await ready()
    assert.equal(await read(), before)
    console.log('Original block restored and verified after a second reload.')
  }
} finally {
  await browser.close()
}
