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
import { sidebarClosed } from '../../src/store'

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

function AdminMenu() {
  return <li>{navLinkActive('Admin', '/admin')}</li>
}

function navLinkActive(label: string, href: string) {
  return (
    <Link activeClassName="active" href={href}>
      {label}
    </Link>
  )
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
    const admin = app.isAdmin()
    const signedIn = app.signedIn
    const coords = this.props.coords || getCoords()
    const href = (p: string) => (coords ? withCoords(p) : p)

    const onPlay = (e: any) => {
      e.preventDefault()
      if (coords) sidebarClosed.value = false
      // the parcel/womp page you're on sets visitUrl so Play enters that world; with no
      // context (e.g. homepage) drop in at the origin instead of an empty /play.
      route(app.visitUrl.value || (coords ? href('/play') : '/play?coords=0E,0N'))
    }

    const isActive = (label?: string) => {
      if (typeof label === undefined) return false
      if (!path) return false
      return path.includes(`/${label!.toLowerCase()}`)
    }

    const activeIcon = (Object.entries(ROUTE_ICONS).find(([r]) => path?.includes(`/${r}`))?.[1] ?? 'v') as any

    const canInstallMetamask = !isMobile() && !hasMetamask()
    const onClick = (e: Event) => {
      if (canInstallMetamask) {
        window.open('https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn', '_blank', 'noopener')
      } else {
        void login.startMetamaskLogin()
      }
    }

    // in split view a collapsed sidebar should pop back open when you click a nav item,
    // even if it's the route you're already on (re-clicking "Go live" etc).
    const navLink = (label: string, link: string, icon: any, active: boolean, extra?: any) => {
      const onNav = (e: any) => {
        if (coords) sidebarClosed.value = false
        extra?.(e)
      }
      return active ? (
        <Link class="active" aria-selected={true} href={href(link)} onClick={onNav}>
          {label}
        </Link>
      ) : (
        <Link activeClassName="active" href={href(link)} onClick={onNav}>
          {label}
        </Link>
      )
    }

    return (
      <>
        <header>
          <nav>
            <ul>
              <li class="home-mobile">
                <a href="/">Home</a>
              </li>
              <li class="logo">
                <a href="/">
                  <CubeIcon name={activeIcon} />
                </a>
              </li>
              <li>
                <button onClick={onPlay} class="big-play">
                  Play
                </button>
              </li>

              <li>{navLink('Go live', '/golive', 'events', path?.startsWith('/golive') ?? false)}</li>

              <li>{navLink(signedIn ? 'Account' : 'Login', '/account', 'account', isActive('account'))}</li>

              {signedIn && <li>{navLink('Costume', '/costumer', 'costume', isActive('costumer'))}</li>}

              <li>{navLink('Assets', '/assets', 'assets', isActive('assets'))}</li>
              <li>{navLink('Collections', '/collections', 'collections', isActive('collections'))}</li>
              <li>{navLink('Events', '/events', 'events', isActive('events'))}</li>
              <li>{navLink('Islands', '/islands', 'islands', isActive('islands'))}</li>
              <li>{navLink('Map', '/map', 'map', isActive('map'))}</li>
              <li>{navLink('Parcels', '/parcels', 'parcels', isActive('parcels'))}</li>
              <li>{navLink('Chat', '/chat', 'chat', path?.startsWith('/chat') ?? false)}</li>
              <li>{navLink('Spaces', '/spaces', 'spaces', isActive('spaces'))}</li>
              <li>{navLink('Womps', '/womps', 'womps', isActive('womps'))}</li>
              <li>{navLink('Scratchpad', '/scratchpad', 'scratchpad', isActive('scratchpad'))}</li>
              <li>{navLink('Help', '/conduct', 'scratchpad', isActive('conduct'))}</li>
              {signedIn && <li>{navLink('Log out', '/logout', 'account', isActive('logout'))}</li>}

              {admin && <AdminMenu />}

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
