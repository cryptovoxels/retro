import { isAddress } from 'ethers'
import { Component } from 'preact'
import { ApiAvatar } from '../../common/messages/api-avatars'
import Profile from './components/avatar-profile/profile'
import { loadingBox } from './components/loading-icon'
import cachedFetch from './helpers/cached-fetch'
import { app } from './state'
import { fetchOptions } from './utils'

export interface Props {
  avatar?: ApiAvatar
  walletOrName?: string
  path?: string
  tab?: string
}

export interface State {
  avatar: ApiAvatar | undefined
  loading?: boolean
}

export default class Avatar extends Component<Props, State> {
  constructor(props: Props) {
    super()
    this.state = { avatar: props.avatar, loading: true }
  }

  exists = () => {
    return !!this.state.avatar
  }

  private get wallet() {
    if (this.props.walletOrName && this.props.walletOrName.startsWith('0x') && isAddress(this.props.walletOrName)) {
      return this.props.walletOrName
    } else if (this.state.avatar) {
      return this.state.avatar.owner
    } else {
      return this.props.walletOrName
    }
  }

  componentDidMount() {
    this.fetchAvatar()
  }

  fetchAvatar = async () => {
    this.setState({ loading: true })
    let url
    const avatar: Partial<ApiAvatar> = {}
    if (this.props.walletOrName && isAddress(this.props.walletOrName)) {
      url = `${process.env.API}/avatars/${this.props.walletOrName}.json`
      avatar.owner = this.props.walletOrName
    } else {
      url = `${process.env.API}/avatars/by/${this.props.walletOrName}.json`
    }
    await cachedFetch(url, fetchOptions())
      .then((p) => p.json())
      .then((r) => Object.assign(avatar, r.avatar))
      .then((avatar) => {
        if (!avatar || Object.keys(avatar).length === 0) {
          this.setState({ avatar: undefined })
          return
        }
        this.setState({ avatar })
      })
      .catch(console.error)
      .finally(() => this.setState({ loading: false }))
  }

  render() {
    if (this.state.loading) {
      return loadingBox(24)
    }

    if (!this.exists()) {
      return (
        <hgroup>
          <h1>Avatar not found</h1>
          <p>Avatar {this.props.walletOrName} not found</p>
        </hgroup>
      )
    }

    const avatar = this.state.avatar
    const isOwner = this.wallet?.toLowerCase() === app.state?.wallet?.toLowerCase()

    const title = avatar?.name || avatar?.owner
    const description = avatar?.description || `Check out the avatar for ${title}`

    return <Profile walletOrUUId={this.wallet ?? ''} isOwner={isOwner} tab={this.props.tab} />
  }
}
