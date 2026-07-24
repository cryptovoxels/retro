import { Component } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { Interval, intervalAsString, milliSecondsToInterval } from '../../common/helpers/time-helpers'
import { canUseDom, ssrFriendlyWindow } from '../../common/helpers/utils'
import { Event } from '../../common/messages/event'
import Loading from './components/loading'
import ParcelEvent from './helpers/event'
import { app, AppEvent } from './state'
import cachedFetch from './helpers/cached-fetch'
import { fetchOptions } from './utils'
import { PlayButton } from './components/play-button'
import { ParcelMetrics } from './components/metrics'
import { naviportHere } from './helpers/coords-nav'

export interface Props {
  event?: Event
  path?: string
  id?: string
}

export interface State {
  event: Event | null
  loading: boolean
}

export default class EventPage extends Component<Props, State> {
  private parcel: ParcelHelper | null = null
  private helper: ParcelEvent | null = null
  private controller: AbortController | null = null

  constructor(props: Props) {
    super()
    const event = props.event ?? getSSREventData()
    this.state = {
      event: event,
      loading: false,
    }
    this.setEventHelpers(event)
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.forceUpdate.bind(this))
    // we have to fetch if people are navigating between events
    this.fetch()
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props !== prevProps) {
      this.fetch()
    }
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Change, this.forceUpdate)
    this.controller?.abort('ABORT: quitting component')
  }

  fetch() {
    this.controller?.abort('ABORT:starting new request')
    this.controller = new AbortController()
    this.setState({ loading: true })
    return cachedFetch(`/api/events/${this.props.id}.json`, fetchOptions(this.controller))
      .then((r) => r.json())
      .then((r) => {
        this.setEventHelpers(r.event)
        this.setState({ event: r.event }, () => {
          if (this.parcel) naviportHere(this.parcel.centerLocation)
        })
      })
      .finally(() => {
        this.setState({ loading: false })
        this.controller = null
      })
  }

  redirect(where = '/') {
    if (ssrFriendlyWindow) ssrFriendlyWindow.location.href = where
  }

  render() {
    if (!this.state.event || !this.helper) {
      return <Loading />
    }

    const isMod = app.state?.moderator || this.helper.isOwner
    const canEdit = this.helper.canEdit && (this.helper.isOwner || isMod) && this.state.event?.id
    const recent = this.helper.isInPast && Date.now() - this.helper.expires_at.getTime() < 7 * 24 * 60 * 60 * 1000

    return (
      <section class="columns nav">
        <EventsNav activeId={this.props.id} />

        <article>
          <hgroup>
            <h1>{this.state.event.name}</h1>
          </hgroup>
          <figcaption>
            {this.parcel && <PlayButton url={this.parcel.iframeUrl} />}

            {canEdit && (
              <>
                <a class="buttonish" href={`/events/${this.state.event.id}/edit`}>
                  Edit event
                </a>
              </>
            )}
          </figcaption>

          <figure class="shortie">
            <div class="client-slot" />
          </figure>

          <div>{this.state.event.description}</div>
        </article>

        <aside class="push-header">
          <dl>
            {this.helper.isInPast && <SummaryPast event={this.helper} />}
            {this.helper.isLive && <SummaryLive event={this.helper} />}
            {this.helper.isInFuture && <SummaryFuture event={this.helper} />}

            <dt>Duration</dt>
            <dd>{this.helper.duration()}</dd>
            {recent && (
              <>
                <dt>Activity</dt>
                <dd>
                  <ParcelMetrics parcelId={this.state.event.parcel_id} />
                </dd>
              </>
            )}
            <dt>Calendar</dt>
            <dd>
              <a href={`/api/events/${this.state.event.id}.ics`} target="_blank" download={`voxels_event_${this.state.event.id + '.ics'}`}>
                Add to calendar
              </a>
            </dd>
            <dt>Visit</dt>
            <dd>{this.parcel && <PlayButton url={this.parcel.iframeUrl} label={this.helper.isLive ? 'Join' : 'Visit'} />}</dd>
          </dl>
        </aside>
      </section>
    )
  }

  private setEventHelpers(event: Event | null) {
    if (!event) {
      this.parcel = null
      this.helper = null
      return
    }
    this.helper = new ParcelEvent(event)
    this.parcel = new ParcelHelper({
      id: event.parcel_id,
      owner: event.parcel_owner,
      name: event.parcel_name,
      description: event.parcel_description,
      address: event.parcel_address,
      geometry: event.geometry,
      x1: event.parcel_x1,
      x2: event.parcel_x2,
      y1: event.y1,
      y2: event.y2,
      z1: event.parcel_z1,
      z2: event.parcel_z2,
    })
  }
}

type SummaryProps = { event: ParcelEvent }

function SummaryPast({ event }: SummaryProps) {
  return (
    <>
      <dt>Host</dt>
      <dd>
        <a href={`/u/${event.authorSlug}`}>{event.authorNameOrAddress(34)}</a>
      </dd>
      <dt>Location</dt>
      <dd>
        <a href={`/parcels/${event.parcel_id}`}>{event.parcelNameOrAddress(34)}</a>
      </dd>
      <dt>Date & time</dt>
      <dd>{event.formattedDate(true)}</dd>
      <dt>Duration</dt>
      <dd>{event.duration()}</dd>
    </>
  )
}

function SummaryFuture({ event }: SummaryProps) {
  return (
    <>
      <dt>Starts in</dt>
      <dd>
        <CountdownTimer startDate={event.starts_at} />
      </dd>
      <dt>Host</dt>
      <dd>
        <a href={`/u/${event.authorSlug}`}>{event.authorNameOrAddress(34)}</a>
      </dd>
      <dt>Location</dt>
      <dd>
        <a href={`/parcels/${event.parcel_id}`}>{event.parcelNameOrAddress(34)}</a>
      </dd>
      <dt>Date & time</dt>
      <dd>{event.formattedDate(true)}</dd>
      <dt>Duration</dt>
      <dd>{event.duration()}</dd>
    </>
  )
}

function SummaryLive({ event }: SummaryProps) {
  const [players, setPlayers] = useState<number>(0)
  useEffect(() => {
    event.fetchPlayersPresent(setPlayers).catch(console.error)
    const id = setInterval(() => {
      event.fetchPlayersPresent(setPlayers).catch(console.error)
    }, 15000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <dt>Ends in</dt>
      <dd>
        <CountupTimer endDate={event.expires_at} />
      </dd>
      <dt>Host</dt>
      <dd>
        <a href={`/u/${event.authorSlug}`}>{event.authorNameOrAddress(34)}</a>
      </dd>
      <dt>Location</dt>
      <dd>
        <a href={`/parcels/${event.parcel_id}`}>{event.parcelNameOrAddress(34)}</a>
      </dd>
      <dt>Duration</dt>
      <dd>{event.duration()}</dd>
      <dt>Players</dt>
      <dd>{players} present</dd>
    </>
  )
}

function EventsNav({ activeId }: { activeId?: string }) {
  const [events, setEvents] = useState<Event[]>([])
  useEffect(() => {
    cachedFetch('/api/events.json', fetchOptions())
      .then((r) => r.json())
      .then((r) => setEvents(r.events ?? []))
  }, [])
  return (
    <nav>
      <ul>
        {events.map((e) => (
          <li key={e.id} aria-selected={String(e.id) === activeId}>
            <a href={`/events/${e.id}`}>{e.name}</a>
          </li>
        ))}
      </ul>

      <p>
        <a class="buttonish" href="/events/new">
          New event
        </a>
      </p>
    </nav>
  )
}

const getSSREventData = (): Event | null => {
  if (!canUseDom || !document.querySelector) return null
  const d = document.querySelector('#event-json')
  if (!d) return null
  const value = d.getAttribute('value')
  if (!value) return null
  return JSON.parse(value)
}

const useCountdown = (targetDate: Date) => {
  const countDownDate = targetDate.getTime()
  const [countDown, setCountDown] = useState(countDownDate - new Date().getTime())
  useEffect(() => {
    const interval = setInterval(() => setCountDown(countDownDate - new Date().getTime()), 1000)
    return () => clearInterval(interval)
  }, [countDownDate])
  return milliSecondsToInterval(countDown)
}

const CountdownTimer = ({ startDate }: { startDate: Date }) => {
  const { days, hours, minutes, seconds } = useCountdown(startDate)
  if (days + hours + minutes + seconds <= 0) {
    return <span>Event is live!</span>
  } else {
    return (
      <span>
        <ShowCounter days={days} hours={hours} minutes={minutes} seconds={seconds} />
      </span>
    )
  }
}

const CountupTimer = ({ endDate }: { endDate: Date }) => {
  const { days, hours, minutes, seconds } = useCountdown(endDate)
  if (days + hours + minutes + seconds <= 0) {
    return <span>Event is over!</span>
  } else {
    return (
      <span>
        <ShowCounter days={days} hours={hours} minutes={minutes} seconds={seconds} />
      </span>
    )
  }
}

const ShowCounter = (interval: Interval) => <span>{intervalAsString(interval)}</span>
