// Must be the first import
if (process.env.NODE_ENV === 'development') {
  // Must use require here as import statements are only allowed
  // to exist at top-level.
  require('preact/debug')
}
import { Component, render } from 'preact'
import { Route, Router, type RouterOnChangeArgs } from 'preact-router'

import EditAccount from '../account/edit'
import { Login } from './auth/login'
import Snackbar from './components/snackbar'
import VoxelRadio from './components/voxel-radio'
import Footer from './footer'
import Home from './home'
import { Client } from './client'
import { getCoords, getParcelId, isEmbedClientPath, isFullClientPath, notifyUrlChange, syncParcelUrl } from './helpers/coords-nav'
import { track, trackPage } from './helpers/umami'
import WebHeader from './web-header'

import { useEffect, useState } from 'preact/hooks'
import { JSXInternal } from 'preact/src/jsx'
import { ensureRadio } from './radio/global'
import { app, AppEvent } from './state'
import { WorldSidebar } from './world-sidebar'
import { AppRoutes } from './app-routes'
import { applyTheme } from '../../common/helpers/theme'

applyTheme()

class MainApp extends Component {
  componentDidMount() {
    app.on(AppEvent.Login, () => {
      track('login')
      this.forceUpdate()
    })
    app.on(AppEvent.Logout, () => {
      track('logout')
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

    const path = e.url.split('?')[0]
    trackPage(path)
    if (path === '/shop') track('visit_shop')

    setCurrentPath(e.url)
    setUrlSearch(location.search)

    app.send({ type: 'navigate', data: e.url })
  }

  const [currentPath, setCurrentPath] = useState(window.location.pathname)
  const [urlSearch, setUrlSearch] = useState(location.search)
  const lightBroadcast = currentPath.startsWith('/golive/broadcast')
  const coords = new URLSearchParams(urlSearch).get('coords') || ''
  const full = isFullClientPath(currentPath)
  const spaceish = isEmbedClientPath(currentPath)
  const scratchpad = currentPath.split('?')[0] === '/scratchpad'
  const showClient = !!coords || spaceish || scratchpad
  const embed = !full && showClient

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

        <WorldSidebar coords={coords} path={currentPath}>
          <Router onChange={handleRoute}>
            {AppRoutes()}
            <RadioPopout path="/radio" />
            <Play path="/play" />
            <Play path="/scratchpad" />
            <Play path="/spaces/:id/play" />
            <Play path="/assets/:id/play" />
            <AccountRoutes path="/account/:path*" />
          </Router>
        </WorldSidebar>
        {!lightBroadcast && !showClient && <Footer />}
      </main>

      {showClient && <Client coords={coords} mode={embed ? 'embed' : 'full'} path={currentPath} />}

      <Snackbar />
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
  // WorldSidebar owns the in-world pane on /play. Don't render a second copy under the aside.
  if (getCoords()) return null
  return (
    <section>
      <p>add coords to play</p>
    </section>
  )
}

function hydrate(vnode: JSXInternal.Element, parent: HTMLElement) {
  let replace = parent.firstElementChild ?? undefined
  // SSR dumps route fragments as body siblings (live-hero + columns). Main adds <main>.
  // Nuke all of them or the leftovers stack under the client tree.
  if (replace && replace.tagName !== 'MAIN') {
    while (parent.firstElementChild) parent.firstElementChild.remove()
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
