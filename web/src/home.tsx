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

    return <Profile walletOrUUId={this.wallet} isOwner={true} tab={this.props.tab} />
  }
}
