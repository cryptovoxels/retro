import { Component, Fragment } from 'preact'
import { currentVersion } from '../../common/version'
import { focusFirst, onListArrowKeys } from './helpers/keynav'
import Head from './components/head'
import BlogTeaser from './components/blog-teaser'
import Classifieds from './components/classifieds'
import PopularParcels from './components/popular-parcels'
import Radar from './components/radar'
import type { Womp } from './components/womp-card'
import { getClientPath } from './helpers/client-helpers'
import { route } from 'preact-router'
import { naviportHere } from './helpers/coords-nav'
import { FOCUS_EXPLORE } from './helpers/open-explore'
import { teleportToLatestWomp } from './helpers/latest-womp'
import { app, AppEvent } from './state'
import WompsList from './womps-list'

function teleportToWomp(womp: Womp) {
  if (!womp.coords) return
  if (womp.space_id) {
    route(`/spaces/${womp.space_id}/play`)
    return
  }
  window.persona.teleport(womp.coords)
}

export default class Explore extends Component<{}> {
  componentDidMount() {
    app.on(AppEvent.Logout, this.rerender)
    app.on(AppEvent.Login, this.rerender)
    void teleportToLatestWomp()
    try {
      if (sessionStorage.getItem(FOCUS_EXPLORE)) {
        sessionStorage.removeItem(FOCUS_EXPLORE)
        focusFirst('.explorer')
      }
    } catch {}
  }

  rerender = () => {
    this.forceUpdate()
  }

  componentWillUnmount() {
    app.off(AppEvent.Login, this.rerender)
    app.off(AppEvent.Logout, this.rerender)
  }

  render() {
    return (
      <Fragment>
        <Head title="Voxels" url="/" />

        <section class="explorer" onKeyDown={onListArrowKeys}>
          <h1>Voxels</h1>
          <a href="/account">Login</a>
          <Radar teleportTo={naviportHere} />
          <h3>Womps</h3>
          <WompsList numberToShow={12} mobilePreview={6} collapsed={false} fetch="/womps.json" ttl={600} onWompClick={teleportToWomp} />
          <h3>Popular</h3>
          <PopularParcels />
          <Classifieds limit={3} />
        </section>
      </Fragment>
    )
  }
}
