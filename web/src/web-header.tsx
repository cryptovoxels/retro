import { Component, JSX } from 'preact'
import { Link } from 'preact-router/match'
import { effect } from '@preact/signals'
import { ssrFriendlyDocument } from '../../common/helpers/utils'
import { PanelType } from './components/panel'
import { app, AppEvent } from './state'
import { CubeIcon } from './components/icons/icons'
import VoxelRadio from './components/voxel-radio'
import { getCoords, withCoords, routeWithCoords, notifyUrlChange } from './helpers/coords-nav'
import { route } from 'preact-router'
import cachedFetch from './helpers/cached-fetch'
import { messageList } from '../../src/connector'

type Props = {
  path: string
  coords?: string
}

type State = {
  searchResults: string[]
  snackbarMessage: string
  expanded: boolean
  query: string
  blogN: number
  shopN: number
  eventsN: number
  chatN: number
}

const CHAT_LAST_SEEN = 'chatLastSeenAt'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const getQueryParams = () => (ssrFriendlyDocument ? new URLSearchParams(document.location.search.substring(1)) : null)

function chatLastSeen(): number {
  try {
    const v = localStorage.getItem(CHAT_LAST_SEEN)
    if (v) return parseInt(v, 10) || 0
    // first visit: only count messages from now on
    const now = Date.now()
    localStorage.setItem(CHAT_LAST_SEEN, String(now))
    return now
  } catch {
    return Date.now()
  }
}

function markChatSeen() {
  try {
    localStorage.setItem(CHAT_LAST_SEEN, String(Date.now()))
  } catch {}
}

export default class WebHeader extends Component<Props, State> {
  state: State = {
    searchResults: [],
    snackbarMessage: '',
    expanded: false,
    query: getQueryParams()?.get('q') ?? '',
    blogN: 0,
    shopN: 0,
    eventsN: 0,
    chatN: 0,
  }

  chatDispose: (() => void) | null = null

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    app.on(AppEvent.ProviderMessage, this.onProviderMessage)
    this.fetchBadges()
    if (this.navPath() === '/chat') markChatSeen()
    this.chatDispose = effect(() => {
      const list = messageList.value
      if (this.navPath() === '/chat') {
        markChatSeen()
        this.setState({ chatN: 0 })
        return
      }
      const last = chatLastSeen()
      this.setState({ chatN: list.filter((m) => m.timestamp > last).length })
    })
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Change, this.onAppChange)
    app.removeListener(AppEvent.ProviderMessage, this.onProviderMessage)
    this.chatDispose?.()
    this.chatDispose = null
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (prevProps.path !== this.props.path) {
      this.setState({ expanded: false })
      if (this.navPath() === '/chat') {
        markChatSeen()
        this.setState({ chatN: 0 })
      }
    }
  }

  navPath() {
    return (this.props.path || '').split('?')[0]
  }

  fetchBadges() {
    const weekAgo = Date.now() - WEEK_MS
    cachedFetch('/api/posts.json')
      .then((r) => r.json())
      .then((d) => {
        const n = (d.posts || []).filter((p: any) => new Date(p.created_at).getTime() > weekAgo).length
        this.setState({ blogN: n })
      })
      .catch(() => {})

    cachedFetch('/api/classifieds.json')
      .then((r) => r.json())
      .then((d) => {
        const n = (d.fresh || []).filter((i: any) => i.price > 0 && i.price < 4.2).length
        this.setState({ shopN: n })
      })
      .catch(() => {})

    cachedFetch('/api/events/on.json')
      .then((r) => r.json())
      .then((d) => {
        this.setState({ eventsN: (d.events || []).length })
      })
      .catch(() => {})
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
    const q = this.state.query.trim()
    this.setState({ expanded: false })
    if (!q) return
    // WorldSidebar unmounts <Router> on /play, so route() never swaps the page — hard nav.
    window.location.assign(`/search?q=${encodeURIComponent(q)}`)
  }

  onMiniClick = () => {
    if (!window.connector) return
    routeWithCoords('/play')
  }

  onMiniClose = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    const u = new URL(location.href)
    u.searchParams.delete('coords')
    u.searchParams.delete('parcel')
    route(u.pathname + u.search)
    notifyUrlChange()
  }

  render() {
    const signedIn = app.signedIn
    const admin = app.isAdmin()
    const wallet = app.wallet
    const coords = this.props.coords || getCoords()
    const here = this.navPath()
    const href = (p: string) => (coords ? withCoords(p) : p)
    const { blogN, shopN, eventsN, chatN } = this.state
    // header sits outside <Router>, and ?coords= breaks preact-router's exec match —
    // so activeClassName alone is flaky. class= from pathname is the source of truth.
    const A = ({ to, children }: { to: string; children: any }) => (
      <li>
        <Link activeClassName="active" class={here === to ? 'active' : undefined} href={href(to)} path={to}>
          {children}
        </Link>
      </li>
    )
    const badge = (n: number) => (n > 0 ? <span class="badge">{n}</span> : null)

    return (
      <>
        <button class="hamburger site-nav-toggle" type="button" aria-label={this.state.expanded ? 'Close menu' : 'Open menu'} aria-expanded={this.state.expanded} onClick={() => this.setState({ expanded: !this.state.expanded })}>
          {this.state.expanded ? '×' : '☰'}
        </button>
        <header class={this.state.expanded ? 'nav-open' : undefined}>
          <nav>
            <ul>
              <li class="logo">
                <a href="/">
                  <CubeIcon name="v" />
                </a>
              </li>
              <A to="/">Home</A>
              <A to="/blog">
                Blog
                {badge(blogN)}
              </A>
              <A to="/account">{signedIn ? 'Profile' : 'Login'}</A>
              {signedIn && <A to="/logout">Log out</A>}
              <A to="/play">Play</A>
              <A to="/scratchpad">Scratchpad</A>
              <A to="/map">Map</A>
              <A to="/islands">Islands</A>
              <A to="/parcels">Parcels</A>
              <A to="/spaces">Spaces</A>
              <A to="/womps">Womps</A>
              <A to="/events">
                Events
                {badge(eventsN)}
              </A>
              <A to="/chat">
                Chat
                {badge(chatN)}
              </A>
              <A to="/golive">Go live</A>
              <A to="/assets">Assets</A>
              <A to="/collections">Collections</A>
              {signedIn && <A to="/costumer">Costume</A>}
              <A to="/shop">
                Shop
                {badge(shopN)}
              </A>
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
              <A to="/art">Art</A>
              <A to="/api">API</A>
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
        {/* parked world when you leave /play with coords still in the URL - click expands, X drops coords */}
        <div class="mini-client-dock">
          <button type="button" class="mini-close" title="Close world" onClick={this.onMiniClose}>
            &times;
          </button>
          <div id="mini-client" onClick={this.onMiniClick} />
        </div>
      </>
    )
  }
}
