import type http from 'http'
import WebSocket, { WebSocketServer } from 'ws'
import { ClientUUID } from '../common/clientUUID'
import { SpaceId } from '../common/spaceId'
import { APP_NAME } from '../constants/appName'
import { WSCloseCodes } from '../constants/socketCloseCodes'
import { ClientConnectionInformation } from './client'
import { Shards } from './shards/shards'
import type { MultiplayerServer, WsLike } from '../createServer'

/**
 *  Creates the websocket server and handles validating and shuffling off the various events to the shards.
 *  The shards is where the actual game logic and state is managed.
 */
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
    const spaceId = tryDeriveSpaceId(url)

    const fullUrl = url.pathname + (url.search ? url.search : '')
    const clientInfo: ClientConnectionInformation = {
      clientUUID,
      shardID: spaceId ? { type: 'space', spaceId: spaceId.spaceId } : { type: 'world' },
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
      // ensure close handling runs
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

const tryDeriveSpaceId = (url: URL): false | { spaceId: SpaceId } => {
  // For now, very strictly check if the incoming message is for a space. In reality, this check may be too naive.
  // Worst-case scenario, we'll just forward the message to the world server, so at least we won't break multiplayer
  // in the world. We should really have a third state where we boot a connection that isn't for a space, or for the world.
  // But yeah, let's not break the world while this feature is in beta.

  const pathWithoutLeadingSlash = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname
  const spaceIdFromPath = SpaceId.tryParse(pathWithoutLeadingSlash)
  if (spaceIdFromPath) {
    return { spaceId: spaceIdFromPath }
  }

  const spaceIdParam = url.searchParams.get('space_id')
  if (spaceIdParam) {
    const spaceIdFromParam = SpaceId.tryParse(spaceIdParam)
    if (spaceIdFromParam) {
      return { spaceId: spaceIdFromParam }
    }
  }

  return false
}
