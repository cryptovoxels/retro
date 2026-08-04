import { Component, JSX } from 'preact'
import { route } from 'preact-router'
import { Link } from 'preact-router/match'
import { ssrFriendlyDocument } from '../../common/helpers/utils'
import { PanelType } from './components/panel'
import { app, AppEvent } from './state'
import { CubeIcon } from './components/icons/icons'
import VoxelRadio from './components/voxel-radio'
import { getCoords, withCoords } from './helpers/coords-nav'

type Props = {
  path: string
  coords?: string
}

type State = {
  searchResults: string[]
  snackbarMessage: string
  expanded: boolean
  query: string
}

const getQueryParams = () => (ssrFriendlyDocument ? new URLSearchParams(document.location.search.substring(1)) : null)

export default class WebHeader extends Component<Props, State> {
  state: State = {
    searchResults: [],
    snackbarMessage: '',
    expanded: false,
    query: getQueryParams()?.get('q') ?? '',
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    app.on(AppEvent.ProviderMessage, this.onProviderMessage)
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Change, this.onAppChange)
    app.removeListener(AppEvent.ProviderMessage, this.onProviderMessage)
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (prevProps.path !== this.props.path) {
      this.setState({ expanded: false })
    }
  }

  showSnackbar(message: any) {
    this.setState({ snackbarMessage: message })
    setTimeout(() => {
      this.setState({ snackbarMessage: '' })
    }, 5000)
  }

  onAppChange = () => this.forceUpdate()

  onProviderMessage = (message?: string | Error) => app.showSnackbar(message, PanelType.Info)

  onInput = (e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    this.setState({ query: e.currentTarget.value })
  }

  onSubmit = (e: JSX.TargetedEvent<HTMLFormElement, Event>) => {
    e.stopPropagation()
    e.preventDefault()
    this.setState({ expanded: false })
    route(`/search?q=${encodeURIComponent(this.state.query)}`)
  }

  render() {
    const signedIn = app.signedIn
    const admin = app.isAdmin()
    const wallet = app.wallet
    const coords = this.props.coords || getCoords()
    const here = (this.props.path || '').split('?')[0]
    const href = (p: string) => (coords ? withCoords(p) : p)
    // header sits outside <Router>, and ?coords= breaks preact-router's exec match —
    // so activeClassName alone is flaky. class= from pathname is the source of truth.
    const A = ({ to, children }: { to: string; children: any }) => (
      <li>
        <Link activeClassName="active" class={here === to ? 'active' : undefined} href={href(to)} path={to}>
          {children}
        </Link>
      </li>
    )

    return (
      <>
        <header>
          <nav>
            <ul>
              <li class="logo">
                <a href="/">
                  <CubeIcon name="v" />
                </a>
              </li>
              <A to="/">Home</A>
              <A to="/blog">Blog</A>
              <A to="/account">{signedIn ? 'Profile' : 'Login'}</A>
              {signedIn && <A to="/logout">Log out</A>}
              <A to="/play">Play</A>
              <A to="/map">Map</A>
              <A to="/islands">Islands</A>
              <A to="/parcels">Parcels</A>
              <A to="/spaces">Spaces</A>
              <A to="/womps">Womps</A>
              <A to="/events">Events</A>
              <A to="/chat">Chat</A>
              <A to="/golive">Go live</A>
              {signedIn && <A to="/mail">Mail</A>}
              {signedIn && <A to="/account/collaborations">Collabs</A>}
              {signedIn && <A to="/account/favorites">Favorites</A>}
              <A to="/assets">Assets</A>
              <A to="/collections">Collections</A>
              {signedIn && <A to="/costumer">Costume</A>}
              <A to="/shop">Shop</A>
              {signedIn && <A to={wallet ? `/u/${wallet}/assets` : '/assets'}>My assets</A>}
              {signedIn && <A to="/account/parcels">My parcels</A>}
              {signedIn && <A to="/account/spaces">My spaces</A>}
              {signedIn && <A to="/account/womps">My womps</A>}
              <li>
                <a href="https://discord.gg/3RSCZGr3fr" target="_blank" rel="noopener">
                  &rarr; Discord
                </a>
              </li>
              <li>
                <a href="https://www.x.com/cryptovoxels" target="_blank" rel="noopener">
                  &rarr; Twitter
                </a>
              </li>
              <li>
                <a href="https://github.com/cryptovoxels/retro" target="_blank" rel="noopener">
                  &rarr; Github
                </a>
              </li>
              <A to="/radio">Radio</A>
              <A to="/conduct">Conduct</A>
              <A to="/behaviours">Behaviours</A>
              <A to="/privacy">Privacy</A>
              <A to="/terms">Terms</A>
              {admin && <A to="/admin">Admin</A>}

              <li>
                <div class="header-end">
                  <VoxelRadio />
                  <form action="/search" onSubmit={this.onSubmit}>
                    <input name="q" value={this.state.query} type="search" onInput={this.onInput} placeholder="Search" />
                  </form>
                </div>
              </li>
            </ul>
          </nav>
        </header>
      </>
    )
  }
}
