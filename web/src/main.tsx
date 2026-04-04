// Must be the first import
if (process.env.NODE_ENV === 'development') {
  // Must use require here as import statements are only allowed
  // to exist at top-level.
  require('preact/debug')
}
import { Component, render } from 'preact'
import { Route, Router, type RouterOnChangeArgs } from 'preact-router'

import AccountCollectibles from '../account/collectibles'
import NewSpace from '../account/new-space'
import Asset from './asset'
import Assets from './assets'
import EditAsset from './assets/edit'
import { SignIn } from './auth/login'
import Avatar from './avatar'
import CollectionPage from './collection'
import Collections from './components/list-of-collections'
import Snackbar from './components/snackbar'
import Conduct from './conduct'
import EventPage from './event-page'
import Events from './events'
import Explore from './explore'
import Footer from './footer'
import Home from './home'
import Island from './island'
import Islands from './islands'
import Mail from './mail'
import WorldMap from './map'
import Parcel from './parcel'
import Parcels from './parcels'
import Privacy from './privacy'
import RenderAsset from './render/asset'
import RenderCostume from './render/costume'
import Search from './search'
import Space from './space'
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

  return (
    <MainApp>
      <main class="container-fluid">
        <WebHeader path={currentPath} />

        <Router onChange={handleRoute}>
          <Explore path="/" />
          <Terms path="/terms" />
          <Privacy path="/privacy" />
          <Conduct path="/conduct" />
          <NotFound path="/not-found" />

          <Mail path="/mail" />
          <Search path="/search" />

          <Assets path="/assets" />
          <Asset path="/assets/:id" />
          <EditAsset path="/assets/:id/edit" />
          <RenderAsset path="/assets/:id/render" />
          <Assets path="/u/:wallet/assets" />

          <Parcels path="/parcels" />
          <Parcel path="/parcels/:id" />
          <Parcel path="/parcels/:id/:section" />

          <Spaces path="/spaces" />
          <NewSpace path="/spaces/new" />
          <Space path="/spaces/:id" />

          <Islands path="/islands" />
          <Island path="/islands/:slug" />
          <WorldMap path="/map" />

          <AccountRoutes path="/account/:path*" />

          <RenderCostume path="/costumes/:id/render" />
          <Avatar path="/avatar/:walletOrName" />
          <Avatar path="/avatar/:walletOrName/:tab?" />
          <Avatar path="/u/:walletOrName" />
          <Avatar path="/u/:walletOrName/:tab?" />

          <Collections path="/collections" />
          <CollectionPage path="/collections/:id" />
          <Wearable path="/collections/:chain_identifier/:address/:token_id" />

          <Womp path="/womps/:id" />
          <EventPage path="/events/:id" />
          <Events path="/events" />
          <WompsPage path="/womps" />

          <IslandsAdmin path="/admin/islands" />
        </Router>
        <Footer />
      </main>

      <Snackbar />
    </MainApp>
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
    return <SignIn />
  }

  return (
    <Router>
      <Route path="/account/:tab?" component={Home} />
      <AccountCollectibles path="/account/collectibles" />
    </Router>
  )
}
