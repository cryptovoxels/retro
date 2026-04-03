import { Component, JSX } from 'preact'
import { route } from 'preact-router'
import { Link } from 'preact-router/match'
import { isMobile, supportsXR } from '../../common/helpers/detector'
import { ssrFriendlyDocument, ssrFriendlyWindow } from '../../common/helpers/utils'
import { hasMetamask } from './auth/login-helper'
import { login } from './auth/state-login'
import { PanelType } from './components/panel'
import { app, AppEvent } from './state'
import Logo from './components/logo'

function AdminMenu() {
  return (
    <li>
      Admin
      <ul>
        <li>
          <Link activeClassName="active" href="/admin/islands">
            Islands
          </Link>
        </li>
      </ul>
    </li>
  )
}
type Props = {
  path: string
}

type State = {
  searchResults: string[]
  snackbarMessage: string
  expanded: boolean
  query: string
  mobileMenuOpen: boolean
}

const getQueryParams = () => (ssrFriendlyDocument ? new URLSearchParams(document.location.search.substring(1)) : null)

const questUrl = (linkUrl: string) => {
  try {
    const sendToQuestUrl = new URL('https://oculus.com/open_url/')
    sendToQuestUrl.searchParams.set('url', new URL(linkUrl, document.baseURI).href)

    return sendToQuestUrl.toString()
  } catch (e) {
    // serverside - no document
    return linkUrl
  }
}

export default class WebHeader extends Component<Props, State> {
  state: State = {
    searchResults: [],
    snackbarMessage: '',
    expanded: false,
    query: getQueryParams()?.get('q') ?? '',
    mobileMenuOpen: false,
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    app.on(AppEvent.ProviderMessage, this.onProviderMessage)
  }

  componentWillUnmount() {
    // Removes listeners to avoid leaks.
    app.removeListener(AppEvent.Change, this.onAppChange)
    app.removeListener(AppEvent.ProviderMessage, this.onProviderMessage)
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (prevProps.path !== this.props.path) {
      this.setState({ expanded: false, mobileMenuOpen: false })
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

  onSignOut = () => app.signout()

  toggleMobileMenu = () => {
    this.setState({ mobileMenuOpen: !this.state.mobileMenuOpen })
  }

  closeMobileMenu = () => {
    this.setState({ mobileMenuOpen: false })
  }

  render() {
    const toggleMenu = (e: any) => {
      e.preventDefault()
      this.setState({ expanded: !this.state.expanded })
    }

    const visitUrl = ((app.visitUrl && app.visitUrl.value) || '/play') as string
    let xrUrl = null

    if (visitUrl !== '/play') {
      xrUrl = [visitUrl, visitUrl.match(/\?/) ? '&' : '?', 'xr=true'].join('')

      if (!supportsXR()) {
        xrUrl = questUrl(visitUrl)
      }
    }

    const path = ssrFriendlyWindow?.location.pathname
    const admin = app.isAdmin()
    const signedIn = app.signedIn

    const onPlay = (e: any) => {
      e.preventDefault()
      window.location.href = '/play?coords=SE@665E,648S'
    }

    const isActive = (label?: string) => {
      if (typeof label === undefined) return false
      if (!path) return false
      return path.includes(`/${label!.toLowerCase()}`)
    }

    const canInstallMetamask = !isMobile() && !hasMetamask()
    const onClick = (e: Event) => {
      if (canInstallMetamask) {
        window.open('https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn', '_blank', 'noopener')
      } else {
        login.signin()
      }
    }

    return (
      <>
        <header>
          <nav>
            <ul>
              <li>
                <Logo />
              </li>
              <li>
                <button onClick={onPlay} class="big-play">
                  Play
                </button>
              </li>

              <li>
                <Link aria-current={isActive('account') ? 'page' : undefined} activeClassName="active" href="/account" onClick={this.closeMobileMenu}>
                  {signedIn ? 'Account' : 'Sign In'}
                </Link>
              </li>

              <li>
                <Link aria-current={isActive('assets') ? 'page' : undefined} activeClassName="active" href="/assets" onClick={this.closeMobileMenu}>
                  Assets
                </Link>
              </li>
              <li>
                <Link aria-current={isActive('collections') ? 'page' : undefined} activeClassName="active" href="/collections" onClick={this.closeMobileMenu}>
                  Collections
                </Link>
              </li>
              <li>
                <Link aria-current={isActive('events') ? 'page' : undefined} activeClassName="active" href="/events" onClick={this.closeMobileMenu}>
                  Events
                </Link>
              </li>
              <li>
                <Link aria-current={isActive('islands') ? 'page' : undefined} activeClassName="active" href="/islands" onClick={this.closeMobileMenu}>
                  Islands
                </Link>
              </li>
              <li>
                <Link aria-current={isActive('map') ? 'page' : undefined} activeClassName="active" href="/map" onClick={this.closeMobileMenu}>
                  Map
                </Link>
              </li>
              <li>
                <Link aria-current={isActive('parcels') ? 'page' : undefined} activeClassName="active" href="/parcels" onClick={this.closeMobileMenu}>
                  Parcels
                </Link>
              </li>
              <li>
                <Link aria-current={isActive('spaces') ? 'page' : undefined} activeClassName="active" href="/spaces" onClick={this.closeMobileMenu}>
                  Spaces
                </Link>
              </li>
              <li>
                <Link aria-current={isActive('womps') ? 'page' : undefined} activeClassName="active" href="/womps" onClick={this.closeMobileMenu}>
                  Womps
                </Link>
              </li>
              <li>
                <Link activeClassName="active" href="/scratchpad">Scratchpad</Link>
              </li>

              <li>
                <form action="/search" onSubmit={this.onSubmit}>
                  <input name="q" value={this.state.query} type="search" onInput={this.onInput} placeholder="Search" />
                </form>
              </li>
            </ul>
          </nav>
        </header>
      </>
    )
  }
}
