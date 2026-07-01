import { Component } from 'preact'
import ParcelHelper from '../../../common/helpers/parcel-helper'
import { avatarName, type AvatarRef } from '../../../common/messages/avatar-ref'
import { AvatarLink } from './avatar-link'
import { getParcel, summaryReady } from '../store/index'

type User = { avatar: AvatarRef | null; parcel: number | null }

interface Props {
  teleportTo?: (coords: string) => void
}

export default class Radar extends Component<Props, { users: Map<string, User> }> {
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

  onParcelClick = (e: MouseEvent, parcelId: number) => {
    if (!this.props.teleportTo) return
    e.preventDefault()
    const info = getParcel(parcelId).value
    new ParcelHelper(info ?? { id: parcelId }).spawnUrl().then((url) => this.props.teleportTo?.(url))
  }

  onUserClick = (e: MouseEvent, uuid: string, parcelId: number | null) => {
    if (!this.props.teleportTo) return
    e.preventDefault()
    const local = window.connector?.findAvatar(uuid)
    if (local?.coords) {
      this.props.teleportTo(`/play?coords=${local.coords}`)
      return
    }
    if (parcelId == null) return
    const info = getParcel(parcelId).value
    new ParcelHelper(info ?? { id: parcelId }).spawnUrl().then((url) => this.props.teleportTo?.(url))
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
      <>
        <h3>Radar</h3>
        <ul class="radar">
          {[...byParcel.entries()].map(([parcelId, users]) => {
            const info = parcelId != null ? getParcel(parcelId).value : null
            const label = info?.name || info?.address || (parcelId ? `parcel ${parcelId}` : 'somewhere')
            return (
              <li key={parcelId ?? 'none'}>
                {parcelId ? (
                  <a href={`/parcels/${parcelId}`} onClick={(e) => this.onParcelClick(e, parcelId)}>
                    {label}
                  </a>
                ) : (
                  <span>{label}</span>
                )}
                <ul>
                  {users.map(({ uuid, avatar }) => (
                    <li key={uuid}>
                      {this.props.teleportTo ? (
                        <a href="#" onClick={(e) => this.onUserClick(e, uuid, parcelId)}>
                          {avatar ? avatarName(avatar) : 'anon'}
                        </a>
                      ) : avatar ? (
                        <AvatarLink avatar={avatar} />
                      ) : (
                        <span>anon</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      </>
    )
  }
}
