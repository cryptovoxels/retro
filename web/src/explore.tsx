import { Component, Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { currentVersion } from '../../common/version'
import { Event } from '../../common/messages/event'
import Head from './components/head'
import PopularParcels from './components/popular-parcels'
import { getClientPath } from './helpers/client-helpers'
import { getCoords, naviportHere, routeWithCoords } from './helpers/coords-nav'
import cachedFetch from './helpers/cached-fetch'
import { app, AppEvent } from './state'
import Radar from './components/radar'
import Classifieds from './components/classifieds'
import BlogTeaser from './components/blog-teaser'

function countdown(ms: number) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${sec}s`
}

function EventsList() {
  const [events, setEvents] = useState<Event[]>([])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    fetch('/api/events.json')
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []))
  }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const cutoff = now - 24 * 60 * 60 * 1000
  const visible = events.filter((e) => new Date(e.expires_at).getTime() >= cutoff)

  if (visible.length === 0) return null

  return (
    <>
      <h3>Events</h3>
      <table class="events">
        <tbody>
          {visible.slice(0, 5).map((e) => {
            const startsIn = new Date(e.starts_at).getTime() - now
            const live = startsIn <= 0 && new Date(e.expires_at).getTime() > now
            return (
              <tr key={e.id}>
                <td>
                  <a href={`/events/${e.id}`}>{e.name}</a>
                </td>
                <td>{startsIn > 0 ? countdown(startsIn) : live ? 'live' : 'ended'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

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

export default class Explore extends Component {
  componentDidMount() {
    app.on(AppEvent.Logout, this.rerender)
    app.on(AppEvent.Login, this.rerender)
    void pickFrontpageParcel()
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
            <button class="sidebar-close" title="Close - play fullscreen" onClick={() => window.connector && routeWithCoords('/play')}>
              &times;
            </button>
            <BlogTeaser />
            <Radar />
            <EventsList />

            <h3>Popular</h3>
            <PopularParcels />

            <Classifieds limit={3} />
          </aside>
        </section>
      </Fragment>
    )
  }
}
