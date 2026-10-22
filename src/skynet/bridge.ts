import { tools } from './tools'

// page side of tools/skynet-mcp. the mcp server listens on localhost, the page dials in
// with its own cookie session doing the auth. no tokens cross the bridge.
const port = Number(new URLSearchParams(location.search).get('bridge')) || 3791

export function startBridge() {
  let ws: WebSocket
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}`)
  } catch {
    return
  }
  ws.onopen = () => {
    console.log(`[skynet] bridge connected on ${port}`)
    ws.send(JSON.stringify({ type: 'hello', url: location.href, tools: tools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }))
  }
  ws.onmessage = async (e) => {
    let msg: any
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    if (msg?.type !== 'call') return
    try {
      const result = await window.skynet!.call(msg.name, msg.input)
      ws.send(JSON.stringify({ type: 'result', id: msg.id, result }))
    } catch (err: any) {
      ws.send(JSON.stringify({ type: 'error', id: msg.id, error: err?.message || String(err) }))
    }
  }
  // the bridge may start after the page, keep dialing
  ws.onclose = () => setTimeout(startBridge, 2000)
}
