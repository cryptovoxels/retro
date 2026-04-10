import { Component } from 'preact'
import { encodeCoords, fetchFromMPServer } from '../../../common/helpers/utils'
import Connector from '../../connector'
import type { Scene } from '../../scene'

type UserState = {
  name: string
  position: number[]
  wallet?: string
  lastSeen?: number
}

type ParcelLookup = Record<number, { name?: string; address?: string }>

type UsersOnlineState = {
  users: UserState[]
  loading: boolean
  parcelLookup: ParcelLookup
}

type Props = {
  scene: Scene
}

export class UsersOnline extends Component<Props, any> {
  state: UsersOnlineState

  constructor() {
    super()

    this.state = {
      users: [],
      loading: true,
      parcelLookup: {},
    }
  }

  get connector() {
    return window.connector
  }

  componentDidMount() {
    this.fetchOnlineUsers()
    this.fetchParcelLookup()
  }

  async fetchOnlineUsers() {
    this.setState({ loading: true })
    const r = await fetchFromMPServer<{ users?: UserState[] }>('/api/users.json')

    if (r && r.users) {
      const users = r.users.map((u) => {
        if (u.name) {
          return u
        }
        u.name = u.wallet?.substring(0, 10) || 'anon'
        return u
      })
      this.setState({ users, loading: false })
    } else {
      this.setState({ loading: false })
    }
  }

  async fetchParcelLookup() {
    try {
      const res = await fetch(`${process.env.API}/parcels/cached.json`)
      if (!res.ok) return
      const data = await res.json()
      if (!data?.parcels) return
      const lookup: ParcelLookup = {}
      for (const p of data.parcels) {
        lookup[p.id] = { name: p.name, address: p.address }
      }
      this.setState({ parcelLookup: lookup })
    } catch {
      // non-critical
    }
  }

  render() {
    const users = this.state.users.map((u) => {
      const parcelInfo = u.lastSeen ? this.state.parcelLookup[u.lastSeen] : undefined
      return <UserItem key={u.wallet} scene={this.props.scene} connector={this.connector} user={u} parcelInfo={parcelInfo} />
    })

    return <ul className="ExplorerUsersOnline">{users}</ul>
  }
}

const UserItem = ({ scene, connector, user, parcelInfo }: { scene: Scene; connector: Connector; user: UserState; parcelInfo?: { name?: string; address?: string } }) => {
  const teleportTo = (user: UserState) => {
    const v = BABYLON.Vector3.FromArray(user.position)
    v.z += 1.5
    const coords = encodeCoords({
      position: v,
      rotation: new BABYLON.Vector3(0, Math.PI, 0),
      flying: true,
    })
    const url = `/play?coords=${coords}`
    if (scene.config.isGrid) {
      window.persona.teleport(url)
      return
    }
    window.open(url)!.focus()
  }

  const getAvatar = (wallet: string) => {
    if (!connector) {
      return null
    }
    return connector.findAvatarByWallet(wallet)
  }

  const onWalletClick = (wallet: string) => {
    window.open(`${process.env.ASSET_PATH}/u/${wallet}`, '_blank')
  }

  const locationLabel = parcelInfo?.name || parcelInfo?.address

  return (
    <li>
      <div>
        <h2>
          <a style={{ cursor: 'pointer' }} onClick={() => user.wallet && onWalletClick(user.wallet)} title="See profile">
            {user.name}
          </a>
        </h2>
        {locationLabel && <small style={{ opacity: 0.6 }}>{locationLabel}</small>}
      </div>
      <div>
        <button onClick={() => teleportTo(user)}>Teleport to</button>
      </div>
    </li>
  )
}
