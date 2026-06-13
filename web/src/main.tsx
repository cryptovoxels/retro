// Must be the first import
if (process.env.NODE_ENV === 'development') {
  // Must use require here as import statements are only allowed
  // to exist at top-level.
  require('preact/debug')
}
import { Component, render } from 'preact'
import { Route, Router, type RouterOnChangeArgs } from 'preact-router'

import EditAccount from '../account/edit'
import GoLive from '../account/go-live'
import GoLiveBroadcast from '../account/go-live-broadcast'
import NewSpace from '../account/new-space'
import Asset from './asset'
import Assets from './assets'
import AssetsNew from './assets-new'
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
import ParcelEdit from './parcel-edit'
import Parcels from './parcels'
import Privacy from './privacy'
import RenderAsset from './render/asset'
import RenderCostume from './render/costume'
import Search from './search'
import Space from './space'
import SpaceEdit from './space-edit'
import Spaces from './spaces'
import Terms from './terms'
import Wearable from './wearable'
import WebHeader from './web-header'
import Womp from './womp'
import WompsPage from './womps'

import { useEffect, useState } from 'preact/hooks'
import { JSXInternal } from 'preact/src/jsx'
import IslandsAdmin from './admin/islands'
import NotFound from './not-found'
import { app, AppEvent } from './state'

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

    setCurrentPath(e.url)

    app.send({ type: 'navigate', data: e.url })
  }

  const [currentPath, setCurrentPath] = useState(window.location.pathname)
  const lightBroadcast = currentPath.startsWith('/golive/broadcast')
  // fullscreen world view: no web header/footer chrome
  const fullWorld = currentPath.startsWith('/play') || currentPath.startsWith('/scratchpad') || currentPath.endsWith('/play')

  return (
    <MainApp>
      <main class={lightBroadcast ? 'showbox-light-shell' : 'container-fluid'}>
        {!lightBroadcast && !fullWorld && <WebHeader path={currentPath} />}

        <Router onChange={handleRoute}>
          <Explore path="/" />
          <Play path="/play" />
          <Play path="/scratchpad" />
          <Play path="/spaces/:id/play" />
          <Play path="/assets/:id/play" />
          <Terms path="/terms" />
          <Privacy path="/privacy" />
          <Conduct path="/conduct" />
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
          <WompsPage path="/womps" />

          <IslandsAdmin path="/propose/islands" />
        </Router>
        {!lightBroadcast && !fullWorld && <Footer />}
      </main>

      <Snackbar />
    </MainApp>
  )
}

// Fullscreen world. Mounts the persistent canvas layer over a fullscreen placeholder.
function Play(_props: { path?: string }) {
  const coords = new URLSearchParams(window.location.search).get('coords') || ''
  return (
    <div class="world-fullscreen">
      <Client full coords={coords} parcelId={0} />
    </div>
  )
}

function hydrate(vnode: JSXInternal.Element, parent: HTMLElement) {
  return render(vnode, parent, parent.firstElementChild ?? undefined)
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
