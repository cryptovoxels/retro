import { Component } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import cachedFetch from './helpers/cached-fetch'
import { loadingBox } from './components/loading-icon'
import { getCoords, naviportHere } from './helpers/coords-nav'

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

    window.addEventListener('urlchange', this.onUrl)
    window.addEventListener('popstate', this.onUrl)
  }

  componentWillUnmount() {
    window.removeEventListener('urlchange', this.onUrl)
    window.removeEventListener('popstate', this.onUrl)
  }

  onUrl = () => this.forceUpdate()

  pick = (e: Event, row: SandboxRow) => {
    e.preventDefault()
    const h = new ParcelHelper(row as any)
    if (location.pathname === '/build') {
      naviportHere(h.centerLocation)
      return
    }
    location.href = `/build?coords=${h.centerLocation}`
  }

  render() {
    const { sandboxes, loading, error } = this.state
    const current = getCoords()
    const active = sandboxes.find((row) => new ParcelHelper(row as any).centerLocation === current)
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
            const h = new ParcelHelper(row as any)
            const coords = h.centerLocation
            const label = row.name || row.address || `parcel ${row.id}`
            const isActive = current === coords
            return (
              <li>
                <a href={`/build?coords=${coords}`} class={isActive ? 'active' : undefined} onClick={(e) => this.pick(e, row)}>
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
