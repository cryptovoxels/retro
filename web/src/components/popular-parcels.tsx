import { Component, render } from 'preact'
import { fetchOptions } from '../utils'
import { parcelCache } from '../store/index'
import { Spinner } from '../spinner'
import cachedFetch from '../helpers/cached-fetch'

export interface Props {}

export interface State {
  metrics: Metric[]
  fetching: boolean
}

type Metric = {
  id: number
  actions: number
  parcel: {
    id: number
    name: string
    address: string
    description?: string
  }
}

export default class PopularParcels extends Component<Props, State> {
  constructor(props: any) {
    super(props)
    this.state = {
      fetching: true,
      metrics: [],
    }
  }

  componentDidMount() {
    this.fetch()
  }

  async fetch() {
    this.setState({ fetching: true })

    const r = await cachedFetch(`/api/metrics/popular`)
    const data = await r.json()

    console.log(data)

    if (!data.ok) {
      return
    }

    const { metrics } = data

    this.setState({ metrics, fetching: false })

    this.populateCache()
  }

  populateCache() {
    //   this.state.parcels.forEach((p: any) => {
    //     parcelCache.put(`/parcels/${p.id}`, p)
    //   })
  }

  render() {
    const popular = this.state.metrics.slice(0, 20).map((t) => {
      return (
        <tr>
          <td>{t.actions}</td>
          <td>
            <a href={`/parcels/${t.parcel.id}`}>{t.parcel.name || t.parcel.address}</a>
          </td>
        </tr>
      )
    })

    return <div class="popularity">{this.state.fetching ? <Spinner /> : <table>{popular}</table>}</div>
  }
}
