import { Component } from 'preact'
import { fetchOptions } from '../../utils'
import ParcelEvent from '../../helpers/event'
import { route } from 'preact-router'

export interface Props {
  parcelId: any
}

export interface State {
  events?: any
  total: number
  loaded?: boolean
}

export default class HistoricEvents extends Component<Props, State> {
  constructor(props: any) {
    super(props)

    this.state = {
      events: null,
      total: 0,
      loaded: false,
    }
  }

  componentDidMount() {
    this.fetch()
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.parcelId !== this.props.parcelId) {
      this.fetch()
    }
  }

  fetch() {
    fetch(`${process.env.API}/parcels/${this.props.parcelId}/events/history.json`, fetchOptions())
      .then((r) => r.json())
      .then((r) => {
        if (r.events) {
          this.setState({ events: r.events, loaded: true })
        }
      })
  }

  relocate(id: any) {
    route('/events/' + id)
  }

  render() {
    const Events = this.state.events?.map((e: any) => {
      const event = new ParcelEvent(e)

      return (
        <div key={e.id}>
          <div>
            <h4> {event.name}</h4>
          </div>
          <div>
            <small>{e.description ? (e.description.length > 256 ? e.description.substring(0, 256) + '...' : e.description) : 'See more'}</small>
          </div>
          <div>
            <small>{event.expiredAgo}</small>
            <small>
              <a onClick={() => this.relocate(e.id)}>details</a>
            </small>
          </div>
        </div>
      )
    })

    return (
      this.state.events &&
      this.state.events.length > 0 && (
        <div>
          <h3>Historic Events</h3>
          <div>{Events}</div>
        </div>
      )
    )
  }
}
