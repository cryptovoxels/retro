import { LightMapUpdateMessage, PatchMessage, PatchStateMessage } from '../../../common/messages/grid'
import log from '../../lib/logger'
import db from '../../pg'
import { GridClusterListener, GridClusterMessage, GridClusterMessageBroker } from '../GridClusterMessageBroker'

const PATCH_CHANNEL = 'patch'
type PatchChannelPayload = {
  sender: string | null
  msg: LightMapUpdateMessage | PatchStateMessage | PatchMessage
  spaceId?: string
}

const META_UPDATE_CHANNEL = 'broadcastmeta'
type MetaUpdateChannelPayload = {
  id: number // Of parcel
  spaceId?: string
}

const BROADCAST_SCRIPT_CHANNEL = 'broadcastscript'
type BroadcastScriptChannelPayload = {
  id: number // Of parcel
  spaceId?: string
}

const CHANNEL_NAMES = [PATCH_CHANNEL, META_UPDATE_CHANNEL, BROADCAST_SCRIPT_CHANNEL] as const

type ChannelName = (typeof CHANNEL_NAMES)[number]

const isChannelName = (channel: string): channel is ChannelName => CHANNEL_NAMES.includes(channel as ChannelName)

export default class PgGridClusterMessageBroker implements GridClusterMessageBroker {
  private publisher: GridClusterMessageBroker['publish'] | null = null
  private listeners: GridClusterListener[] = []

  constructor() {
    db.connect().then((client) => {
      CHANNEL_NAMES.forEach((channel) => {
        client.query(`LISTEN ${channel}`)
      })

      client.on('notification', (notification) => {
        const channel = notification.channel
        if (!isChannelName(channel)) {
          log.warn(`unrecognised channel name: ${JSON.stringify(notification)}`)
          return
        }

        if (!notification.payload) {
          log.warn(`malformed notification received: ${JSON.stringify(notification)}`)
          return
        }

        const payload = JSON.parse(notification.payload)
        const message = mapFromPgNotificationArgs(channel, payload)

        if (message === null) {
          log.warn(`malformed notification received: ${JSON.stringify(notification)}`)
          return
        }

        this.listeners.forEach((l) => l(message))
      })

      this.publisher = (message) => {
        const [channel, payload] = mapToPgNotificationArgs(message)
        log.debug(`pg_notify: Size ${new TextEncoder().encode(JSON.stringify(payload)).length}`)
        client.query(`select pg_notify('${channel}', $1::text)`, [payload]).catch((e) => {
          log.error('pg_notify error:' + e.toString())
        })
      }
    })
  }

  publish(message: GridClusterMessage): void {
    this.publisher && this.publisher(message)
  }

  subscribe(listener: GridClusterListener): void {
    this.listeners.push(listener)
  }
}

type ChannelPayload = PatchChannelPayload | MetaUpdateChannelPayload | BroadcastScriptChannelPayload

const createPatchNotificationArgs = (payload: PatchChannelPayload): [channelName: ChannelName, payload: ChannelPayload] => ['patch', payload]
const createMetaUpdateNotificationArgs = (payload: MetaUpdateChannelPayload): [channelName: ChannelName, payload: ChannelPayload] => ['broadcastmeta', payload]
const createScriptUpdateNotificationArgs = (payload: BroadcastScriptChannelPayload): [channelName: ChannelName, payload: ChannelPayload] => ['broadcastscript', payload]

export function mapToPgNotificationArgs(message: GridClusterMessage): [channelName: ChannelName, payload: ChannelPayload] {
  const [channelName, payload] = mapToPgNotificationArgsWithoutSpaceId(message)

  const payloadWithSpaceId: ChannelPayload =
    'spaceId' in message.payload
      ? {
          ...payload,
          spaceId: message.payload.spaceId,
        }
      : payload

  return [channelName, payloadWithSpaceId]
}

function mapToPgNotificationArgsWithoutSpaceId(message: GridClusterMessage): [channelName: ChannelName, payload: ChannelPayload] {
  switch (message.type) {
    case 'patchCreate':
      return createPatchNotificationArgs({
        sender: message.payload.sender,
        msg: {
          type: 'patch',
          parcelId: message.payload.parcelId,
          patch: message.payload.patch,
        },
      })
    case 'patchStateCreate':
      return createPatchNotificationArgs({
        sender: message.payload.sender,
        msg: {
          type: 'patch-state',
          parcelId: message.payload.parcelId,
          patch: message.payload.patch,
        },
      })
    case 'lightmapUpdate':
      return createPatchNotificationArgs({
        sender: null,
        msg: {
          type: 'lightmap-status',
          parcelId: message.payload.parcelId,
          lightmap_url: message.payload.lightmap_url,
        },
      })
    case 'metaUpdate':
      return createMetaUpdateNotificationArgs({
        id: message.payload.parcelId,
      })
    case 'scriptUpdate':
      return createScriptUpdateNotificationArgs({
        id: message.payload.parcelId,
      })
  }
}

export function mapFromPgNotificationArgs(channel: ChannelName, payload: unknown): GridClusterMessage | null {
  const message = mapFromPgNotificationArgsWithoutSpaceId(channel, payload)
  if (message === null) {
    return null
  }

  const validatedPayload = payload as ChannelPayload
  const messageWithSpaceId: GridClusterMessage = 'spaceId' in validatedPayload ? GridClusterMessage.withSpaceId(message, validatedPayload.spaceId) : message

  return messageWithSpaceId
}

function mapFromPgNotificationArgsWithoutSpaceId(channel: ChannelName, payload: unknown): GridClusterMessage | null {
  switch (channel) {
    case PATCH_CHANNEL: {
      const p = payload as PatchChannelPayload
      switch (p.msg.type) {
        case 'patch':
          return {
            type: 'patchCreate',
            payload: {
              parcelId: p.msg.parcelId,
              patch: p.msg.patch,
              sender: p.sender!,
            },
          }
        case 'patch-state':
          return {
            type: 'patchStateCreate',
            payload: {
              parcelId: p.msg.parcelId,
              patch: p.msg.patch,
              sender: p.sender!,
            },
          }
        case 'lightmap-status':
          return {
            type: 'lightmapUpdate',
            payload: {
              parcelId: p.msg.parcelId,
              lightmap_url: p.msg.lightmap_url,
            },
          }
      }
    }
    case META_UPDATE_CHANNEL: {
      const p = payload as MetaUpdateChannelPayload
      return {
        type: 'metaUpdate',
        payload: {
          parcelId: p.id,
        },
      }
    }
    case BROADCAST_SCRIPT_CHANNEL: {
      const p = payload as BroadcastScriptChannelPayload
      return {
        type: 'scriptUpdate',
        payload: {
          parcelId: p.id,
        },
      }
    }
  }
}
