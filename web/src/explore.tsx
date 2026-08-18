import { Component, Fragment } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { currentVersion } from '../../common/version'
import { focusFirst, onListArrowKeys } from './helpers/keynav'
import Head from './components/head'
import BlogTeaser from './components/blog-teaser'
import Classifieds from './components/classifieds'
import PopularParcels from './components/popular-parcels'
import Radar from './components/radar'
import type { Womp } from './components/womp-card'
import { getClientPath } from './helpers/client-helpers'
import { getCoords, naviportHere } from './helpers/coords-nav'
import cachedFetch from './helpers/cached-fetch'
import { FOCUS_EXPLORE } from './helpers/open-explore'
import { app, AppEvent } from './state'
import WompsList from './womps-list'

function busiestParcel(): Promise<number | null> {
  return new Promise((resolve) => {
    const es = new EventSource('/api/users/live')
    const done = (id: number | null) => {
      clearTimeout(t)
      es.close()
      resolve(id)
    }
    const t = setTimeout(() => done(null), 3000)
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type !== 'snapshot') return
        const counts = new Map<number, number>()
        for (const u of msg.users ?? []) {
          if (u.parcel == null) continue
          counts.set(u.parcel, (counts.get(u.parcel) ?? 0) + 1)
        }
        let best: number | null = null
        let n = 0
        for (const [id, c] of counts) {
          if (c > n) {
            n = c
            best = id
          }
        }
        done(best)
      } catch {
        done(null)
      }
    }
    es.onerror = () => done(null)
  })
}

async function popularParcel(): Promise<number | null> {
  try {
    const r = await cachedFetch('/api/metrics/popular')
    const data = await r.json()
    if (!data.ok) return null
    return data.metrics?.[0]?.parcel?.id ?? null
  } catch {
    return null
  }
}

async function pickFrontpageParcel() {
  if (getCoords()) return
  const id = (await busiestParcel()) ?? (await popularParcel())
  if (!id) return
  const url = await new ParcelHelper({ id }).spawnUrl()
  naviportHere(url, id)
}

function teleportToWomp(womp: Womp) {
  if (!womp.coords) return
  if (womp.space_id) {
    window.location.href = `/spaces/${womp.space_id}`
    return
  }
  window.persona.teleport(womp.coords)
}

export default class Explore extends Component<{}> {
  componentDidMount() {
    app.on(AppEvent.Logout, this.rerender)
    app.on(AppEvent.Login, this.rerender)
    void pickFrontpageParcel()
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
        <Head title="Voxels (formerly Cryptovoxels)" url={'/'}>
          <Fragment>
            <link rel="prefetch" href={getClientPath(currentVersion)} />
            <link rel="prefetch" href="/api/parcels/cached.json" />
            <link rel="prefetch" href="/api/parcels/map.json" />
          </Fragment>
        </Head>

        <section class="columns home">
          <article>
            <div class="client-slot" />
          </article>
          <aside>
            <section class="explorer" onKeyDown={onListArrowKeys}>
              <Radar teleportTo={(coords) => window.persona.teleport(coords)} />
              <h3>Popular</h3>
              <PopularParcels />
              <BlogTeaser />
              <Classifieds limit={3} />
            </section>
          </aside>
        </section>
      </Fragment>
    )
  }
}
