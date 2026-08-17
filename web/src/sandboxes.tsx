import { Component } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { SANDBOX_LEARN_STEPS } from '../../src/ui/sandbox-guide'
import cachedFetch from './helpers/cached-fetch'
import { loadingBox } from './components/loading-icon'

type SandboxRow = Partial<ConstructorParameters<typeof ParcelHelper>[0]> & { id: number; name?: string; address?: string; suburb?: string }

interface State {
  sandboxes: SandboxRow[]
  loading: boolean
  error: string | null
}

/** Sidebar for /build: learn copy + full sandbox list */
export default class SandboxesAside extends Component<{}, State> {
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
      <div>
        <h2>learn to build</h2>
        <ol>
          {SANDBOX_LEARN_STEPS.map((step) => (
            <li>
              <b>{step.label}</b>
              <div>{step.hint}</div>
              {'shop' in step && step.shop && (
                <div>
                  <a href="/shop">get a parcel in the shop</a>
                </div>
              )}
            </li>
          ))}
        </ol>

        <h2>sandboxes</h2>
        <p>anyone can edit these. pick one and start building.</p>

        {loading && loadingBox()}
        {error && <p>{error}</p>}
        {!loading && !error && sandboxes.length === 0 && <p>no sandboxes right now</p>}

        <ul>
          {sandboxes.map((row) => {
            const h = new ParcelHelper(row as any)
            const href = `/play?coords=${h.centerLocation}`
            const label = row.name || row.address || `parcel ${row.id}`
            return (
              <li>
                <a href={href}>{label}</a>
                {(row.suburb || row.address) && <span> — {[row.suburb, row.address].filter(Boolean).join(', ')}</span>}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }
}
