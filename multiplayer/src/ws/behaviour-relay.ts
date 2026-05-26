// Behaviour state/signal relay - parallel to the grid state system.
// Holds last-write-wins state per (parcelId, featureId, behaviourIdx) and
// rebroadcasts to every other client on the shard. New joiners get a snapshot.

import * as messages from '../../../common/messages'
import { toBuffer } from '../utility/toBuffer'
import type { Client } from './client'
import type { Shard } from './shards/shard'

type StateKey = string // `${parcelId}:${featureId}:${idx}`

const stateKey = (parcelId: number, featureId: string, idx: number): StateKey => `${parcelId}:${featureId}:${idx}`

export class BehaviourRelay {
  private states = new Map<StateKey, messages.BehaviourStateMessage>()

  constructor(private shard: Shard) {}

  handleState(client: Client, msg: messages.BehaviourStateMessage, raw: Buffer) {
    if (typeof msg.parcelId !== 'number') return
    if (typeof msg.featureId !== 'string') return
    const k = stateKey(msg.parcelId, msg.featureId, msg.behaviourIdx)
    const existing = this.states.get(k)
    if (existing && existing.seq >= msg.seq) return
    this.states.set(k, msg)
    this.shard.broadcastFromClient(msg, raw, client.clientUUID)
  }

  handleSignal(client: Client, msg: messages.BehaviourSignalMessage, raw: Buffer) {
    if (typeof msg.parcelId !== 'number') return
    this.shard.broadcastFromClient(msg, raw, client.clientUUID)
  }

  // Send the snapshot for a parcel to a single client (called when client enters parcel range).
  // For now we send all known states - shards are not parcel-scoped so this is small.
  sendSnapshot(client: Client, parcelId: number) {
    for (const msg of this.states.values()) {
      if (msg.parcelId !== parcelId) continue
      client.send(toBuffer(messages.BehaviourStateEncoder(msg)), msg.type)
    }
  }
}
