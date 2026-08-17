import type http from 'http'
import WebSocket, { WebSocketServer } from 'ws'
import { ClientUUID } from '../common/clientUUID'
import { APP_NAME } from '../constants/appName'
import { WSCloseCodes } from '../constants/socketCloseCodes'
import { ClientConnectionInformation } from './client'
import { Shards } from './shards/shards'
import type { MultiplayerServer, WsLike } from '../createServer'

export default function createWebsocketServer(server: MultiplayerServer, httpServer: http.Server, shards: Shards) {
  const wss = new WebSocketServer({ server: httpServer, path: '/socket' })

  const makeWsLike = (
    wsId: symbol,
    ws: WebSocket,
    data: ClientConnectionInformation,
  ): WsLike<ClientConnectionInformation> => {
    return {
      getUserData: () => data,
      send: (buf, isBinary) => ws.send(buf, { binary: !!isBinary }),
      end: (code, reason) => ws.close(code, reason),
      close: (code, reason) => ws.close(code, reason),
      getBufferedAmount: () => ws.bufferedAmount,
      subscribe: (topic) => server.subscribe(wsId, topic),
      publish: (topic, message, isBinary) => server.broadcast(topic, message, !!isBinary, wsId),
    }
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/socket', 'http://localhost')
    const client_uuid = url.searchParams.get('client_uuid')
    if (!client_uuid) {
      ws.close(WSCloseCodes.validationError, 'client_uuid required')
      return
    }

    const clientUUID = client_uuid as ClientUUID
    const fullUrl = url.pathname + (url.search ? url.search : '')
    const clientInfo: ClientConnectionInformation = {
      clientUUID,
      shardID: { type: 'world' },
      url: fullUrl,
    }

    const wsId = Symbol(clientUUID)
    server.socketsById.set(wsId, ws)

    const wsLike = makeWsLike(wsId, ws, clientInfo)

    shards
      .handleConnection(clientInfo.shardID, clientInfo.clientUUID, wsLike)
      .then((err) => {
        if (err) {
          console.error('Failed to handle connection', err)
          wsLike.end(WSCloseCodes.internalError, 'failed to handle connection')
        }
      })
      .catch((err) => {
        console.error('Failed to handle connection (exception)', err)
        wsLike.end(WSCloseCodes.internalError, 'failed to handle connection')
      })

    ws.on('message', (data, isBinary) => {
      const err = shards.handleMessage(clientInfo.shardID, clientInfo.clientUUID, toArrayBuffer(data), isBinary)
      if (err) wsLike.end(WSCloseCodes.internalError)
    })

    ws.on('close', (code, reason) => {
      server.unsubscribeAll(wsId)
      server.socketsById.delete(wsId)
      const err = shards.handleClose(clientInfo.shardID, clientInfo.clientUUID)
      if (err) console.error('Failed to handle close', err)
    })

    ws.on('error', (err) => {
      console.error('WebSocket error', err)
      try {
        ws.close()
      } catch {}
    })
  })

  return wss
}

function toArrayBuffer(data: WebSocket.RawData): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  if (Array.isArray(data)) {
    const buf = Buffer.concat(data)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
