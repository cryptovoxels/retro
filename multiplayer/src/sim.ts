import { readFileSync } from 'node:fs'
import type { Client } from './ws/client'
import type { Shard } from './ws/shards/shard'
import { MessageType, type RatPose, type DressRat } from '../../common/messages'

type Rat = {
  id: number
  name: string
  named_by: string | null
  cap: boolean
  x: number
  z: number
  home: number
  food: number
  carrying: boolean
  species: string
  respawn_at: number
}
const originX = 101,
  originZ = -1068

export class Sim {
  private eagles: Rat[] = []
  private core: any
  private rats: Rat[] = []
  private visible = new Set<Client>()
  private busy = false
  private next = 0
  private saved = 0
  private dirty = false
  private editing = new Set<number>()

  constructor(private shard: Shard) {}

  update() {
    if (this.busy || Date.now() < this.next) return
    const nearby = new Set<Client>()
    for (const c of this.shard.connectedClients.values()) {
      const p = c.position
      if (p && c.texasDraft && Math.hypot(p[0] - 111, p[1] - 1, p[2] + 1058) < 40) nearby.add(c)
    }
    for (const c of this.visible) {
      if (!nearby.has(c) && !c.disposed) this.send([], [c])
    }
    this.visible = nearby
    if (!nearby.size && !this.rats.length && !this.eagles.length) return
    this.busy = true
    this.step()
      .catch((error) => {
        console.error('Texas rats:', error)
        this.next = Date.now() + 10000
      })
      .finally(() => {
        this.busy = false
      })
  }

  private async step() {
    if (!this.visible.size) {
      await this.save()
      this.eagles = []
      this.rats = []
      this.core?._reset()
      return
    }
    if (!this.core) {
      const core = await require('../sim/core.cjs')()
      const source = (file: string) => readFileSync('multiplayer/sim/' + file, 'utf8')
      if (
        !core.ccall(
          'boot',
          'number',
          ['string', 'string'],
          [source('street.txt'), source('rat.lua') + '\n' + source('eagle.lua')],
        )
      )
        throw Error('invalid rat script or street')
      this.core = core
    }
    if (!this.rats.length && !this.eagles.length) {
      const { rows } = await this.shard.connection.query<Rat>(
        'wake-rats',
        "select * from creatures where island='draft:texas' and species in ('rat','eagle') order by species,id limit 105",
      )
      this.core._reset()
      this.eagles = rows.filter((r) => r.species === 'eagle').slice(0, 5)
      this.rats = rows.filter((r) => {
        if (r.species !== 'rat') return false
        const slot = this.core._add((r.x - originX) * 2, (r.z - originZ) * 2, r.home, r.food, Number(r.carrying))
        if (slot >= 0 && r.respawn_at > Date.now()) this.core._burrow(slot, (r.respawn_at - Date.now()) / 1000)
        return slot >= 0
      })
      if (!this.rats.length && !this.eagles.length) {
        this.next = Date.now() + 10000
        return
      }
    }
    const flight = this.core._flock(0.2, this.eagles.length) / 4
    const start = this.core._tick(0.2) / 4
    const data = this.core.HEAPF32
    let mission = false
    const poses: RatPose[] = []
    this.rats.forEach((r, i) => {
      const at = start + 4 * i
      const x = originX + data[at] * 0.5,
        z = originZ + data[at + 2] * 0.5
      const state = data[at + 3]
      const hidden = state < 0
      if (hidden !== Boolean(r.respawn_at)) {
        r.respawn_at = hidden ? Date.now() - state * 1000 : 0
        mission = true
      }
      const carrying = state > 0
      if (carrying !== r.carrying) mission = true
      if (r.x !== x || r.z !== z || mission) this.dirty = true
      Object.assign(r, { x, z, carrying })
      if (state >= 0) poses.push([r.id, x, (data[at + 1] + 1) * 0.5 - 1.26, z, carrying, r.name, r.named_by, r.cap])
    })
    this.eagles.forEach((bird, i) => {
      const at = flight + 3 * i
      poses.push([
        bird.id,
        originX + data[at] * 0.5,
        data[at + 1] * 0.5 - 1.26,
        originZ + data[at + 2] * 0.5,
        false,
        bird.name,
        null,
        false,
        'eagle',
      ])
    })
    this.send(poses, this.visible)
    if (mission || Date.now() - this.saved > 5000) await this.save()
  }

  private send(rats: RatPose[], clients: Iterable<Client>) {
    this.shard.broadcastFromServer(
      { type: MessageType.worldState, avatars: [], rats },
      Array.from(clients, (c) => c.clientUUID),
    )
  }

  private async save() {
    if (!this.dirty) return
    await this.shard.connection.query(
      'save-rats',
      'update creatures c set x=r.x,z=r.z,carrying=r.carrying,respawn_at=r.respawn_at from jsonb_to_recordset($1) as r(id int,x real,z real,carrying boolean,respawn_at double precision) where c.id=r.id',
      [JSON.stringify(this.rats.map(({ id, x, z, carrying, respawn_at }) => ({ id, x, z, carrying, respawn_at })))],
    )
    this.dirty = false
    this.saved = Date.now()
  }

  async dress(c: Client, msg: DressRat) {
    const avatar = c.avatar
    const rat = this.rats.find((r) => r.id === msg.id)
    if (!rat || rat.respawn_at || !avatar || !this.visible.has(c) || !c.position || this.editing.has(rat.id)) return
    if (
      Math.hypot(c.position[0] - rat.x, c.position[2] - rat.z) > 6 ||
      typeof msg.name !== 'string' ||
      typeof msg.cap !== 'boolean'
    )
      return
    const name = msg.name.trim().slice(0, 40)
    if (!name) return
    const wallet = typeof avatar === 'string' ? avatar : avatar.owner
    const by = typeof avatar === 'string' ? avatar : avatar.name || wallet
    this.editing.add(rat.id)
    try {
      const { rows } = await this.shard.connection.query(
        'dress-rat',
        'update creatures set cap=$2, named_by=case when name<>$3 then $4 else named_by end, named_by_wallet=case when name<>$3 then $5 else named_by_wallet end, name=$3 where id=$1 returning name,named_by,cap',
        [rat.id, msg.cap, name, by, wallet],
      )
      const current = this.rats.find((r) => r.id === rat.id)
      if (current && rows[0]) Object.assign(current, rows[0])
    } catch (error) {
      console.error('dress rat:', error)
    } finally {
      this.editing.delete(rat.id)
    }
  }
}
