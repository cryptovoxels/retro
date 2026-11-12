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
import type { Womp } from './tiles/womp-tile'
import Teleport from './components/teleport'

export default class Explore extends Component<{ womps?: Womp[] }> {
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
        <Head title="Voxels" description="Voxels is a virtual world in your browser: voxel parcels on Ethereum you can walk around, build on and hang out in. Made by Ben Nolan in Wellington since 2018, open source on GitHub." url="/">
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@graph': [
                  {
                    '@type': 'Organization',
                    name: 'Voxels',
                    url: 'https://www.voxels.com',
                    logo: 'https://www.voxels.com/images/logo-opengraph-small.png',
                    founder: { '@type': 'Person', name: 'Ben Nolan' },
                    sameAs: ['https://github.com/cryptovoxels'],
                  },
                  { '@type': 'WebSite', name: 'Voxels', url: 'https://www.voxels.com', description: 'A virtual world in your browser: voxel parcels on Ethereum.' },
                ],
              }),
            }}
          />
        </Head>

        <section class="explorer" onKeyDown={onListArrowKeys}>
          <Teleport>
            <Radar />
            <details class="inspector-section womps" open>
              <summary>womps</summary>
              <WompsList womps={this.props.womps} numberToShow={300} collapsed={false} fetch="/womps.json" ttl={600} />
              <a href="/womps">more</a>
            </details>
            <details class="inspector-section">
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
