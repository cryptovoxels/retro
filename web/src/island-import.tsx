import { Component } from 'preact'
import Head from './components/head'
import { invalidateUrl } from './helpers/cached-fetch'
import { app } from './state'

export interface Props {
  path?: string
}

export interface State {
  spaceId: string | null
  status: 'idle' | 'loading' | 'done' | 'error'
  message: string
  parcelId: number | null
  island: string | null
}

function spaceFromQuery(): string | null {
  try {
    return new URLSearchParams(location.search).get('space')
  } catch {
    return null
  }
}

export default class IslandImport extends Component<Props, State> {
  started = false

  constructor(props: Props) {
    super(props)
    this.state = {
      spaceId: spaceFromQuery(),
      status: 'idle',
      message: '',
      parcelId: null,
      island: null,
    }
  }

  componentDidMount() {
    if (!app.isAdmin()) return
    if (!this.state.spaceId) {
      this.setState({ status: 'error', message: 'missing ?space=' })
      return
    }
    void this.importSpace()
  }

  async importSpace() {
    if (this.started) return
    this.started = true
    this.setState({ status: 'loading', message: 'importing...' })

    try {
      const r = await fetch('/api/admin/islands/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ space_id: this.state.spaceId }),
      })
      const d = await r.json()
      if (!r.ok || !d?.success) {
        this.setState({ status: 'error', message: d?.message || `failed (${r.status})` })
        return
      }
      if (this.state.spaceId) invalidateUrl(`/api/spaces/${this.state.spaceId}.json`)
      this.setState({
        status: 'done',
        parcelId: d.parcel_id,
        island: d.island || null,
        message: d.existing ? 'already on the map' : 'imported',
      })
    } catch (e: any) {
      this.setState({ status: 'error', message: e?.toString?.() || 'failed' })
    }
  }

  render() {
    if (!app.isAdmin()) {
      return (
        <section style={{ padding: '1rem' }}>
          <Head title="import space" url="/island/import" />
          <h1>import space</h1>
          <p>team only.</p>
        </section>
      )
    }

    const { status, message, parcelId, spaceId, island } = this.state

    return (
      <section style={{ padding: '1rem', maxWidth: '40rem' }}>
        <Head title="import space" url="/island/import" />
        <h1>import space</h1>
        <p>
          space <code>{spaceId || '?'}</code>
          {island ? (
            <>
              {' '}
              · island <code>{island}</code>
            </>
          ) : null}
        </p>
        <p>{status === 'loading' ? 'importing...' : message}</p>
        {parcelId != null && (
          <p>
            <a href={`/parcels/${parcelId}`}>go to parcel #{parcelId}</a>
          </p>
        )}
        {spaceId && (
          <p>
            <a href={`/spaces/${spaceId}`}>back to space</a>
          </p>
        )}
      </section>
    )
  }
}
