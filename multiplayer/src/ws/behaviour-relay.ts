// Behaviour state/signal relay - parallel to the grid state system.
// Holds last-write-wins state per (parcelId, featureId, behaviourIdx) and
// rebroadcasts to every other client on the shard. New joiners get a snapshot.
// Parcel state is evicted 5 minutes after the last write to that parcel.

import * as messages from '../../../common/messages'
import { toBuffer } from '../utility/toBuffer'
import type { Client } from './client'
import type { Shard } from './shards/shard'

type StateKey = string // `${parcelId}:${featureId}:${idx}`

const stateKey = (parcelId: number, featureId: string, idx: number): StateKey => `${parcelId}:${featureId}:${idx}`

const TTL_MS = 5 * 60 * 1000

export class BehaviourRelay {
  private states = new Map<StateKey, messages.BehaviourStateMessage>()
  private parcelAccess = new Map<number, number>() // parcelId -> last-write timestamp

  constructor(private shard: Shard) {}

  private touch(parcelId: number) {
    this.parcelAccess.set(parcelId, Date.now())
  }

  // Evict all state for parcels not written to in the last TTL_MS.
  evict() {
    const cutoff = Date.now() - TTL_MS
    for (const [parcelId, last] of this.parcelAccess) {
      if (last >= cutoff) continue
      this.parcelAccess.delete(parcelId)
      for (const k of this.states.keys()) {
        if (k.startsWith(`${parcelId}:`)) this.states.delete(k)
      }
    }
  }

  handleState(client: Client, msg: messages.BehaviourStateMessage, raw: Buffer) {
    if (typeof msg.parcelId !== 'number') return
    if (typeof msg.featureId !== 'string') return
    const k = stateKey(msg.parcelId, msg.featureId, msg.behaviourIdx)
    const existing = this.states.get(k)
    if (existing && existing.seq >= msg.seq) return
    this.states.set(k, msg)
    this.touch(msg.parcelId)
    this.shard.broadcastFromClient(msg, raw, client.clientUUID)
  }

  handleSignal(client: Client, msg: messages.BehaviourSignalMessage, raw: Buffer) {
    if (typeof msg.parcelId !== 'number') return
    this.shard.broadcastFromClient(msg, raw, client.clientUUID)
  }

  // Send the snapshot for a parcel to a single client (called when client enters parcel range).
  sendSnapshot(client: Client, parcelId: number) {
    for (const msg of this.states.values()) {
      if (msg.parcelId !== parcelId) continue
      client.send(toBuffer(messages.BehaviourStateEncoder(msg)), msg.type)
    }
  }
}
