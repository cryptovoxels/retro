import { Component } from 'preact'
import Head from './components/head'
import cachedFetch from './helpers/cached-fetch'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { loadingBox } from './components/loading-icon'

type SandboxRow = Partial<ConstructorParameters<typeof ParcelHelper>[0]> & { id: number; name?: string; address?: string; suburb?: string }

interface State {
  sandboxes: SandboxRow[]
  loading: boolean
  error: string | null
}

export default class BuildPage extends Component<{}, State> {
  state: State = { sandboxes: [], loading: true, error: null }

  componentDidMount() {
    cachedFetch('/api/sandboxes.json')
      .then((r) => r.json())
      .then((r) => {
        this.setState({ sandboxes: r.sandboxes || [], loading: false, error: null })
      })
      .catch(() => this.setState({ loading: false, error: 'failed to load sandboxes' }))
  }

  render() {
    const { sandboxes, loading, error } = this.state

    return (
      <section style={{ padding: '1rem', maxWidth: '40rem' }}>
        <Head title="Build" description="Learn voxels in a sandbox, then get a parcel in the shop." url="/build" />
        <h1>Build</h1>
        <p>learn voxels in a sandbox. when you are done practicing, grab a parcel in the shop.</p>

        {loading && loadingBox()}
        {error && <p>{error}</p>}

        {!loading && !error && sandboxes.length === 0 && <p>no sandboxes right now</p>}

        <ul>
          {sandboxes.map((row) => {
            const h = new ParcelHelper(row as any)
            const href = `/play?coords=${h.centerLocation}&learn=true`
            const label = row.name || row.address || `parcel ${row.id}`
            return (
              <li>
                <a href={href}>{label}</a>
                {(row.suburb || row.address) && <span> — {[row.suburb, row.address].filter(Boolean).join(', ')}</span>}
              </li>
            )
          })}
        </ul>

        <p>
          <a href="/shop">get a parcel in the shop</a>
        </p>
      </section>
    )
  }
}
