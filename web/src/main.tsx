// Must be the first import
if (process.env.NODE_ENV === 'development') {
  // Must use require here as import statements are only allowed
  // to exist at top-level.
  require('preact/debug')
}
import { Component, render } from 'preact'
import { Route, Router, route, type RouterOnChangeArgs } from 'preact-router'

import EditAccount from '../account/edit'
import GoLive from '../account/go-live'
import GoLiveBroadcast from '../account/go-live-broadcast'
import NewSpace from '../account/new-space'
import Asset from './asset'
import Assets from './assets'
import AssetsNew from './assets-new'
import BehavioursDoc from './behaviours-doc'
import EditAsset from './assets/edit'
import { Login } from './auth/login'
import Avatar from './avatar'
import Costumer from './costumer'
import CollectionEditPage from './collection-edit'
import CollectionPage from './collection'
import PublishCollection from './collection-publish'
import Collections from './collections'
import CollectionsNew from './collections-new'
import Snackbar from './components/snackbar'
import VoxelRadio from './components/voxel-radio'
import Conduct from './conduct'
import EventPage from './event-page'
import Events from './events'
import EventsNew from './events-new'
import EventsEdit from './events-edit'
import Explore from './explore'
import Footer from './footer'
import Home from './home'
import Logout from './logout'
import Island from './island'
import Islands from './islands'
import Mail from './mail'
import WorldMap from './map'
import Parcel from './parcel'
import { Client } from './client'
import { getCoords, getParcelId, notifyUrlChange, syncParcelUrl } from './helpers/coords-nav'
import ParcelEdit from './parcel-edit'
import Parcels from './parcels'
import Privacy from './privacy'
import RenderAsset from './render/asset'
import RenderCostume from './render/costume'
import Search from './search'
import Shop from './shop'
import Space from './space'
import SpaceEdit from './space-edit'
import Spaces from './spaces'
import Terms from './terms'
import Wearable from './wearable'
import WebHeader from './web-header'
import Womp from './womp'
import WompsPage from './womps'

import { useEffect, useRef, useState } from 'preact/hooks'
import { JSXInternal } from 'preact/src/jsx'
import IslandsAdmin from './admin/islands'
import Admin from './admin/admin'
import NotFound from './not-found'
import { PlayPreview } from './play-preview'
import { maybePlayPreview } from './play-preview-route'
import { ensureRadio } from './radio/global'
import { app, AppEvent } from './state'
import { InWorldPane } from './in-world-pane'
import { WorldSidebar } from './world-sidebar'
import { ChatPage } from './chat-page'

class MainApp extends Component {
  componentDidMount() {
    app.on(AppEvent.Login, () => {
      this.forceUpdate()
    })
    app.on(AppEvent.Logout, () => {
      this.forceUpdate()
    })
  }

  render() {
    return this.props.children
  }
}

;(history as any)['oldPushState'] = history.pushState
history.pushState = function () {
  const url = arguments && arguments[2]
  const previousPath = document.location.pathname
  let path

  if (url) {
    path = url.replace(/\?.+/, '')
  }

  ;(history as any)['oldPushState'].apply(this, arguments as any)

  notifyUrlChange()

  // Only scroll to top if base URL changes, not query string
  if (path !== previousPath) {
    scrollTo(0, 0)
  }
}

const Main = () => {
  // Have server handle path="/parcels/:id/:visit"
  function handleRoute(e: RouterOnChangeArgs) {
    if (/^\/parcels\/\d+\/visit$/.test(e.url)) {
      window.location.href = e.url
    }

    maybePlayPreview(prevUrl.current, e.url)
    prevUrl.current = location.pathname + location.search

    setCurrentPath(e.url)
    setUrlSearch(location.search)

    app.send({ type: 'navigate', data: e.url })
  }

  const [currentPath, setCurrentPath] = useState(window.location.pathname)
  const [urlSearch, setUrlSearch] = useState(location.search)
  const prevUrl = useRef(location.pathname + location.search)
  const lightBroadcast = currentPath.startsWith('/golive/broadcast')
  const coords = new URLSearchParams(urlSearch).get('coords') || ''

  useEffect(() => {
    ensureRadio()
  }, [])

  useEffect(() => {
    const sync = () => setUrlSearch(location.search)
    window.addEventListener('popstate', sync)
    window.addEventListener('urlchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('urlchange', sync)
    }
  }, [])

  useEffect(() => {
    const onExploring = () => {
      if (location.pathname !== '/parcels') return
      const id = getParcelId()
      const c = getCoords()
      if (!id || !c) return
      syncParcelUrl(id)
    }
    app.on(AppEvent.Exploring, onExploring)
    return () => app.removeListener(AppEvent.Exploring, onExploring)
  }, [])

  return (
    <MainApp>
      <main class={lightBroadcast ? 'showbox-light-shell' : ''}>
        {!lightBroadcast && <WebHeader path={currentPath} coords={coords} />}

        {coords && (
          <article>
            <Client coords={coords} />
          </article>
        )}

        <WorldSidebar coords={coords} path={currentPath}>
          <Router onChange={handleRoute}>
            <Explore path="/" />
            <ChatPage path="/chat" />
            <RadioPopout path="/radio" />
            <Play path="/play" />
            <Play path="/scratchpad" />
            <Play path="/spaces/:id/play" />
            <Play path="/assets/:id/play" />
            <Terms path="/terms" />
            <Privacy path="/privacy" />
            <Conduct path="/conduct" />
            <BehavioursDoc path="/behaviours" />
            <Logout path="/logout" />
            <NotFound path="/not-found" />

            <Mail path="/mail" />
            <Search path="/search" />

            <Assets path="/assets" />
            <AssetsNew path="/assets/new" />
            <Asset path="/assets/:id" />
            <EditAsset path="/assets/:id/edit" />
            <RenderAsset path="/assets/:id/render" />
            <Assets path="/u/:wallet/assets" />

            <Parcels path="/parcels" />
            <Parcel path="/parcels/:id" />
            <Parcel path="/parcels/:id/:section" />
            <ParcelEdit path="/parcels/:id/edit" />

            <Spaces path="/spaces" />
            <NewSpace path="/spaces/new" />
            <Space path="/spaces/:id" />
            <SpaceEdit path="/spaces/:id/edit" />

            <Islands path="/islands" />
            <Island path="/islands/:slug" />
            <WorldMap path="/map" />

            <Route path="/golive/broadcast" component={GoLiveBroadcast} />
            <Route path="/golive" component={GoLive} />

            <AccountRoutes path="/account/:path*" />

            <RenderCostume path="/costumes/:id/render" />
            <Avatar path="/avatar/:walletOrName" />
            <Avatar path="/avatar/:walletOrName/:tab?" />
            <Avatar path="/u/:walletOrName" />
            <Avatar path="/u/:walletOrName/:tab?" />

            <Costumer path="/costumer" />
            <Costumer path="/costumer/:costumeId" />

            <Collections path="/collections" />
            <CollectionsNew path="/collections/new" />
            <PublishCollection path="/collections/:mint/publish" />
            <CollectionEditPage path="/collections/:id/edit" />
            <CollectionPage path="/collections/:id" />
            <Wearable path="/collections/:cid/:address/:tid" />

            <Womp path="/womps/:id" />
            <EventPage path="/events/:id" />
            <EventsNew path="/events/new" />
            <EventsEdit path="/events/:id/edit" />
            <Events path="/events" />
            <Shop path="/shop" />
            <WompsPage path="/womps" />

            <IslandsAdmin path="/propose/islands" />
            <Admin path="/admin" />
          </Router>
        </WorldSidebar>
        {!lightBroadcast && !coords && <Footer />}
      </main>

      <Snackbar />
      <PlayPreview />
    </MainApp>
  )
}

// Popped-out radio window (window.open('/radio'))
function RadioPopout(_props: { path?: string }) {
  return (
    <div class="radio-popout">
      <VoxelRadio popped />
    </div>
  )
}

function Play(_props: { path?: string }) {
  // in the world the sidebar defaults to parcel info instead of a dead placeholder;
  // this is also the fallback the sidebar shows whenever no other pane is open.
  if (getCoords()) return <InWorldPane id="info" />
  return (
    <section>
      <p>add coords to play</p>
    </section>
  )
}

function hydrate(vnode: JSXInternal.Element, parent: HTMLElement) {
  let replace = parent.firstElementChild ?? undefined
  // SSR renders route content only (section/article). Main adds <main> + chrome.
  // Reusing the SSR root as replaceNode leaves that markup alongside Main.
  if (replace && replace.tagName !== 'MAIN') {
    replace.remove()
    replace = undefined
  }
  return render(vnode, parent, replace)
}

hydrate(<Main />, document.body)

function AccountRoutes(props: { path?: string }) {
  const [_, setSignedIn] = useState<boolean>(app.signedIn)

  const onAppSignInSignOut = () => {
    setSignedIn(app.signedIn)

    const queryString = window.location.search
    const urlParams = new URLSearchParams(queryString)
    const redirect = urlParams.get('redirect')
    if (!app.signedIn || !redirect) {
      return
    }
    const path = redirect.split('?')[0]
    if (!path.match(/\/[a-z0-9\/]+$/)) {
      console.warn('Can only allow local redirect URLs')
      return
    }
    if (!path.match('//') || redirect.match(':')) {
      // bad url? todo - parse the redirect url better
      console.warn('bad redirection url')
    }
    console.debug(`redirecting to ${redirect}`)
    window.location.replace(`${redirect}`)
  }

  useEffect(() => {
    app.on(AppEvent.Logout, onAppSignInSignOut)
    app.on(AppEvent.Login, onAppSignInSignOut)

    return () => {
      app.removeListener(AppEvent.Logout, onAppSignInSignOut)
      app.removeListener(AppEvent.Login, onAppSignInSignOut)
    }
  }, [])

  if (!app.signedIn) {
    return <Login />
  }

  return (
    <Router>
      <Route path="/account/edit" component={EditAccount} />
      <Route path="/account/:tab?" component={Home} />
    </Router>
  )
}
