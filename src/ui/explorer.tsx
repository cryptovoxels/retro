import { Component, ComponentChildren } from 'preact'
import { requestPointerLockIfNoOverlays } from '../../common/helpers/ui-helpers'
import { app, AppEvent } from '../../web/src/state'
import { CommunityEvents } from '../components/explorer/events'
import { AccountParcels, ParcelsList } from '../components/explorer/parcels'
import Radar from '../../web/src/components/radar'
import { Womp } from '../../web/src/components/womp-card'
import WompsList from '../../web/src/womps-list'
import BlogTeaser from '../../web/src/components/blog-teaser'
import Classifieds from '../../web/src/components/classifieds'
import PopularParcels from '../../web/src/components/popular-parcels'
import PostPage from '../../web/src/post'
import { BigMap } from './map-overlay'
import { ExplorerSearchBar } from './search-bar'

const { setInterval } = window

// 'womps' is not in the tab bar - it's the "see more" view of the Latest tab, back returns to users
export type Tab = 'users' | 'events' | 'parcels' | 'map' | 'womps'

export type ParcelsSubTab = 'top' | 'my-parcels' | 'all'

interface Props {
  onClose?: () => void
  scene: BABYLON.Scene
  initialTab?: Tab
  autoFocusSearch?: boolean
}

interface State {
  tab: Tab
  subTab: ParcelsSubTab
  signedIn?: boolean
  clients?: number
  searchQuery?: string
  post: string | null
}

export class ExplorerUI extends Component<Props, State> {
  static currentElement: Element | null
  static currentTab: Tab | null = 'users'
  // null so the constructor can pick Top - was hardcoded
  // 'all', so the first Parcels click always showed the world list even when logged in
  static currentSubTab: ParcelsSubTab | null = null
  interval: string | number | NodeJS.Timeout | undefined
  abort: AbortController | null = null

  constructor(props: Props) {
    super()

    this.state = {
      // survive parent remounts (InWorldPane / WorldSidebar bump a lot)
      tab: props.initialTab ?? ExplorerUI.currentTab ?? 'users',
      subTab: ExplorerUI.currentSubTab ?? 'top',
      signedIn: app.signedIn,
      clients: 0,
      post: null,
    }
  }

  /**
   * Return an array of the main tabs
   * {name:string,tab:'Tab type'}
   */
  get mainTabs(): Array<{ name: string; tab: Tab }> {
    const tabs: Array<{ name: string; tab: Tab }> = [
      { name: 'Latest', tab: 'users' },
      { name: 'Parcels', tab: 'parcels' },
      { name: 'Events', tab: 'events' },
      { name: 'Map', tab: 'map' },
    ]

    // tabs.push()

    return tabs
  }

  /**
   * Return an array of the sub-tabs for the parcel tab.
   * {name:string,tab:'sub-Tab type'}
   */
  get parcelsSubTabs(): Array<{ name: string; tab: ParcelsSubTab }> {
    return [
      { name: 'Top', tab: 'top' },
      { name: 'My parcels', tab: 'my-parcels' },
      { name: 'All', tab: 'all' },
    ]
  }

  componentDidMount() {
    if (this.abort) {
      this.abort.abort('ABORT:starting new request')
      this.abort = null
    }
    this.abort = new AbortController()
    app.on(AppEvent.Change, this.onAppChange)
    this.fetchClients(this.abort.signal)
    this.interval = setInterval(
      () => {
        if (!this.abort || this.abort.signal.aborted) {
          return
        }
        this.fetchClients(this.abort?.signal)
      },
      10000,
      {
        signal: this.abort.signal,
      },
    )
    ExplorerUI.currentTab = this.state.tab
    ExplorerUI.currentSubTab = this.state.subTab
  }

  onAppChange = () => {
    this.setState({ signedIn: app.signedIn })
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    // leaving parcels snaps the next visit back to Top
    if (prevState.tab !== this.state.tab && prevState.tab == 'parcels') {
      this.setState({ subTab: 'top' })
    }
    ExplorerUI.currentTab = this.state.tab
    ExplorerUI.currentSubTab = this.state.subTab
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Change, this.onAppChange)
    this.interval && clearInterval(this.interval)
    // keep currentTab so a remount does not snap back to Latest
    this.abort?.abort('ABORT: quitting component')
    this.abort = null
  }

  /**
   * Fetch clients online.
   */
  fetchClients(signal?: AbortSignal) {
    // /mp routes to the multiplayer server (same origin in prod). Dev points at prod MP, same as fetchFromMPServer.
    const host = process.env.NODE_ENV === 'production' ? '' : 'https://voxels.com'
    return fetch(`${host}/mp/`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal,
    })
      .then((r) => r.json())
      .then((r) => {
        if (r.clients) {
          this.setState({ clients: r.clients })
        }
      })
      .catch((e) => {
        if (typeof e == 'string' && e.startsWith('ABORT')) {
          return
        }
      })
  }

  close = () => {
    this.props.onClose?.()
  }

  closeWithPointerLock = () => {
    this.close()
    requestPointerLockIfNoOverlays()
  }

  async setTab(tab: Tab, subTab?: ParcelsSubTab) {
    await new Promise<void>((resolve) => this.setState((prev) => ({ tab, subTab: subTab ?? prev.subTab }), resolve))
  }

  teleportToWomp = (womp: Womp) => {
    if (!womp.coords) return
    // scratchpad/spaces have no world grid; in-place teleport would sit on /scratchpad?coords=...
    if (window.config.isSpace || womp.space_id) {
      const href = womp.space_id ? `/spaces/${womp.space_id}/play?coords=${womp.coords}` : `/play?coords=${womp.coords}`
      window.location.href = href
      return
    }
    window.persona.teleport(womp.coords)
    this.closeWithPointerLock()
  }

  render() {
    // Main tab menu
    const mainTabs = this.mainTabs.map((i) => {
      // the womps view is Latest's see-more, keep that tab lit
      const active = this.state.tab == i.tab || (this.state.tab == 'womps' && i.tab == 'users')
      const className = active ? '-active' : ''
      return (
        <li key={i.name} tabIndex={0} className={className} onClick={() => this.setTab(i.tab)}>
          {i.name}
        </li>
      )
    })

    let openTab: ComponentChildren
    switch (this.state.tab) {
      case 'parcels':
        if (this.state.subTab == 'top') {
          openTab = <PopularParcels />
        } else if (this.state.subTab == 'my-parcels') {
          openTab = <AccountParcels onTeleport={this.closeWithPointerLock} />
        } else {
          openTab = <ParcelsList onTeleport={this.closeWithPointerLock} />
        }
        break
      case 'events':
        openTab = (
          <>
            <p>
              <a href="/events/new">New event</a>
            </p>
            <CommunityEvents />
          </>
        )
        break
      case 'users':
        openTab = (
          <>
            <Radar
              teleportTo={(coords) => {
                window.persona.teleport(coords)
                this.closeWithPointerLock()
              }}
            />
            <CommunityEvents liveOnly />
            <h3>Latest womps</h3>
            <WompsList numberToShow={9} ttl={600} onWompClick={this.teleportToWomp} onSeeMore={() => this.setTab('womps')} />
            <BlogTeaser onOpen={(slug) => this.setState({ post: slug })} />
            <Classifieds limit={3} />
          </>
        )
        break
      case 'womps':
        openTab = (
          <>
            <p class="explorer-back">
              <a onClick={() => this.setTab('users')}>&larr; back</a>
            </p>
            <h3>Womps</h3>
            <WompsList hint={'No womps found'} numberToShow={42} collapsed={false} ttl={600} onWompClick={this.teleportToWomp} />
          </>
        )
        break
      case 'map':
        openTab = <BigMap scene={this.props.scene} onTeleport={this.closeWithPointerLock} />
        break
      default:
        const _never: never = this.state.tab
        break
    }

    if (this.state.post) {
      return <PostPage slug={this.state.post} onBack={() => this.setState({ post: null })} />
    }

    return (
      <section data-tab={this.state.tab} class="explorer">
        <header>
          <h1>Explore</h1>
        </header>

        <ExplorerSearchBar autoFocus={this.props.autoFocusSearch !== false} scene={this.props.scene} />

        <ul class="inline-tabs">{mainTabs}</ul>
        {this.state.tab === 'parcels' && (
          <ul class="demi-tabs">
            {this.parcelsSubTabs.map((i) => (
              <li key={i.tab} tabIndex={0} className={this.state.subTab == i.tab ? '-active' : ''} onClick={() => this.setTab('parcels', i.tab)}>
                {i.name}
              </li>
            ))}
          </ul>
        )}
        <div>{openTab}</div>
      </section>
    )
  }
}
