import { readFileSync, readdirSync } from 'node:fs'
import { MessageType, type CritterPose } from '../../common/messages'
import type { Client } from './ws/client'
import type { Shard } from './ws/shards/shard'
import { loadNav } from './nav'

type Spawn = { id: number; species: string; island: string; x: number; z: number }
type Region = { core: any; actors: Spawn[] }

let source: string
function scripts() {
  const dir = 'multiplayer/sim/'
  return (source ??= [
    'vector.lua',
    'critter.lua',
    ...readdirSync(dir + 'classes')
      .filter((name) => name.endsWith('.lua'))
      .sort()
      .map((name) => 'classes/' + name),
  ]
    .map((name) => readFileSync(dir + name, 'utf8'))
    .join('\n'))
}

export class Sim {
  private regions = new Map<string, Region>()
  private visible = new Set<Client>()
  private next = 0
  private busy = false

  constructor(private shard: Shard) {}

  update() {
    if (this.busy) return
    this.busy = true
    this.step()
      .catch((error) => {
        console.error('critter simulation', error)
        this.next = Date.now() + 10000
      })
      .finally(() => {
        this.busy = false
      })
  }

  private async step() {
    const clients = Array.from(this.shard.connectedClients.values()).filter((c) => c.position)
    if (!clients.length) {
      this.regions.clear()
      this.visible.clear()
      this.next = 0
      return
    }
    if (Date.now() >= this.next) {
      const viewers = clients.map((c) => ({ x: c.position![0], z: c.position![2], draft: c.draft }))
      const { rows } = await this.shard.connection.query<Spawn>(
        'sim-spawns',
        `select id,species,island,x,z from creatures c where exists (
           select 1 from jsonb_to_recordset($1) as v(x real,z real,draft text)
           where c.x >= floor((v.x-48)/32)*32 and c.x < (floor((v.x+48)/32)+1)*32
           and c.z >= floor((v.z-48)/32)*32 and c.z < (floor((v.z+48)/32)+1)*32
           and (case when c.island like 'draft:%' then substr(c.island,7) else '' end)=v.draft)
         order by id`,
        [JSON.stringify(viewers)],
      )
      const groups = new Map<string, Spawn[]>()
      for (const row of rows) {
        const key = JSON.stringify([row.island, Math.floor(row.x / 32), Math.floor(row.z / 32)])
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(row)
      }
      for (const key of this.regions.keys()) if (!groups.has(key)) this.regions.delete(key)
      for (const [key, rows] of groups) {
        // Load all spawns in the tile so entering from another side sees the same actors.
        if (this.regions.has(key)) continue
        const { island, x, z } = rows[0]
        const left = Math.floor(x / 32) * 32,
          back = Math.floor(z / 32) * 32
        const core = await require('../sim/core.cjs')()
        if (!(await loadNav(this.shard.connection, core, island, left, back))) continue
        if (!core.ccall('boot', 'number', ['string'], [scripts()])) throw Error('invalid critter scripts')
        const actors = rows.filter((r) =>
          core.ccall(
            'spawn',
            'number',
            ['string', 'number', 'number', 'number', 'number'],
            [r.species, r.id, r.x, 0, r.z],
          ),
        )
        this.regions.set(key, { core, actors })
      }
      this.next = Date.now() + 5000
    }
    const snapshots = new Map<Client, CritterPose[]>()
    for (const { core, actors } of this.regions.values())
      for (const actor of actors) {
        const ptr = core._tick(actor.id, 0.2)
        if (!ptr) continue
        const [x, y, z, rx, ry, rz, phase] = core.HEAPF32.subarray(ptr / 4, ptr / 4 + 7)
        const pose: CritterPose = [actor.id, actor.species, [x, y, z], [rx, ry, rz], phase]
        for (const c of clients) {
          if (
            c.draft !== (actor.island.startsWith('draft:') ? actor.island.slice(6) : '') ||
            Math.hypot(x - c.position![0], z - c.position![2]) > 40
          )
            continue
          if (!snapshots.has(c)) snapshots.set(c, [])
          snapshots.get(c)!.push(pose)
        }
      }
    for (const c of clients)
      if (snapshots.has(c) || this.visible.has(c))
        this.shard.broadcastFromServer(
          { type: MessageType.worldState, avatars: [], critters: snapshots.get(c) ?? [] },
          [c.clientUUID],
        )
    this.visible = new Set(snapshots.keys())
  }
}
