import { Component, Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { SURVEYOR_URL } from '../../common/helpers/apis'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { Interval, intervalAsString, milliSecondsToInterval, nth } from '../../common/helpers/time-helpers'
import { canUseDom, copyTextToClipboard, ssrFriendlyWindow } from '../../common/helpers/utils'
import { Event } from '../../common/messages/event'
import Loading from './components/loading'
import { PanelType } from './components/panel'
import ParcelEvent, { removeEvent } from './helpers/event'
import { app, AppEvent } from './state'
import { fetchAPI, fetchOptions } from './utils'

export interface Props {
  event?: Event
  path?: string
  id?: string
}

export interface State {
  event: Event | null
  loading: boolean
  visitor_anons: string[]
  visitor_wallets: string[]
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
      visitor_anons: [],
      visitor_wallets: [],
    }
    this.setEventHelpers(event)
  }

  get visitUrl() {
    return `/parcels/${this.helper?.parcel_id}/visit`
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
    return fetchAPI(`/api/events/${this.props.id}.json`, fetchOptions(this.controller))
      .then((r) => {
        this.setEventHelpers(r.event)
        this.setState({ event: r.event }, () => {
          this.fetchStats()
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

  fetchStats() {
    if (!this.state?.event?.parcel_id) {
      console.warn('no event state, aborting surveyor stat fetching')
    }
    if (!this.state.event?.starts_at || !this.state.event?.expires_at) return false
    const start = new Date(this.state.event.starts_at).getTime()
    const end = new Date(this.state.event.expires_at).getTime()

    return fetch(`${SURVEYOR_URL}/api/events/by/parcel/${this.state.event?.parcel_id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`surveyor responded with ${r.status} - ${r.statusText}`)
        return r.json()
      })
      .then((data) => {
        if (!data.success) throw new Error('surveyor did not respond with success status')
        this.setState(calculateStats(data.events, start, end))
      })
  }

  render() {
    if (!this.state.event || !this.helper) {
      return <Loading />
    }

    const day = this.helper.toLocale({ day: 'numeric' })
    const ts = `${day}${nth(day)} of ${this.helper.toLocale({ month: 'short' })} @ ${this.helper.toLocaleTimeString({
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      timeZoneName: 'short',
    })} `
    const title = `${this.state.event.name} - ${ts}`
    const description = this.state.event.description

    const isMod = app.state?.moderator || this.helper.isOwner

    return (
      <section class="columns">
        <h1>{this.state.event.name}</h1>

        <article>
          <figcaption>
            <a href={this.visitUrl}>Visit</a>
          </figcaption>

          <figure>
            <iframe id="ParcelorbitView" key={this.parcel?.orbitUrl} scrolling="no" src={this.parcel?.orbitUrl} />
          </figure>
        </article>

        <aside class="push-header">
          <dl>
            <dt>Description</dt>
            <dd class="description">{this.state.event.description}</dd>
            {this.helper.isInPast && <SummaryPast event={this.helper} anons={this.state.visitor_anons} wallets={this.state.visitor_wallets} isMod={isMod} />}
            {this.helper.isLive && <SummaryLive event={this.helper} anons={this.state.visitor_anons} wallets={this.state.visitor_wallets} isMod={isMod} />}
            {this.helper.isInFuture && <SummaryFuture event={this.helper} anons={this.state.visitor_anons} wallets={this.state.visitor_wallets} isMod={isMod} />}

            <dt>Duration</dt>
            <dd>{this.helper.duration()}</dd>
            <dt>Visitors</dt>
            <dd>
              {this.state.visitor_wallets.length} <i /> {this.state.visitor_anons.length} <i />
            </dd>
            <dt>Calendar</dt>
            <dd>
              <a href={`/api/events/${this.state.event.id}.ics`} target="_blank" download={`voxels_event_${this.state.event.id + '.ics'}`}>
                Add to calendar
              </a>
            </dd>
            <dt>Visit</dt>
            <dd>
              <a id="PlayNowButton" role="button" href={this.parcel?.visitUrl}>
                {this.helper.isLive ? 'Join' : 'Visit'}
              </a>
            </dd>

            {!this.helper.isInPast && (
              <div>
                {this.helper.isOwner && this.parcel?.id && (
                  <button
                    onClick={() => {
                      this.redirect(`/parcels/${this.parcel?.id}?edit_event=1`)
                    }}
                  >
                    Edit event
                  </button>
                )}
                {isMod && this.state.event?.id && (
                  <button
                    onClick={() => {
                      if (!this.state.event?.id) return
                      removeEvent(this.state.event?.id, () => {
                        this.redirect('/')
                      })
                    }}
                  >
                    Remove event
                  </button>
                )}
              </div>
            )}
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
      owner_name: event.parcel_owner_name,
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

type SummaryProps = { event: ParcelEvent; anons: string[]; wallets: string[]; isMod: boolean }

function SummaryPast({ event, anons, wallets, isMod }: SummaryProps) {
  return (
    <>
      <dt>Host</dt>
      <dd>
        <a href={`/u/${event.author}`}>{event.authorNameOrAddress(34)}</a>
      </dd>
      <dt>Location</dt>
      <dd>
        <a href={`/parcels/${event.parcel_id}`}>{event.parcelNameOrAddress(34)}</a>
      </dd>
      <dt>Date & time</dt>
      <dd>{event.formattedDate(true)}</dd>
      <dt>Duration</dt>
      <dd>{event.duration()}</dd>
      <Visitors event={event} anons={anons} wallets={wallets} isMod={isMod} />
    </>
  )
}

function SummaryFuture({ event, anons, wallets, isMod }: SummaryProps) {
  return (
    <>
      <dt>Starts in</dt>
      <dd>
        <CountdownTimer startDate={event.starts_at} />
      </dd>
      <dt>Host</dt>
      <dd>
        <a href={`/u/${event.author}`}>{event.authorNameOrAddress(34)}</a>
      </dd>
      <dt>Location</dt>
      <dd>
        <a href={`/parcels/${event.parcel_id}`}>{event.parcelNameOrAddress(34)}</a>
      </dd>
      <dt>Date & time</dt>
      <dd>{event.formattedDate(true)}</dd>
      <dt>Duration</dt>
      <dd>{event.duration()}</dd>
      <Visitors event={event} anons={anons} wallets={wallets} isMod={isMod} />
    </>
  )
}

function SummaryLive({ event, anons, wallets, isMod }: SummaryProps) {
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
        <a href={`/u/${event.author}`}>{event.authorNameOrAddress(34)}</a>
      </dd>
      <dt>Location</dt>
      <dd>
        <a href={`/parcels/${event.parcel_id}`}>{event.parcelNameOrAddress(34)}</a>
      </dd>
      <dt>Duration</dt>
      <dd>{event.duration()}</dd>
      <dt>Players</dt>
      <dd>{players} present</dd>
      <Visitors event={event} anons={anons} wallets={wallets} isMod={isMod} />
    </>
  )
}

function Visitors(props: SummaryProps) {
  return (
    <Fragment>
      <dt>Visitors</dt>
      <dd title="unique wallets | anonymous visitors">
        {props.wallets.length} <i /> {props.anons.length} <i />{' '}
        {props.isMod && (
          <a style={'float:right'} onClick={() => copyToClipboard(props.wallets.join(','))} title="Click to copy wallet addresses to clipboard">
            Copy wallets
          </a>
        )}
      </dd>
    </Fragment>
  )
}

const copyToClipboard = (text: string) => {
  copyTextToClipboard(
    text,
    () => app.showSnackbar(`Copied wallets address to clipboard`, PanelType.Success),
    () => app.showSnackbar(`Could not copy wallets`, PanelType.Info),
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

type SurveyorEvent = {
  time: string
  avatar: {
    wallet: string
    uuid: string
  }
}
const calculateStats = (data: SurveyorEvent[], eventStart: number, eventEnd: number) => {
  const actionsDuringEvent = data
    .filter((e) => {
      const d = new Date(e.time).getTime()
      return d > eventStart && d < eventEnd
    })
    .map((e) => e.avatar)
  // all visitors with wallets
  const eventsWithWallets = actionsDuringEvent.filter((ev) => ev.wallet !== null)
  // unique wallets
  const walletVisitors = eventsWithWallets.reduce((res: string[], ev) => (res.includes(ev.wallet) ? res : [...res, ev.wallet]), [])
  // uuids used by wallets
  const uuidsWithWallets = eventsWithWallets.reduce((res: string[], ev) => (res.includes(ev.uuid) ? res : [...res, ev.uuid]), [])
  // unique uuids without a wallet
  const anonVisitors = actionsDuringEvent.reduce((res: string[], ev) => (res.includes(ev.uuid) || uuidsWithWallets.includes(ev.uuid) ? res : [...res, ev.uuid]), [])

  return {
    visitor_anons: anonVisitors,
    visitor_wallets: walletVisitors,
  }
}
