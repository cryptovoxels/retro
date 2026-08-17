import { Component } from 'preact'
import { app, AppEvent } from '../state'
import { Link } from 'preact-router/match'

const active = (...args: string[]) => {
  const path = window.location?.pathname ?? ''
  return args.indexOf(path) > -1 ? 'active' : ''
}

type State = {
  signedIn: boolean
  wallet: string | null
  userName?: string
  signInVisible?: boolean
}

export default class WebTopBar extends Component<unknown, State> {
  state: State = {
    signedIn: app.signedIn,
    wallet: app.state.wallet,
    userName: app.state.name,
  }

  onAppChange = () => {
    const { signedIn, state } = app
    this.setState({ signedIn, userName: state.name, wallet: state.wallet })
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

  render() {
    if (!this.state.signedIn) {
      return (
        <li>
          <a href="/account">Login</a>
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
              <Link activeClassName="active" href="/account/parcels">
                Parcels
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
          <a href="/logout">Log out</a>
        </li>
      </>
    )
  }
}
