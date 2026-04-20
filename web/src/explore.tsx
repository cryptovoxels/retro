import { Component, Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { currentVersion } from '../../common/version'
import EventsShowcase from './components/events-showcase'
import Head from './components/head'
import PopularParcels from './components/popular-parcels'
import { Womp } from './components/womp-card'
import { getClientPath } from './helpers/client-helpers'
import { app, AppEvent } from './state'
import WompsList from './womps-list'
import { Client } from './parcel'

type Props = {
  womps?: Womp[]
}

type RESummary = {
  id: number
  name: string
  parcels: {
    id: number
    address: string
    owner: string
  }[]
}

function FreshlyMinted() {
  const [summary, setSummary] = useState<RESummary[]>([])

  async function load() {
    const res = await fetch('/api/real-estate/summary')
    const data = await res.json()
    // console.log(data)
    setSummary(data.summary)
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div>
      <h2>Freshly Minted</h2>
      <ul class="real-estate">
        {summary.map((s) => (
          <li key={s.id}>
            <a href={`/island/${s.id}`}>{s.name}</a>

            <ul>
              {s.parcels.map((p) => (
                <li key={p.id} class={`owner-${p.owner.toLowerCase()}`}>
                  <a href={`/parcels/${p.id}`}>{p.address.slice(0, 2).trim()}</a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
export default class Explore extends Component<any, Props> {
  componentDidMount() {
    app.on(AppEvent.Logout, this.rerender)
    app.on(AppEvent.Login, this.rerender)
  }

  rerender = () => {
    this.forceUpdate()
  }

  componentWillUnmount() {
    app.off(AppEvent.Login, this.rerender)
    app.off(AppEvent.Logout, this.rerender)
  }

  render() {
    const spawnCoords = 'SIT/E@740E,703S'
    const iframeUrl = `/play?coords=${spawnCoords}`
    const parcelId = 4544

    return (
      <section class="columns explore">
        <Head title="" url={'/'}>
          <Fragment>
            <link rel="prefetch" href={getClientPath(currentVersion)} />
            <link rel="prefetch" href="/api/parcels/cached.json" />
            <link rel="prefetch" href="/api/parcels/map.json" />
          </Fragment>
        </Head>

        <h1>Welcome to Voxels!</h1>

        <article>
          <figcaption>
            <button class="secondary">
              <span>Fullscreen</span>
            </button>

            <a class="buttonish" href={iframeUrl}>
              Teleport
            </a>
          </figcaption>

          <figure>
            <Client parcelId={parcelId} src={iframeUrl} coords={spawnCoords} />
          </figure>
        </article>

        <aside>
          <h3>Popular</h3>
          <PopularParcels />

          <h3>Events</h3>

          <EventsShowcase />
        </aside>
      </section>
    )
  }
}
