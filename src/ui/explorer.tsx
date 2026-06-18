import { Component, ComponentChildren } from 'preact'
import { requestPointerLockIfNoOverlays } from '../../common/helpers/ui-helpers'
import { app, AppEvent } from '../../web/src/state'
import { CommunityEvents } from '../components/explorer/events'
import { Home } from '../components/explorer/home'
import { AccountParcels, FavoritesParcels, ParcelsList } from '../components/explorer/parcels'
import Radar from '../../web/src/components/radar'
import { BigMap } from './map-overlay'
import { ExplorerSearchBar } from './search-bar'

const { setInterval } = window

export type Tab = 'home' | 'users' | 'events' | 'parcels' | 'map'

export type ParcelsSubTab = 'my-parcels' | 'favorites' | 'all'

interface Props {
  onClose?: () => void
  scene: BABYLON.Scene
  initialTab?: Tab
}

interface State {
  tab: Tab
  subTab: ParcelsSubTab
  signedIn?: boolean
  clients?: number
  searchQuery?: string
}

export class ExplorerUI extends Component<Props, State> {
  static currentElement: Element | null
  static currentTab: Tab | null = 'home'
  static currentSubTab: ParcelsSubTab | null = 'all'
  interval: string | number | NodeJS.Timeout | undefined
  abort: AbortController | null = null

  constructor(props: Props) {
    super()

    this.state = {
      tab: props.initialTab ?? 'users',
      subTab: app.signedIn ? 'my-parcels' : 'all',
      signedIn: app.signedIn,
      clients: 0,
    }
  }

  /**
   * Return an array of the main tabs
   * {name:string,tab:'Tab type'}
   */
  get mainTabs(): Array<{ name: string; tab: Tab }> {
    const tabs: Array<{ name: string; tab: Tab }> = [
      { name: `Online`, tab: 'users' },
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
      { name: 'My parcels', tab: 'my-parcels' },
      { name: 'Favorites', tab: 'favorites' },
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
    const { signedIn } = app

    this.setState({ signedIn }, () => {
      if (!app.signedIn && this.state.tab !== 'home') {
        this.setState({ tab: 'home' })
      }
    })
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    // If we're switching main tab and the previous main tab was the account tab; set the account sub-tab back to Myparcels.
    if (prevState.tab !== this.state.tab && prevState.tab == 'parcels') {
      this.setState({ subTab: app.signedIn ? 'my-parcels' : 'all' })
    }
    ExplorerUI.currentTab = this.state.tab
    ExplorerUI.currentSubTab = this.state.subTab
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Change, this.onAppChange)
    this.interval && clearInterval(this.interval)
    ExplorerUI.currentTab = null
    ExplorerUI.currentSubTab = null
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
    console.debug('setTab', tab, subTab)
    await new Promise<void>((resolve) =>
      this.setState((prev) => {
        console.debug('setTab setState', tab, subTab)
        console.debug('setTab setState prev', prev)

        return { tab, subTab: subTab ?? prev.subTab }
      }, resolve),
    )

    this.forceUpdate()
  }

  render() {
    // Main tab menu
    const mainTabs = this.mainTabs.map((i) => {
      const className = this.state.tab == i.tab ? '-active' : ''
      return (
        <li key={i.name} tabIndex={0} className={className} onClick={() => this.setTab(i.tab)}>
          {i.name}
        </li>
      )
    })

    let openTab: ComponentChildren
    switch (this.state.tab) {
      case 'parcels':
        if (this.state.subTab == 'my-parcels') {
          openTab = <AccountParcels onTeleport={this.closeWithPointerLock} />
        } else if (this.state.subTab == 'favorites') {
          openTab = <FavoritesParcels onTeleport={this.closeWithPointerLock} />
        } else {
          openTab = <ParcelsList onTeleport={this.closeWithPointerLock} />
        }
        break
      case 'events':
        openTab = <CommunityEvents />
        break
      case 'users':
        openTab = (
          <Radar
            teleportTo={(coords) => {
              window.persona.teleport(coords)
              this.closeWithPointerLock()
            }}
          />
        )
        break
      case 'home':
        openTab = <Home onTeleport={this.closeWithPointerLock} scene={this.props.scene} />
        break
      case 'map':
        openTab = <BigMap scene={this.props.scene} onTeleport={this.closeWithPointerLock} />
        break
      default:
        const _never: never = this.state.tab
        break
    }

    return (
      <section data-tab={this.state.tab} class="explorer">
        <header>
          <h1>Explore</h1>
        </header>

        <ExplorerSearchBar autoFocus={true} scene={this.props.scene} />

        <ul class="inline-tabs">{mainTabs}</ul>
        <div>{openTab}</div>
      </section>
    )
  }
}
