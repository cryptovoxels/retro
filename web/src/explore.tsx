import { Component, Fragment } from 'preact'
import { focusFirst, onListArrowKeys } from './helpers/keynav'
import Head from './components/head'
import Classifieds from './components/classifieds'
import PopularParcels from './components/popular-parcels'
import Radar from './components/radar'
import { FOCUS_EXPLORE } from './helpers/open-explore'
import { teleportToLatestWomp } from './helpers/latest-womp'
import { app, AppEvent } from './state'
import WompsList from './womps-list'
import Teleport from './components/teleport'

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
          <h1>Explore</h1>
          <Teleport>
            <Radar />
            <details class="inspector-section" open>
              <summary>womps</summary>
              <WompsList numberToShow={16} mobilePreview={6} collapsed={false} fetch="/womps.json" ttl={600} />
              <a href="/womps">more</a>
            </details>
            <details class="inspector-section" open>
              <summary>popular</summary>
              <PopularParcels />
            </details>
          </Teleport>
          <details class="inspector-section" open>
            <summary>shop</summary>
            <Classifieds limit={3} />
          </details>
        </section>
      </Fragment>
    )
  }
}
