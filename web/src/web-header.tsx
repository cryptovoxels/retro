import { Component, JSX } from 'preact'
import { Link } from 'preact-router/match'
import { effect } from '@preact/signals'
import { PanelType } from './components/panel'
import { app, AppEvent, navOpen, toggleFolder } from './state'
import { CubeIcon } from './components/icons/icons'
import VoxelRadio from './components/voxel-radio'
import { route } from 'preact-router'
import { isAddress } from 'ethers'
import cachedFetch from './helpers/cached-fetch'
import Toggle from './components/toggle'
import { messageList } from '../../src/connector'
import { spamhaus } from '../../src/markov-haus'
import { exitPointerLock } from '../../common/helpers/ui-helpers'
import { isOnSandboxParcel, mic, micEnabled, nearestEditableParcel, uiPane, worldUi } from '../../src/store'
import UserMenu from './components/user-menu'
import { loadMe, me } from './auth/identities'
type Props = {
  path: string
}

type State = {
  results: any[]
  snackbarMessage: string
  query: string
  blogN: number
  shopN: number
  eventsN: number
  chatN: number
}

const CHAT_LAST_SEEN = 'chatLastSeenAt'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// /api/search type -> [folder, page], in display order
const GROUPS: [string, string, string][] = [
  ['parcel', 'Parcels', 'parcels'],
  ['avatar', 'Avatars', 'u'],
  ['space', 'Spaces', 'spaces'],
  ['wearable', 'Wearables', 'assets'],
  ['asset', 'Assets', 'assets'],
]

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
    results: [],
    snackbarMessage: '',
    query: '',
    blogN: 0,
    shopN: 0,
    eventsN: 0,
    chatN: 0,
  }

  chatDispose: (() => void) | null = null
  meDispose: (() => void) | null = null
  nav: HTMLElement | null = null
  timer: any = null

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    app.on(AppEvent.ProviderMessage, this.onProviderMessage)
    this.fetchBadges()
    void loadMe()
    this.meDispose = effect(() => {
      me.value
      this.forceUpdate()
    })
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
    this.meDispose?.()
    this.meDispose = null
    clearTimeout(this.timer)
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.path !== this.props.path) {
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
    const query = e.currentTarget.value
    const q = query.trim()
    this.setState({ query, results: q ? this.state.results : [] })
    clearTimeout(this.timer)
    if (!q) return
    this.timer = setTimeout(async () => {
      try {
        const r = await cachedFetch(`/api/search?q=${encodeURIComponent(q)}`, undefined, 300)
        const { results } = await r.json()
        if (q === this.state.query.trim()) this.setState({ results: results || [] })
      } catch {}
    }, 250)
  }

  // enter jumps to the first hit, menu hits render before api results
  onSubmit = (e: JSX.TargetedEvent<HTMLFormElement, Event>) => {
    e.stopPropagation()
    e.preventDefault()
    const q = this.state.query.trim()
    if (!q) return
    if (isAddress(q)) return route(`/u/${q}`)
    this.nav?.querySelector<HTMLElement>('a[data-match]')?.click()
  }

  // arrows step focus through the hits, enter on a focused link is native
  onKeys = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!d || !this.nav || !this.state.query.trim()) return
    const items = [this.nav.querySelector('input'), ...this.nav.querySelectorAll('a[data-match]')] as HTMLElement[]
    const next = items[items.indexOf(document.activeElement as HTMLElement) + d]
    if (!next) return
    e.preventDefault()
    next.focus()
  }

  render() {
    const signedIn = app.signedIn
    const admin = app.isAdmin()
    const here = this.navPath()
    const { blogN, shopN, eventsN, chatN } = this.state
    const { query, results } = this.state
    const q = query.trim().toLowerCase()
    const hit = (s: string) => !!q && s.toLowerCase().includes(q)
    const ui = worldUi.value
    const parcel = nearestEditableParcel.value
    const canEdit = admin || !!parcel?.canEdit
    const canEditHere = !!parcel && canEdit
    const canUseEdit = (signedIn || isOnSandboxParcel()) && canEdit
    const pane = uiPane.value
    const A = ({ to, n = 0, children }: { to: string; n?: number; children: string }) => (
      <li>
        <Link activeClassName="active" class={here === to ? 'active' : undefined} href={to} path={to} data-match={hit(children) || undefined}>
          {children}
          {n > 0 && <span class="badge">{n}</span>}
        </Link>
      </li>
    )
    // in-world action, greyed out when !on
    const W = ({ go, on = true, active, children }: { go: () => void; on?: boolean; active?: boolean; children: string }) => (
      <li class={on ? undefined : 'disabled'}>
        <a
          class={on && active ? 'active' : undefined}
          href="#"
          data-match={hit(children) || undefined}
          onClick={(e) => {
            e.preventDefault()
            if (!on) return
            exitPointerLock()
            go()
          }}
        >
          {children}
        </a>
      </li>
    )
    // walks the vnodes (not the dom) for a matching link
    const found = (v: any): boolean => (Array.isArray(v) ? v.some(found) : v?.type === A || v?.type === W ? hit(v.props.children) : !!v?.props?.children && found(v.props.children))
    const F = ({ name, children }: { name: string; children: any }) => {
      const open = q ? found(children) : !!navOpen.value[name]
      return (
        <li>
          {/* set open via ref, ssr hydration won't patch the attribute */}
          <details
            ref={(el) => {
              if (el) el.open = open
            }}
            onToggle={(e) => {
              // search opens folders, don't save that
              if (!q) toggleFolder(name, e.currentTarget.open)
            }}
          >
            <summary>{name}</summary>
            {children}
          </details>
        </li>
      )
    }

    return (
      <>
        <header class="menu">
          <nav ref={(el) => void (this.nav = el)} onKeyDown={this.onKeys}>
            <ul>
              <li>
                <form onSubmit={this.onSubmit}>
                  <input name="q" value={query} type="search" onInput={this.onInput} placeholder="Search" />
                </form>
                <br />
              </li>
              <li>
                <a href="/">Home</a>
              </li>
            </ul>
            <ul>
              {signedIn ? <UserMenu /> : <A to="/account">Login</A>}
              <F name="Building">
                <ul>
                  <A to="/build">Build</A>
                  {signedIn && <A to="/costumer">Costume</A>}
                  <A to="/golive">Go live</A>
                </ul>
                {ui && (
                  <ul class="world-actions">
                    <A to="/avatar">Avatar</A>
                    {admin && parcel && (
                      <>
                        <W go={() => void parcel.resave()}>resave</W>
                        <W go={() => void spamhaus(parcel)}>spamhaus</W>
                      </>
                    )}
                    <W go={() => (canEditHere ? ui.openBuildToolbelt() : route('/build'))} active={canEditHere && ui.voxelTool.enabled.value}>
                      Build
                    </W>
                    <W go={() => ui.setPane('add')} on={canUseEdit} active={pane === 'add'}>
                      Add
                    </W>
                    <W go={() => ui.setPane('nfts')} on={canUseEdit} active={pane === 'nfts'}>
                      NFTs
                    </W>
                    <W go={() => ui.setPane('parcelSnapshots')} on={canUseEdit} active={pane === 'parcelSnapshots'}>
                      Shots
                    </W>
                    <W go={() => ui.setPane('edit')} on={canUseEdit} active={pane === 'edit'}>
                      Edit
                    </W>
                    <W go={() => ui.setPane('voxels')} on={canUseEdit} active={pane === 'voxels'}>
                      Voxels
                    </W>
                    {micEnabled.value && (
                      <li title="Microphone">
                        <div class="voice-toggle">
                          Voice
                          <Toggle
                            checked={mic.value === 'live'}
                            onChange={() => {
                              ui.toggleVoice()
                            }}
                          />
                        </div>
                      </li>
                    )}
                    {admin && parcel?.needsMint && <W go={() => void parcel.requestMint()}>Mint</W>}
                    {admin && (
                      <W go={() => ui.setPane('debugTool')} active={pane === 'debugTool'}>
                        Debug
                      </W>
                    )}
                  </ul>
                )}
              </F>
              <F name="Exploring">
                <ul>
                  <A to="/assets">Assets</A>
                  <A to="/blog" n={blogN}>
                    Blog
                  </A>
                  <A to="/chat" n={chatN}>
                    Chat
                  </A>
                  <A to="/collections">Collections</A>
                  <A to="/events" n={eventsN}>
                    Events
                  </A>
                  <A to="/islands">Islands</A>
                  <A to="/map">Map</A>
                  <A to="/parcels">Parcels</A>
                  <A to="/shop" n={shopN}>
                    Shop
                  </A>
                  <A to="/womps">Womps</A>
                </ul>
              </F>
              <A to="/settings">Settings</A>
              {admin && <A to="/admin">Admin</A>}
              <F name="Help">
                <ul>
                  <A to="/api">API</A>
                  <A to="/behaviours">Behaviours</A>
                  <A to="/conduct">Conduct</A>
                  <A to="/privacy">Privacy</A>
                  <A to="/terms">Terms</A>
                </ul>
              </F>

              <F name="About">
                <ul>
                  <li>
                    <a href="https://discord.gg/3RSCZGr3fr" target="_blank" rel="noopener">
                      Discord
                    </a>
                  </li>
                  <li>
                    <a href="https://github.com/cryptovoxels/retro" target="_blank" rel="noopener">
                      Github
                    </a>
                  </li>
                  <li>
                    <a href="https://www.x.com/cryptovoxels" target="_blank" rel="noopener">
                      Twitter
                    </a>
                  </li>
                </ul>
              </F>

              {GROUPS.map(([type, name, path]) => {
                const hits = results.filter((r) => r.type === type).slice(0, 20)
                if (!hits.length) return null
                return (
                  <li key={type}>
                    <details open>
                      <summary>{name}</summary>
                      <ul>
                        {hits.map((r) => (
                          <li key={r.id}>
                            <a href={`/${path}/${String(r.id).replace(/^.+:/, '')}`} data-match>
                              {r.name || r.id}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                )
              })}

              <li>
                <div class="header-end">
                  <VoxelRadio />
                </div>
              </li>

              <li>
                <br />
                <small>&copy; 2018-2026 Nolan Consulting Limited</small>
              </li>
            </ul>
          </nav>
        </header>
      </>
    )
  }
}
