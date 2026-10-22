// @vitest-environment node
import { expect, it, vi } from 'vitest'
import express from 'express'
import { decodeJwt } from 'jose'

vi.mock('../server/auth-parcel', () => ({ default: async () => 'Owner' }))
vi.mock('../server/parcel', () => ({ default: { load: async (id: number) => ({ id }) } }))

import SkynetController, { skynetDrop, skynetResult, skynetTools } from '../server/skynet'

it('mints a parcel token and relays mcp calls to the browser', async () => {
  const app = express()
  app.use(express.json())
  const passport: any = { authenticate: () => (req: any, _res: any, next: any) => ((req.user = { wallet: '0xOwner' }), next()) }
  SkynetController(passport, app)
  const server = app.listen(0)
  const url = `http://127.0.0.1:${(server.address() as any).port}`
  const rpc = (token: string, method: string, params?: any) =>
    fetch(`${url}/api/skynet/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json())

  try {
    const { token } = await fetch(`${url}/api/parcels/9159/skynet`, { method: 'POST' }).then((r) => r.json())
    const claims: any = decodeJwt(token)
    expect(claims).toMatchObject({ skynet: true, parcel_id: 9159, owner: '0xowner', wallet: 'skynet:9159' })

    expect((await rpc(token, 'tools/list')).error.message).toMatch(/No skynet browser/)

    // the browser: registers over the grid socket, answers calls
    const page: any = {
      id: 'c1',
      user: claims,
      send: (m: any) => setTimeout(() => skynetResult(m.name === 'boom' ? { type: 'skynet-result', id: m.id, error: 'nope' } : { type: 'skynet-result', id: m.id, result: { got: m.input } })),
    }
    skynetTools(page, { type: 'skynet-tools', tools: [{ name: 'health' }] })

    expect((await rpc(token, 'initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name).toBe('voxels-skynet')
    expect((await rpc(token, 'tools/list')).result.tools).toEqual([{ name: 'health' }])
    expect((await rpc(token, 'tools/call', { name: 'health', arguments: { a: 1 } })).result.content[0].text).toBe('{"got":{"a":1}}')
    expect((await rpc(token, 'tools/call', { name: 'boom' })).result).toMatchObject({ isError: true, content: [{ text: 'nope' }] })
    expect((await rpc('garbage', 'tools/list')).error.code).toBe(-32001)

    skynetDrop(page)
    expect((await rpc(token, 'tools/call', { name: 'health' })).result.isError).toBe(true)
  } finally {
    server.close()
  }
})
