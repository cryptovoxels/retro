import http from 'http'
import type WebSocket from 'ws'

export type WsTopic = string

export type WsLike<UserData> = {
  getUserData(): UserData
  send(data: ArrayBufferView, isBinary?: boolean): void
  end(code?: number, reason?: string): void
  close(code?: number, reason?: string): void
  getBufferedAmount(): number
  subscribe(topic: WsTopic): void
  publish(topic: WsTopic, message: ArrayBufferView, isBinary?: boolean): void
}

export type MultiplayerServer = {
  server: http.Server
  publish(topic: string, message: ArrayBufferView, isBinary?: boolean): void
  subscribe(wsId: symbol, topic: string): void
  unsubscribeAll(wsId: symbol): void
  broadcast(topic: string, message: ArrayBufferView, isBinary?: boolean, excludeWsId?: symbol): void
  socketsById: Map<symbol, WebSocket>
}

export default function createServer() {
  const server = http.createServer()

  // Topic subscriptions for broadcast; replaces uWS pub/sub.
  const topicToSockets = new Map<WsTopic, Set<symbol>>()
  const socketsById = new Map<symbol, WebSocket>()

  const subscribe = (wsId: symbol, topic: WsTopic) => {
    let set = topicToSockets.get(topic)
    if (!set) {
      set = new Set()
      topicToSockets.set(topic, set)
    }
    set.add(wsId)
  }

  const unsubscribeAll = (wsId: symbol) => {
    for (const set of topicToSockets.values()) set.delete(wsId)
  }

  const broadcast = (topic: WsTopic, message: ArrayBufferView, isBinary = true, excludeWsId?: symbol) => {
    const subs = topicToSockets.get(topic)
    if (!subs) return

    for (const id of subs) {
      if (excludeWsId && id === excludeWsId) continue
      const ws = socketsById.get(id)
      if (!ws || ws.readyState !== ws.OPEN) continue
      try {
        ws.send(message, { binary: isBinary })
      } catch (err) {
        console.error('ws broadcast send failed', err)
      }
    }
  }

  return {
    server,
    publish: (topic: string, message: ArrayBufferView, isBinary = true) => broadcast(topic, message, isBinary),
    subscribe,
    unsubscribeAll,
    broadcast,
    socketsById,
  }
}
