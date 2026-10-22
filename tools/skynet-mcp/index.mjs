#!/usr/bin/env node
// stdio MCP server <-> websocket <-> the voxels page (?agent=skynet). the page owns auth (its cookie session).
// stdout is the MCP channel, log to stderr only.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { WebSocketServer } from 'ws'

const port = Number(process.env.SKYNET_PORT) || 3791
const origins = (process.env.SKYNET_ORIGINS || 'http://localhost:9000,https://www.voxels.com,https://voxels.com').split(',')

let page = null
let tools = []
let nextId = 0
const pending = new Map()
const waiters = []

const server = new Server({ name: 'skynet', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } })
let ready = false
server.oninitialized = () => (ready = true)

const wss = new WebSocketServer({
  host: '127.0.0.1',
  port,
  // any tab on this machine could dial localhost, only let the game in
  verifyClient: ({ origin }) => origins.includes(origin),
})

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (msg.type === 'hello') {
      if (page && page !== ws) page.close()
      page = ws
      tools = msg.tools || []
      console.error(`[skynet] page connected: ${msg.url} (${tools.length} tools)`)
      waiters.splice(0).forEach((done) => done())
      if (ready) server.sendToolListChanged().catch(() => {})
    }
    const call = pending.get(msg.id)
    if (!call) return
    pending.delete(msg.id)
    msg.type === 'error' ? call.reject(new Error(msg.error)) : call.resolve(msg.result)
  })
  ws.on('close', () => {
    if (ws !== page) return
    page = null
    console.error('[skynet] page disconnected')
    pending.forEach((call) => call.reject(new Error('Page disconnected mid call')))
    pending.clear()
  })
})
wss.on('error', (e) => console.error(`[skynet] websocket: ${e.message}`))

const notOpen = `No voxels page connected. Open the parcel's play url with &agent=skynet in a browser logged in as the owner (bridge port ${port}).`

// claude asks for tools at startup, give the page a moment to dial in
server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (!page) await new Promise((done) => (waiters.push(done), setTimeout(done, 10000)))
  return { tools }
})

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (!page) return { isError: true, content: [{ type: 'text', text: notOpen }] }
  const id = ++nextId
  try {
    const result = await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      page.send(JSON.stringify({ type: 'call', id, name: params.name, input: params.arguments || {} }))
      setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error('Page did not answer in 60s'))), 60000)
    })
    if (result?.mimeType && result?.base64) return { content: [{ type: 'image', data: result.base64, mimeType: result.mimeType }] }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e.message }] }
  }
})

await server.connect(new StdioServerTransport())
console.error(`[skynet] waiting for the page on ws://127.0.0.1:${port}`)
