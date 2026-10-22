import crypto from 'crypto'
import { Express, Request, Response } from 'express'
import { SignJWT, jwtVerify } from 'jose'
import { PassportStatic } from 'passport'
import authParcel from './auth-parcel'
import Parcel from './parcel'
import { noCache } from './cache'
import { VoxelsUserRequest } from './user'
import { GridClient } from './grid/GridClient'
import { SkynetResultMessage, SkynetToolsMessage } from '../common/messages/grid'
import { currentVersion } from '../common/version'

// Skynet: the owner mints a token that can edit one parcel. The agent's own browser opens
// play?...&agent=skynet#skynet=<token>, registers its WebMCP tools over the grid socket, and
// /api/skynet/mcp relays tool calls to it for agents that don't speak WebMCP.

const KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'secret')
const TTL_SECONDS = 12 * 60 * 60

// todo: single instance only. a call that lands on a different server than the page's grid socket finds no page
const pages = new Map<string, { client: GridClient; tools: unknown[] }>()
const pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>()
let nextId = 0

export function skynetTools(client: GridClient, msg: SkynetToolsMessage) {
  const sid = (client.user as any)?.sid
  if ((client.user as any)?.skynet && sid) pages.set(sid, { client, tools: msg.tools })
}

export function skynetResult(msg: SkynetResultMessage) {
  const call = pending.get(msg.id)
  if (!call) return
  pending.delete(msg.id)
  msg.error ? call.reject(new Error(msg.error)) : call.resolve(msg.result)
}

export function skynetDrop(client: GridClient) {
  const sid = (client.user as any)?.sid
  if (pages.get(sid)?.client.id === client.id) pages.delete(sid)
}

function relay(sid: string, name: string, input: unknown) {
  const page = pages.get(sid)
  if (!page) return Promise.reject(new Error('No skynet browser connected. Open the play link with #skynet=<token> and keep it open.'))
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    page.client.send({ type: 'skynet-call', id, name, input })
    setTimeout(() => pending.delete(id) && reject(new Error('Browser did not answer in 60s')), 60000)
  })
}

async function verify(req: Request) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.query.token || '')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, KEY, { algorithms: ['HS256'] })
    return payload.skynet && typeof payload.sid === 'string' ? payload : null
  } catch {
    return null
  }
}

export default function SkynetController(passport: PassportStatic, app: Express) {
  app.post('/api/parcels/:id/skynet', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    noCache(res)
    const user = req.user
    // a skynet or guest token never mints another token
    if (!user?.wallet || (user as any).skynet || (user as any).guest_pass) return res.status(403).json({ success: false, error: 'Log in as the owner' })
    const parcel = await Parcel.load(parseInt(req.params.id, 10))
    if (!parcel) return res.status(404).json({ success: false })
    if ((await authParcel(parcel, user)) !== 'Owner') return res.status(403).json({ success: false, error: 'Only the owner can summon skynet' })
    const token = await new SignJWT({ wallet: `skynet:${parcel.id}`, skynet: true, parcel_id: parcel.id, owner: user.wallet.toLowerCase(), sid: crypto.randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
      .sign(KEY)
    res.json({ success: true, token, expiresIn: TTL_SECONDS })
  })

  // mcp streamable http, json responses only. stateless: the token says which browser
  app.post('/api/skynet/mcp', async (req: Request, res: Response) => {
    noCache(res)
    const auth = await verify(req)
    const { id, method, params } = req.body || {}
    const reply = (body: Record<string, unknown>) => res.json({ jsonrpc: '2.0', id, ...body })
    if (!auth) return res.status(401).json({ jsonrpc: '2.0', id, error: { code: -32001, message: 'Missing or expired skynet token. Ask the owner for a fresh one.' } })
    if (id === undefined) return res.status(202).end() // notifications
    const sid = auth.sid as string

    if (method === 'initialize') {
      return reply({
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'voxels-skynet', version: String(currentVersion) },
          instructions: `You build parcel ${auth.parcel_id}. Read /skynet-agents.md first. Your browser must stay open on the play link.`,
        },
      })
    }
    if (method === 'ping') return reply({ result: {} })
    if (method === 'tools/list') {
      const page = pages.get(sid)
      if (!page) return reply({ error: { code: -32002, message: 'No skynet browser connected. Open the play link with #skynet=<token> and keep it open.' } })
      return reply({ result: { tools: page.tools } })
    }
    if (method === 'tools/call') {
      try {
        const result: any = await relay(sid, params?.name, params?.arguments || {})
        if (result?.mimeType && result?.base64) return reply({ result: { content: [{ type: 'image', data: result.base64, mimeType: result.mimeType }] } })
        return reply({ result: { content: [{ type: 'text', text: JSON.stringify(result) }] } })
      } catch (e: any) {
        return reply({ result: { isError: true, content: [{ type: 'text', text: e.message }] } })
      }
    }
    reply({ error: { code: -32601, message: `Unknown method ${method}` } })
  })

  app.get('/api/skynet/mcp', (_req, res) => res.status(405).end())
}
