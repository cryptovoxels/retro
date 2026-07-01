import { Component, Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { avatarName } from '../../common/messages/avatar-ref'
import { isMobile } from '../../common/helpers/detector'
import { audiencePlayQuery } from '../../common/helpers/parcel-helper'
import { jitterCoord, orderLiveStrip } from '../../common/helpers/utils'
import { currentVersion } from '../../common/version'
import { Event } from '../../common/messages/event'
import Head from './components/head'
import PopularParcels from './components/popular-parcels'
import { Womp } from './components/womp-card'
import { getClientPath } from './helpers/client-helpers'
import { app, AppEvent } from './state'
import WompsList from './womps-list'
import Radar from './components/radar'
import VoxelRadio from './components/voxel-radio'
import Classifieds from './components/classifieds'

type Props = {
  womps?: Womp[]
}

type LiveParcel = { id: number; name?: string; address: string }
type LiveEntry = { room: string; parcel: LiveParcel; coord?: string; avatar: any; thumbnail: string; viewers?: number; ts?: number }

function LiveSection() {
  const [streams, setStreams] = useState<Map<string, LiveEntry>>(new Map())
  const ref = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/live')
    ref.current = es
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      setStreams((prev) => {
        const next = new Map(prev)
        if (msg.type === 'snapshot') msg.entries.forEach((s: LiveEntry) => next.set(s.room, s))
        else if (msg.type === 'remove') next.delete(msg.parcel)
        else next.set(msg.room, { ...next.get(msg.room), ...msg } as LiveEntry)
        return next
      })
    }
    return () => es.close()
  }, [])

  if (streams.size === 0) return null

  const ordered = orderLiveStrip([...streams.values()])

  return (
    <>
      <h3>Live</h3>
      <ul class="live-streams">
        {ordered.map((s) => (
          <li key={s.room}>
            <a href={s.coord ? `/play?${audiencePlayQuery(jitterCoord(s.coord), isMobile())}` : `/parcels/${s.parcel.id}`}>
              <img loading="lazy" src={s.thumbnail} alt="" />
              <span>{s.parcel.name || s.parcel.address}</span>
              <small>{avatarName(s.avatar)}</small>
            </a>
          </li>
        ))}
      </ul>
    </>
  )
}

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
    return (
      <Fragment>
        <Head title="" url={'/'}>
          <Fragment>
            <link rel="prefetch" href={getClientPath(currentVersion)} />
            <link rel="prefetch" href="/api/parcels/cached.json" />
            <link rel="prefetch" href="/api/parcels/map.json" />
          </Fragment>
        </Head>

        <section class="live-hero">
          <LiveSection />
        </section>

        <section class="columns">
          <aside>
            <VoxelRadio />

            <Radar />

            <Classifieds limit={3} />

            <EventsList />

            <h3>Popular</h3>
            <PopularParcels />
          </aside>

          <article>
            <h3>Womps</h3>
            <WompsList numberToShow={20} mobilePreview={6} collapsed={false} fetch="/womps.json" womps={this.props.womps ?? undefined} ttl={600} />
          </article>
        </section>
      </Fragment>
    )
  }
}
