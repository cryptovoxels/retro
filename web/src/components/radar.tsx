import { Component } from 'preact'
import { avatarName, type AvatarRef } from '../../../common/messages/avatar-ref'
import { AvatarIcon, AvatarLink } from './avatar-link'
import { getParcel, summaryReady } from '../store/index'

type User = { avatar: AvatarRef | null; parcel: number | null }

export default class Radar extends Component<{}, { users: Map<string, User> }> {
  state = { users: new Map<string, User>() }
  es: EventSource | null = null

  componentDidMount() {
    summaryReady.then(() => this.forceUpdate())
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

    if (byParcel.size === 0) return null

    return (
      <details class="inspector-section" open>
        <summary>people online</summary>
        <p>click a name to join them</p>
        <ul class="radar">
          {[...byParcel.entries()].map(([parcelId, users]) => {
            const info = parcelId != null ? getParcel(parcelId).value : null
            const label = info?.name || info?.address || (parcelId ? `parcel ${parcelId}` : 'somewhere')
            return (
              <li key={parcelId ?? 'none'}>
                {parcelId && <a href={`/parcels/${parcelId}`}>{label}</a>}
                <ul>
                  {users.map(({ uuid, avatar }) => {
                    const coords = window.connector?.findAvatar(uuid)?.coords
                    return (
                      <li key={uuid}>
                        <AvatarIcon name={avatar ? avatarName(avatar) : 'anon'} />
                        {coords || parcelId != null ? (
                          <a href={coords ? `/play?coords=${encodeURIComponent(coords)}` : `/parcels/${parcelId}`}>{avatar ? avatarName(avatar) : 'anon'}</a>
                        ) : avatar ? (
                          <AvatarLink avatar={avatar} />
                        ) : (
                          <span>anon</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      </details>
    )
  }
}
