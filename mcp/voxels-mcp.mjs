#!/usr/bin/env node
// Voxels MCP server: stdio, three tools. `login` opens the browser so the resident
// can hand over their sign-in token, then `api` calls any route as them.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'

const base = process.env.VOXELS_URL ?? 'https://www.voxels.com'
const tokenFile = join(homedir(), '.voxels', 'token')
let token = ''
try {
  token = readFileSync(tokenFile, 'utf8').trim()
} catch {}

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] })

async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body && { 'content-type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await r.text()
  return r.ok ? t : `HTTP ${r.status}\n${t}`
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  execFile(cmd, args, () => {})
}

const server = new McpServer(
  { name: 'voxels', version: '1.0.0' },
  {
    instructions: `Voxels is a virtual world at ${base}. Call login once to act as the resident, then api for anything in ${base}/API.md (also ${base}/llms.txt). Write routes need the token; read routes do not.`,
  },
)

server.registerTool('login', { description: 'Open the browser so the resident can grant this agent their voxels sign-in. Waits up to five minutes. Saves the token to ~/.voxels/token.' }, async () => {
  const key = randomBytes(32).toString('hex')
  openBrowser(`${base}/account/grant?key=${key}`)
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const j = await fetch(`${base}/api/account/grant/${key}`)
      .then((r) => r.json())
      .catch(() => null)
    if (!j?.token) continue
    token = j.token
    mkdirSync(dirname(tokenFile), { recursive: true })
    writeFileSync(tokenFile, token, { mode: 0o600 })
    return text(await api('GET', '/api/account/me'))
  }
  return text('timed out: the resident did not grant within five minutes')
})

server.registerTool('whoami', { description: 'Who the saved token acts as, from /api/account/me.' }, async () => text(token ? await api('GET', '/api/account/me') : 'not logged in, call login'))

server.registerTool(
  'api',
  {
    description: `Call a voxels route as the resident. Routes and shapes are in ${base}/API.md. path starts with /api/, body is JSON for POST/PUT/PATCH.`,
    inputSchema: { method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), path: z.string().startsWith('/'), body: z.record(z.string(), z.any()).optional() },
  },
  async ({ method, path, body }) => text(await api(method, path, body)),
)

await server.connect(new StdioServerTransport())
