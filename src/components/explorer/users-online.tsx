import { Component } from 'preact'
import { encodeCoords, fetchFromMPServer } from '../../../common/helpers/utils'
import Connector from '../../connector'
import type { Scene } from '../../scene'

// Should these types be included in our message types instead?
type UserState = {
  name: string
  position: number[]
  wallet?: string
  lastSeen?: string
}

type UsersOnlineState = {
  users: UserState[]
  loading: boolean
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
    }
  }

  get connector() {
    return window.connector
  }

  componentDidMount() {
    this.fetchOnlineUsers()
  }

  async fetchOnlineUsers() {
    this.setState({ loading: true })
    const r = await fetchFromMPServer<{ users?: UserState[] }>('/api/users.json')

    if (r && r.users) {
      const users = r.users.map((u) => {
        if (u.name) {
          return u
        }
        //rename null names to their shortened wallets
        u.name = u.wallet?.substring(0, 10) || 'anon'
        return u
      })
      this.setState({ users, loading: false })
    } else {
      this.setState({ loading: false })
    }
  }

  render() {
    const users = this.state.users.map((u) => {
      return <UserItem key={u.wallet} scene={this.props.scene} connector={this.connector} user={u} />
    })

    const signedInUsers = this.state.users.filter((u) => u.name !== 'anon')
    const anonCount = this.state.users.length - signedInUsers.length

    return <ul className="ExplorerUsersOnline">{users}</ul>
  }
}

const UserItem = ({ scene, connector, user }: { scene: Scene; connector: Connector; user: UserState }) => {
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

  return (
    <li>
      <div>
        <h2>{user.name}</h2>
      </div>
      <div>
        <button onClick={() => teleportTo(user)}>Teleport to</button>
      </div>
    </li>
  )
}
