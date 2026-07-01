////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Types for grid worker and grid socket messages

// Descriptions used in message types

import * as t from 'io-ts'
import { FeatureRecord } from './feature'
import { LightmapStatus, ParcelAuthResult, ParcelRecord, ParcelRef, SimpleParcelRecord } from './parcel'

/**
 * Parcels used by the grid worker - either the Simple parcels, or the Simple Parcle with the single parcel addeed
 */
const GridWorkerParcelRecord = t.union([SimpleParcelRecord, ParcelRecord])
export type GridWorkerParcelRecord = t.TypeOf<typeof GridWorkerParcelRecord>

export const Patch = t.record(t.string, t.unknown)
export type Patch = t.TypeOf<typeof Patch>

export const PatchMessage = t.type(
  {
    type: t.literal('patch'),
    parcelId: t.number,
    patch: Patch,
  },
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
    nftAuth: t.boolean,
  },
  'ParcelAuthMessage',
)

export type ParcelAuthMessage = t.TypeOf<typeof ParcelAuthMessage>

export const LightMapUpdateMessage = t.type(
  {
    type: t.literal('lightmap-status'),
    parcelId: t.number,
    lightmap_url: t.union([t.string, t.null]),
  },
  'LightMapUpdateMessage',
)
export type LightMapUpdateMessage = t.TypeOf<typeof LightMapUpdateMessage>

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

export const LightmapActionMessage = t.intersection(
  [
    t.type({
      type: t.literal('lightmap-action'),
      parcelId: t.number,
    }),
    t.partial({
      requestBake: t.boolean,
      cancelBake: t.boolean,
    }),
  ],
  'LightmapActionMessage',
)
export type LightmapActionMessage = t.TypeOf<typeof LightmapActionMessage>

// Grid Messages sent server->client
export const GridMessage = t.union([PatchMessage, PatchErrorMessage, ParcelAuthMessage, PatchStateMessage, LightMapUpdateMessage, SuspendedMessage, ParcelMetaMessage, ParcelScriptMessage, PongMessage])
export type GridMessage = t.TypeOf<typeof GridMessage>

// Grid Messages sent client->server
export const GridClientMessage = t.union([PatchMessage, SubscriptionMessage, DeleteFeatureMessage, PatchStateMessage, LightmapActionMessage, PingMessage])
export type GridClientMessage = t.TypeOf<typeof GridClientMessage>
