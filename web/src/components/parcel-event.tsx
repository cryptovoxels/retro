/*
How to use:
<ParcelEventItem parcel={} />
*/

import { Component } from 'preact'
import { isInFuture } from '../../../common/helpers/time-helpers'
import { Event } from '../../../common/messages/event'
import type { SingleParcelRecord } from '../../../common/messages/parcel'
import ParcelEvent from '../helpers/event'
import { app } from '../state'
import { fetchOptions } from '../utils'

interface Props {
  parcel: Pick<SingleParcelRecord, 'id' | 'owner'> // parcel types are a mess, this is the minimum we need
  event?: Event
  noevent?: boolean
  showEventManager?: boolean
}

interface State {
  event: Event | null
  loaded?: boolean
}

export default class ParcelEventItem extends Component<Props, State> {
  private readonly abort: AbortController

  constructor(props: Props) {
    super(props)

    this.state = {
      loaded: false,
      event: props.event ? props.event : null,
    }
    this.abort = new AbortController()
  }

  componentDidMount() {
    this.fetchEvent()
  }

  componentWillUnmount(): void {
    this.abort.abort('ABORT: quitting component')
  }

  fetchEvent() {
    if (this.state.event) {
      this.setState({ loaded: true })
      return
    }
    if (!this.state.event) {
      return fetch(`${process.env.API}/parcels/${this.props.parcel.id}/event.json`, fetchOptions(this.abort))
        .then((r) => r.json())
        .then((r) => {
          if (r.event && isInFuture(new Date(r.event.expires_at))) {
            this.setState({ event: r.event })
          }
          this.setState({ loaded: true })
        })
    }
  }

  async updateEvent() {
    const url = `${process.env.API}/parcels/${this.props.parcel.id}/event.json`
    const response = await fetch(`${url}`, fetchOptions(this.abort, undefined, true))
    const data = await response.json()
    if (data.event && isInFuture(new Date(data.event.expires_at))) {
      this.setState({ event: data.event })
    } else {
      this.setState({ event: null })
    }
  }

  handleParent(event: ParcelEvent) {
    window.location.href = `/events/${event.id}`
  }

  handleChild(e: MouseEvent) {
    e.stopPropagation()
  }

  render() {
    if (!this.state.loaded) {
      return
    }

    const isParcelOwner = app.isOwner(this.props.parcel.owner)
    const eventAdmin = this.props.showEventManager && isParcelOwner && <a href={`/events/new?parcel_id=${(this.props.parcel as any).id}`}>{this.state.event ? 'Manage' : 'Create'} event</a>

    if (!this.state.event) {
      return this.props.noevent ? (
        <div>
          There is currently no event on this parcel. <br />
          <br />
          {eventAdmin}
        </div>
      ) : (
        <div></div>
      )
    }

    const event = new ParcelEvent(this.state.event)

    return (
      <div>
        <div onClick={() => this.handleParent(event)}>
          <div>
            <h4>{event.name}</h4>
          </div>
          <div>
            <p>{event.eventDescription()}</p>
          </div>
          <div>
            <small>{event.eventTiming}</small>
          </div>
        </div>
        <br />
        {eventAdmin}
      </div>
    )
  }
}
