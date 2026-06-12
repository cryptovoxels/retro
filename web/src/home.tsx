import { Component } from 'preact'
import { ApiAvatar } from '../../common/messages/api-avatars'
import Profile from './components/avatar-profile/profile'
import { Spinner } from './spinner'
import { app } from './state'
import { fetchOptions } from './utils'

export interface Props {
  path?: string
  tab?: string
}

export interface State {
  avatar?: ApiAvatar
}

export default class Home extends Component<Props, State> {
  constructor(props: Props) {
    super()
    this.state = {}
  }

  private get wallet() {
    return app.wallet!
  }

  componentDidMount() {
    this.fetchAvatar()
  }

  fetchAvatar = async () => {
    const avatar: Partial<ApiAvatar> = {}

    const url = `${process.env.API}/avatars/${this.wallet}.json`

    await fetch(url, fetchOptions())
      .then((p) => p.json())
      .then((r) => Object.assign(avatar, r.avatar))
      .then((avatar) => this.setState({ avatar }))
      .catch(console.error)
  }

  render() {
    if (!this.state.avatar) {
      return <Spinner size={24} />
    }

    const avatar = this.state.avatar
    const title = avatar?.name || avatar?.owner

    return (
      <>
        <nav class="account-quick-links">
          <a href="/events/new">New event</a>
          <a href="/golive">Go live</a>
        </nav>
        <Profile walletOrUUId={this.wallet} isOwner={true} tab={this.props.tab} />
      </>
    )
  }
}
