import * as _ from 'lodash'
import { Component } from 'preact'
import { isInWorld } from '../../../common/helpers/detector'
import { isInFuture } from '../../../common/helpers/time-helpers'
import { Event } from '../../../common/messages/event'
import ParcelEvent from '../helpers/event'
import { Spinner } from '../spinner'
import cachedFetch from '../helpers/cached-fetch'
import { fetchOptions } from '../utils'
import { EventTime } from './event-time'

interface Props {
  numEvents?: number
  onTeleport?: () => void
  inOverlay?: boolean
  summary?: boolean
}

interface State {
  events: Event[]
  page: number
  loaded?: boolean
}

export default class EventCalendar extends Component<Props, State> {
  state: State = {
    events: [],
    page: 0,
    loaded: false,
  }
  private controller: AbortController | undefined = undefined

  private get prevPage() {
    return this.state.page > 0
  }

  private get nextPage() {
    return true
  }

  componentDidMount() {
    if (this.controller) {
      this.controller.abort('ABORT: quitting component')
    }
    this.controller = new AbortController()
    return this.fetchEvents()
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (this.state.page !== prevState.page) {
      this.fetchEvents()
    }
  }

  componentWillUnmount() {
    if (this.controller) {
      this.controller.abort('ABORT: quitting component')
    }
  }

  render() {
    if (!this.state.loaded) {
      return (
        <div>
          <Spinner size={24} bg={this.props.inOverlay ? 'dark' : 'light'} />
        </div>
      )
    }

    const pagedEvents =
      this.state.events.length &&
      this.eventsSorted().map((e) => {
        const event = new ParcelEvent(e)
        return (
          <div key={event.name} class={`event-item`}>
            <div>
              <a onClick={() => this.handleParent(event)}>{event.name}</a>
            </div>
            <div>
              <EventTime event={e} onClick={() => this.handleParent(event)} />
              <div>
                {event.eventDescription(this.props.summary)}
                <div>
                  <div>
                    {event.isLive ? 'Started' : 'Starts'} {event.startsIn} {event.isLive && `and ends ${event.expiredAgo}`}
                  </div>
                  <div>
                    Hosted by <a href={`/u/${event.author}`}>{event.authorNameOrAddress(34)}</a> at <a href={`/parcels/${event.parcel_id}`}>{event.parcelNameOrAddress(34)}</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })

    return this.state.events.length ? (
      <div>
        <div>{pagedEvents}</div>
        {(this.prevPage || this.nextPage) && (
          <div>
            {this.prevPage && <a onClick={() => this.setState({ page: this.state.page - 1 })}>&laquo; Prev</a>}
            &nbsp;
            {this.nextPage && <a onClick={() => this.setState({ page: this.state.page + 1 })}>&raquo; Next</a>}
          </div>
        )}
      </div>
    ) : (
      <div>
        <div>No events running or planned right now</div>
      </div>
    )
  }

  private fetchEvents = () =>
    cachedFetch(`/api/events/on/${this.props.numEvents}/${this.state.page}.json`, fetchOptions(this.controller))
      .then((r) => r.json())
      .then((data) => {
        this.setState({ events: data.events || [], loaded: true })
      })

  private eventsSorted() {
    return _.orderBy(
      this.state.events,
      [
        (e) => {
          const ev = new ParcelEvent(e)
          return isInFuture(ev.starts_at)
        },
        'starts_at',
      ],
      ['asc', 'asc'],
    )
  }

  private teleport(event: ParcelEvent) {
    event.getTeleportString().then((teleportString) => {
      const persona = window.connector?.persona
      teleportString && persona?.teleport(teleportString)
      this.props.onTeleport?.()
    })
  }

  private handleParent(event: ParcelEvent) {
    if (isInWorld()) {
      this.teleport(event)
    } else {
      window.location.href = `/events/${event.id}`
    }
  }
}
