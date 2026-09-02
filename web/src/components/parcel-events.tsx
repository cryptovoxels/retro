import { Component } from 'preact'
import { app } from '../state'
import { isInFuture } from '../../../common/helpers/time-helpers'
import ParcelEvent from '../helpers/event'
import ParcelHelper from '../../../common/helpers/parcel-helper'
import { EventTime } from './event-time'
import { AvatarLink } from './avatar-link'

export interface Props {
  parcel: any
}

export interface State {
  event?: any
}

export default class ParcelEvents extends Component<Props, State> {
  constructor(props: any) {
    super(props)

    this.state = {
      event: null,
    }
  }

  get isOwner() {
    if (!app.signedIn) {
      return false
    }
    if (!this.props.parcel) {
      return false
    }
    const helper = new ParcelHelper(this.props.parcel)
    return helper.isOwner(app.state.wallet)
  }

  get isCollaborator() {
    if (!app.signedIn) {
      return false
    }
    if (!this.props.parcel) {
      return false
    }
    const helper = new ParcelHelper(this.props.parcel)
    return helper.isContributor(app.state.wallet)
  }

  get event() {
    return this.state.event
  }

  componentDidMount() {
    this.fetchEvent()
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props.parcel != prevProps.parcel) {
      this.fetchEvent()
    }
  }

  fetchEvent() {
    return fetch(`/api/parcels/${this.props.parcel.id}/event.json?cb=${Date.now()}`)
      .then((r) => {
        // the server will respond with 400 success: false if there is no parcel event.
        if (!(r.ok || [400, 404].includes(r.status))) {
          throw new Error(`server responded with ${r.status} | ${r.statusText}`)
        }
        return r.json()
      })
      .then((r) => {
        if (r.event && isInFuture(new Date(r.event.expires_at))) {
          this.setState({ event: r.event })
        } else {
          this.setState({ event: null })
        }
      })
      .catch((err) => {
        console.error(err)
        this.setState({ event: null })
      })
  }

  render() {
    const event = this.state.event ? new ParcelEvent(this.state.event) : null
    if (!event) {
      return null
    }

    return (
      <div>
        <h3>{this.event.name}</h3>
        <div>
          <div>
            <div>
              <EventTime event={this.event} showDownloadLink={true} />
              <div>
                <div>{this.event.description}</div>
                <div>
                  Hosted by <AvatarLink avatar={this.event.author} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
