import { Component } from 'preact'
import Head from './components/head'
import { fetchOptions } from './utils'
type island = {
  id: number
  name: string
  texture: string
  other_name: string | null
  position: {
    type: 'Point'
    crs: {
      type: 'name'
      properties: {
        name: string
      }
    }
    coordinates: [number, number]
  }
}

export interface Props {
  parcels?: any
  path?: string
}

export interface State {
  islands: island[]
  view: 'new' | 'old'
}

export default class Islands extends Component<Props, State> {
  constructor() {
    super()

    this.state = { islands: [], view: 'new' }
  }

  componentDidMount() {
    this.fetch()
  }

  fetch() {
    fetch(`${process.env.API}/world/islands-metadata.json`, { ...fetchOptions(), cache: 'no-store' })
      .then((r) => r.json())
      .then((r) => {
        const islands = r.islands

        this.setState({ islands })
      })
  }

  centerLocation(center: [number, number]) {
    const z = Math.round(center[1] * 100)
    const x = Math.round(center[0] * 100)

    const e = x < 0 ? `${Math.abs(x)}W` : `${x}E`
    const n = z < 0 ? `${Math.abs(z)}S` : `${z}N`

    return [e, n].join(',')
  }

  render() {
    const islands = this.state.islands.sort((a, b) => {
      if (this.state.view === 'new') {
        return b.id - a.id
      } else {
        return a.id - b.id
      }
    })

    const n = islands.map((n: any) => {
      const slug = n.name.toLowerCase().replace(/\s+/g, '-')
      const coords = () => {
        return <a href={`/map?coords=${this.centerLocation(n.position.coordinates)}`}>{n.position.coordinates.map((c: any) => c.toFixed(2)).join(', ')}</a>
      }

      return (
        <tr>
          <td>
            <a href={`/islands/${slug}`}>{n.name}</a>
          </td>
          <td>{coords()}</td>
        </tr>
      )
    })

    return (
      <section>
        <Head title={`Islands`} />
        <h1>Islands</h1>

        <article role={'group'}>
          <label htmlFor="select">Sort </label>
          <select
            id="select"
            name="select"
            aria-label="Sort islands"
            onChange={(e) => {
              this.setState({ view: e.currentTarget.value as 'new' | 'old' })
            }}
          >
            <option selected={this.state.view === 'new'} value="new">
              Newest first
            </option>
            <option selected={this.state.view === 'old'} value="old">
              Oldest first
            </option>
          </select>
        </article>

        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Coordinates</th>
            </tr>
          </thead>

          <tbody>{n}</tbody>
        </table>
      </section>
    )
  }
}
