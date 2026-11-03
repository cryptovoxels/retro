// skynet bundle, its own esbuild entry. loaded by the game only with ?agent=skynet.
// on the console: skynet.help(), await skynet.health(), await skynet.read_voxels({ layer: 9 })
import { content, home, tools } from './tools'

// the owner's link carries a parcel scoped token in the hash (never sent to the server or logged).
// make it this browser's session, then reload so the grid socket connects with it.
const token = location.hash.match(/skynet=([\w.-]+)/)?.[1]
if (token) {
  document.cookie = `jwt=${token}; path=/; max-age=43200; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
  history.replaceState(null, '', location.pathname + location.search)
  location.reload()
}

async function call(name: string, input: any = {}) {
  const tool = tools().find((t) => t.name === name)
  if (!tool) throw new Error(`no tool ${name}`)
  return tool.execute(input)
}

// grid socket relays mcp calls from /api/skynet/mcp
async function answer(msg: { id: number; name: string; input: any }) {
  try {
    window.grid?.send(JSON.stringify({ type: 'skynet-result', id: msg.id, result: await call(msg.name, msg.input) }))
  } catch (e: any) {
    window.grid?.send(JSON.stringify({ type: 'skynet-result', id: msg.id, error: e?.message || String(e) }))
  }
}

function announce() {
  const schemas = tools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
  window.grid?.send(JSON.stringify({ type: 'skynet-tools', tools: schemas }))
}

function help() {
  console.table(tools().map(({ name, description }) => ({ name, description })))
  console.log(`parcel ${home() ?? '(no skynet token)'}. try: await skynet.health()`)
}

const skynet: Record<string, any> = { tools, call, answer, content, help }
for (const t of tools()) skynet[t.name] = async (input: any = {}) => t.execute(input)
;(window as any).skynet = skynet

// re-announce on every reconnect, the server forgets the page when the socket drops
window.grid?.onConnectionStateChanged.add((s) => s.status === 'connected' && announce())
if (window.grid?.isOpen) announce()
