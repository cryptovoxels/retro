import { Component } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import cachedFetch from './helpers/cached-fetch'
import { loadingBox } from './components/loading-icon'
import { naviportHere } from './helpers/coords-nav'
import { app, AppEvent } from './state'

type SandboxRow = Partial<ConstructorParameters<typeof ParcelHelper>[0]> & { id: number; name?: string; address?: string; suburb?: string }

interface State {
  sandboxes: SandboxRow[]
  loading: boolean
  error: string | null
}

/** Sidebar for /build: full sandbox list (learn checklist is in-world) */
export default class SandboxesAside extends Component<{}, State> {
  state: State = { sandboxes: [], loading: true, error: null }

  componentDidMount() {
    cachedFetch('/api/sandboxes.json')
      .then((r) => r.json())
      .then((r) => {
        this.setState({ sandboxes: r.sandboxes || [], loading: false, error: null })
      })
      .catch(() => this.setState({ loading: false, error: 'failed to load sandboxes' }))

    app.on(AppEvent.Exploring, this.onExplore)
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Exploring, this.onExplore)
  }

  onExplore = () => this.forceUpdate()

  pick = (e: Event, row: SandboxRow) => {
    e.preventDefault()
    naviportHere(new ParcelHelper(row as any).centerLocation)
  }

  render() {
    const { sandboxes, loading, error } = this.state
    const current = window.grid?.currentParcel()?.id
    const active = sandboxes.find((row) => row.id === current)
    const title = active ? active.name || active.address || `parcel ${active.id}` : 'Build'

    return (
      <div>
        <header>
          <h1>{title}</h1>
          <p>anyone can edit. follow the checklist in the world.</p>
        </header>

        <h2>sandboxes</h2>

        {loading && loadingBox()}
        {error && <p>{error}</p>}
        {!loading && !error && sandboxes.length === 0 && <p>no sandboxes right now</p>}

        <ul>
          {sandboxes.map((row) => {
            const label = row.name || row.address || `parcel ${row.id}`
            const isActive = row.id === current
            return (
              <li>
                <a href={`/parcels/${row.id}`} class={isActive ? 'active' : undefined} onClick={(e) => this.pick(e, row)}>
                  {label}
                </a>
                {(row.suburb || row.address) && <span> — {[row.suburb, row.address].filter(Boolean).join(', ')}</span>}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }
}
