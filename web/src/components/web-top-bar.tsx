import { Component } from 'preact'
import { app, AppEvent } from '../state'
import { Link } from 'preact-router/match'
import { openMailboxUI } from './mailbox/mailbox-ui'
import UploadButton from './upload-button'

const active = (...args: string[]) => {
  const path = window.location?.pathname ?? ''
  return args.indexOf(path) > -1 ? 'active' : ''
}

type State = {
  signedIn: boolean
  wallet: string | null
  unreadCount: number
  userName?: string
  signInVisible?: boolean
}

export default class WebTopBar extends Component<unknown, State> {
  state: State = {
    signedIn: app.signedIn,
    wallet: app.state.wallet,
    unreadCount: app.state.unreadMailCount,
    userName: app.state.name,
  }

  get hasUnreadMail() {
    return this.state.unreadCount > 0
  }

  onAppChange = () => {
    const { signedIn, state } = app
    this.setState({ signedIn, userName: state.name, wallet: state.wallet, unreadCount: state.unreadMailCount })
  }

  closeOverlays = () => {
    this.setState({ signInVisible: false })
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Change, this.onAppChange)
  }

  logout() {
    this.closeOverlays()
    app.signout()
  }

  render() {
    if (!this.state.signedIn) {
      return (
        <li>
          <a href="/account">Log in</a>
        </li>
      )
    }

    return (
      <>
        <li class={'account ' + active('/home', '/account/collectibles', '/account')}>
          <Link activeClassName="active" href="/account">
            Account
          </Link>

          <ul>
            <li>
              <Link activeClassName="active" href={`/u/${this.state.wallet}/assets`}>
                Assets
              </Link>
            </li>
            <li>
              <Link activeClassName="active" href="/account/collaborations">
                Collabs
              </Link>
            </li>
            <li>
              <Link activeClassName="active" href="/account/favorites">
                Favorites
              </Link>
            </li>
            <li>
              <a href="/mail">Mailbox {this.hasUnreadMail && <span>{this.state.unreadCount}</span>}</a>
            </li>
            <li>
              <Link activeClassName="active" href="/account/parcels">
                Parcels
              </Link>
            </li>
            <li>
              <Link activeClassName="active" href="/account/spaces">
                Spaces
              </Link>
            </li>
            <li>
              <Link activeClassName="active" href="/account/womps">
                Womps
              </Link>
            </li>
          </ul>
        </li>

        <li>
          <a
            href="#signout"
            onClick={(e) => {
              this.logout()
              e.preventDefault()
            }}
          >
            Log out
          </a>
        </li>
      </>
    )
  }
}
