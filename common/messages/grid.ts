////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Types for grid worker and grid socket messages

// Descriptions used in message types

import * as t from 'io-ts'
import { FeatureRecord } from './feature'
import { ParcelAuthResult, ParcelRecord, ParcelRef, SimpleParcelRecord } from './parcel'

/**
 * Parcels used by the grid worker - either the Simple parcels, or the Simple Parcle with the single parcel addeed
 */
const GridWorkerParcelRecord = t.union([SimpleParcelRecord, ParcelRecord])
export type GridWorkerParcelRecord = t.TypeOf<typeof GridWorkerParcelRecord>

export const Patch = t.record(t.string, t.unknown)
export type Patch = t.TypeOf<typeof Patch>

export const PatchMessage = t.intersection(
  [
    t.type({
      type: t.literal('patch'),
      parcelId: t.number,
      patch: Patch,
    }),
    // set by the sender when it wants a patch-ack once the save lands
    t.partial({ patchId: t.string }),
  ],
  'PatchMessage',
)
export type PatchMessage = t.TypeOf<typeof PatchMessage>

export const PatchErrorMessage = t.type(
  {
    type: t.literal('patch-error'),
    parcelId: t.number,
    patch: Patch,
    error: t.string,
  },
  'PatchErrorMessage',
)
export type PatchErrorMessage = t.TypeOf<typeof PatchErrorMessage>

export const PatchAckMessage = t.intersection(
  [
    t.type({
      type: t.literal('patch-ack'),
      parcelId: t.number,
      patchId: t.string,
    }),
    t.partial({ error: t.string }),
  ],
  'PatchAckMessage',
)
export type PatchAckMessage = t.TypeOf<typeof PatchAckMessage>

export const PatchStateMessage = t.type(
  {
    type: t.literal('patch-state'),
    parcelId: t.number,
    patch: t.record(t.string, t.any),
  },
  'PatchStateMessage',
)
export type PatchStateMessage = t.TypeOf<typeof PatchStateMessage>

export const ParcelAuthMessage = t.type(
  {
    type: t.literal('parcel-auth'),
    parcelId: t.number,
    auth: ParcelAuthResult,
  },
  'ParcelAuthMessage',
)

export type ParcelAuthMessage = t.TypeOf<typeof ParcelAuthMessage>

export const SuspendedMessage = t.type(
  {
    type: t.literal('suspended'),
    reason: t.string,
    expiresAt: t.string,
  },
  'SuspendedMessage',
)
export type SuspendedMessage = t.TypeOf<typeof SuspendedMessage>

export const ParcelMetaMessage = t.type(
  {
    type: t.literal('parcel-meta'),
    parcelId: t.number,
    meta: ParcelRef,
  },
  'ParcelMetaMessage',
)
export type ParcelMetaMessage = t.TypeOf<typeof ParcelMetaMessage>

export const ParcelScriptMessage = t.type(
  {
    type: t.literal('parcel-script'),
    parcelId: t.number,
  },
  'ParcelScriptMessage',
)
export type ParcelScriptMessage = t.TypeOf<typeof ParcelScriptMessage>

export const SubscriptionMessage = t.type(
  {
    type: t.literal('subscription'),
    parcelId: t.number,
    subscribed: t.boolean,
  },
  'SubscriptionMessage',
)
export type SubscriptionMessage = t.TypeOf<typeof SubscriptionMessage>

export const PingMessage = t.type(
  {
    type: t.literal('ping'),
  },
  'PingMessage',
)
export type PingMessage = t.TypeOf<typeof PingMessage>

export const PongMessage = t.type(
  {
    type: t.literal('pong'),
  },
  'PongMessage',
)
export type PongMessage = t.TypeOf<typeof PongMessage>

export const DeleteFeatureMessage = t.type(
  {
    type: t.literal('delete-feature'),
    parcelId: t.number,
    featureUuid: t.string,
    currentParcelId: t.number,
  },
  'DeleteFeatureMessage',
)
export type DeleteFeatureMessage = t.TypeOf<typeof DeleteFeatureMessage>

// skynet: the agent's browser registers its tools over the grid socket, the server
// relays mcp tool calls from /api/skynet/mcp to it. see server/skynet.ts
export const SkynetToolsMessage = t.type({ type: t.literal('skynet-tools'), tools: t.array(t.unknown) }, 'SkynetToolsMessage')
export type SkynetToolsMessage = t.TypeOf<typeof SkynetToolsMessage>

export const SkynetResultMessage = t.intersection([t.type({ type: t.literal('skynet-result'), id: t.number }), t.partial({ result: t.unknown, error: t.string })], 'SkynetResultMessage')
export type SkynetResultMessage = t.TypeOf<typeof SkynetResultMessage>

export const SkynetCallMessage = t.type({ type: t.literal('skynet-call'), id: t.number, name: t.string, input: t.unknown }, 'SkynetCallMessage')
export type SkynetCallMessage = t.TypeOf<typeof SkynetCallMessage>

// Grid Messages sent server->client
export const GridMessage = t.union([PatchMessage, PatchAckMessage, PatchErrorMessage, ParcelAuthMessage, PatchStateMessage, SuspendedMessage, ParcelMetaMessage, ParcelScriptMessage, PongMessage, SkynetCallMessage])
export type GridMessage = t.TypeOf<typeof GridMessage>

// Grid Messages sent client->server
export const GridClientMessage = t.union([PatchMessage, SubscriptionMessage, DeleteFeatureMessage, PatchStateMessage, PingMessage, SkynetToolsMessage, SkynetResultMessage])
export type GridClientMessage = t.TypeOf<typeof GridClientMessage>
