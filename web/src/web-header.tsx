import { Component, JSX } from 'preact'
import { route } from 'preact-router'
import { Link } from 'preact-router/match'
import { isMobile } from '../../common/helpers/detector'
import { ssrFriendlyDocument, ssrFriendlyWindow } from '../../common/helpers/utils'
import { hasMetamask } from './auth/login-helper'
import { login } from './auth/state-login'
import { PanelType } from './components/panel'
import { app, AppEvent } from './state'
import Icon, { CubeIcon } from './components/icons/icons'
import RadioMini from './components/radio-mini'
import { getCoords, withCoords } from './helpers/coords-nav'

const ROUTE_ICONS: Record<string, string> = {
  account: 'account',
  costumer: 'costume',
  assets: 'assets',
  collections: 'collections',
  events: 'events',
  islands: 'islands',
  map: 'map',
  chat: 'chat',
  parcels: 'parcels',
  spaces: 'spaces',
  womps: 'womps',
  scratchpad: 'scratchpad',
}

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
    const toggleMenu = (e: any) => {
      e.preventDefault()
      this.setState({ expanded: !this.state.expanded })
    }

    const path = ssrFriendlyWindow?.location.pathname
    const signedIn = app.signedIn
    const coords = this.props.coords || getCoords()
    const href = (p: string) => (coords ? withCoords(p) : p)

    const activeIcon = (Object.entries(ROUTE_ICONS).find(([r]) => path?.includes(`/${r}`))?.[1] ?? 'v') as any

    const canInstallMetamask = !isMobile() && !hasMetamask()
    const onClick = (e: Event) => {
      if (canInstallMetamask) {
        window.open('https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn', '_blank', 'noopener')
      } else {
        void login.startMetamaskLogin()
      }
    }

    const navLink = (label: string, link: string) => (
      <Link activeClassName="active" href={href(link)}>
        {label}
      </Link>
    )

    return (
      <>
        <header>
          <nav>
            <ul>
              <li class="logo">
                <a href="/">
                  <CubeIcon name={activeIcon} />
                </a>
              </li>
              <li>{navLink(signedIn ? 'Profile' : 'Login', '/account')}</li>
              <li>{navLink('Events', '/events')}</li>
              <li>{navLink('Chat', '/chat')}</li>
              {signedIn && <li>{navLink('Log out', '/logout')}</li>}
              <li>{navLink('...', '/menu')}</li>

              <li>
                <div class="header-end">
                  <RadioMini path={path ?? '/'} />
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
