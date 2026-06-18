import { orderBy } from 'lodash'
import { Component } from 'preact'
import { pluralize } from '../../../common/helpers/english-helper'
import { isInFuture } from '../../../common/helpers/time-helpers'
import { fetchFromMPServer } from '../../../common/helpers/utils'
import { Event as EventMessage } from '../../../common/messages/event'
import ParcelEvent from '../../../web/src/helpers/event'
import { Spinner } from '../../../web/src/spinner'
import { fetchOptions } from '../../../web/src/utils'

interface Womp {
  id: number
  author: string
  content?: string
  parcel_id: number
  image_url: string
  coords: string
  created_at: any
  updated_at: any
  image_supplied: any
}

type Event = EventMessage & {
  womp?: Womp
  players_present?: number
}

interface CommunityEventsState {
  events: Event[]
  loading: boolean
  loaded: boolean
}

export class CommunityEvents extends Component<any, CommunityEventsState> {
  constructor() {
    super()

    this.state = {
      events: [],
      loading: false,
      loaded: false,
    }
  }

  componentDidMount() {
    this.fetchEvents().catch(console.error)
  }

  async fetchEvents(cacheBust = false) {
    this.setState({ loading: true })
    const cb = cacheBust ? `?cb=${Date.now()}` : ''
    const url = `${process.env.API}/events/on.json${cb}`

    const p = await fetch(`${url}`, fetchOptions())
    const r = await p.json()

    if (r.events) {
      this.setState({ events: r.events }, () => {
        this.fetchPlayersPresent()
      })
    }
  }

  async fetchPlayersPresent() {
    const e = await Promise.all(
      this.state.events.map(async (event) => {
        const r = await fetchFromMPServer<{ count?: number }>(`/api/parcels/${event.parcel_id}.json`)
        event.players_present = r?.count ?? 0
        return event
      }),
    )
    this.setState({ events: e, loading: false, loaded: true }, () => {
      this.fetchWompsByParcel()
    })
  }

  async fetchWompsByParcel() {
    const e = await Promise.all(
      this.state.events.map(async (event) => {
        const p = await fetch(`${process.env.API}/womps/at/parcel/${event.parcel_id}.json?limit=1`)
        const r = await p.json()
        event.womp = r.success ? r.womps[0] : null
        return event
      }),
    )
    this.setState({ events: e, loading: false, loaded: true })
  }

  eventsSortedByPlayers() {
    return orderBy(
      this.state.events,
      [
        (e) => {
          return isInFuture(new Date(e.starts_at))
        },
        'players_present',
        'starts_at',
      ],
      ['asc', 'desc', 'asc'],
    )
  }

  teleportToEvent = async (event: ParcelEvent) => {
    const teleport = await event.getTeleportString()
    if (!teleport) {
      console.error('No teleport string for event', event)
      return
    }
    window.persona.teleport(teleport)
  }

  render() {
    let events = this.state.loaded
      ? this.eventsSortedByPlayers().map((event) =>
          EventRow({
            event: event,
            onClick: this.teleportToEvent,
          }),
        )
      : [LoadingEvents(true)]
    if (events.length == 0) {
      events = [EmptyList()]
    }
    return <ul className="ExplorerCommunityEvents">{events}</ul>
  }
}

interface EventProps {
  event: Event
  onClick?: (ParcelEvent: ParcelEvent) => void
}

export function EventRow(props: EventProps) {
  const helper = new ParcelEvent(props.event)

  const players_present = props.event.players_present ?? 0

  return (
    <div class={`EventRow`} title="Click to teleport to event" onClick={() => props.onClick?.(helper)}>
      <aside>
        {players_present > 0 && (
          <div title={`${players_present} ${pluralize(players_present, 'user', 'people')} in parcel`} class="userCount">
            {players_present} {pluralize(players_present, 'user', 'people')} in parcel
          </div>
        )}
        <img src={props.event.womp?.id ? props.event.womp.image_url : '/images/parcel-no-womp.png'} alt={props.event.name} />
      </aside>
      <div>
        <header>
          <div class="event" title={props.event.name}>
            {props.event.name}
          </div>
        </header>
        <div class="time" title={'Click to visit event page'}>
          {!isInFuture(helper.starts_at) ? <div class="live">Live now</div> : helper.eventTiming}
        </div>

        <div class="eventDescription">{helper.eventDescription(true)}</div>

        <div class="host">
          Hosted by{' '}
          <a onClick={stopPropagation} target="_blank" href={`/u/${props.event.author}`}>
            {helper.authorNameOrAddress(64)}
          </a>{' '}
          at{' '}
          <a onClick={stopPropagation} target="_blank" href={`/parcels/${props.event.parcel_id}`}>
            {helper.parcelNameOrAddress(64)}
          </a>
        </div>
      </div>
    </div>
  )
}

export function EmptyList() {
  return <p>Nothing scheduled</p>
}

function LoadingEvents(inOverlay?: boolean) {
  return (
    <div class={`EventRow`}>
      <header>
        <div className="header-left">
          <div class="event">
            <Spinner size={24} bg={inOverlay ? 'dark' : 'light'} />
          </div>
        </div>
        <div class="user"></div>
      </header>
      <div class="eventDescription">
        <div class="description"></div>
      </div>

      <div class="time" title={'See event page'}></div>
    </div>
  )
}

function stopPropagation(e: MouseEvent) {
  e.stopPropagation()
}
