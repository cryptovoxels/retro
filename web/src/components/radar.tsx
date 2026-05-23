import { Component } from 'preact'
import type { AvatarRef } from '../../../common/messages/avatar-ref'
import { AvatarLink } from './avatar-link'
import { getParcel } from '../store/index'

type User = { avatar: AvatarRef | null; parcel: number | null }

export default class Radar extends Component<{}, { users: Map<string, User> }> {
  state = { users: new Map<string, User>() }
  es: EventSource | null = null

  componentDidMount() {
    this.es = new EventSource('/api/users/live')
    this.es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        this.setState(({ users }) => {
          const next = new Map(users)
          if (msg.type === 'snapshot') {
            next.clear()
            for (const u of msg.users ?? []) next.set(u.uuid, { avatar: u.avatar, parcel: u.parcel })
          } else if (msg.type === 'move') {
            next.set(msg.uuid, { avatar: msg.avatar, parcel: msg.parcel })
          } else if (msg.type === 'leave') {
            next.delete(msg.uuid)
          }
          return { users: next }
        })
      } catch {}
    }
  }

  componentWillUnmount() {
    this.es?.close()
  }

  render() {
    const byParcel = new Map<number | null, { uuid: string; avatar: AvatarRef | null }[]>()
    for (const [uuid, u] of this.state.users) {
      const key = u.parcel ?? null
      if (!byParcel.has(key)) byParcel.set(key, [])
      byParcel.get(key)!.push({ uuid, avatar: u.avatar })
    }

    if (byParcel.size === 0) return <p>no one online</p>

    return (
      <ul class="radar">
        {[...byParcel.entries()].map(([parcelId, users]) => {
          const info = parcelId != null ? getParcel(parcelId).value : null
          const label = info?.name || info?.address || (parcelId ? `parcel ${parcelId}` : 'somewhere')
          return (
            <li key={parcelId ?? 'none'}>
              {parcelId ? <a href={`/parcels/${parcelId}`}>{label}</a> : <span>{label}</span>}
              <ul>
                {users.map(({ uuid, avatar }) => (
                  <li key={uuid}>{avatar ? <AvatarLink avatar={avatar} /> : <span>anon</span>}</li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    )
  }
}
