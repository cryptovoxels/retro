import { Component } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import Head from './components/head'
import { loadingBox } from './components/loading-icon'
import cachedFetch from './helpers/cached-fetch'
import { naviportHere } from './helpers/coords-nav'
import SandboxesAside from './sandboxes'

type SandboxRow = Partial<ConstructorParameters<typeof ParcelHelper>[0]> & { id: number; name?: string; address?: string }

interface State {
  loading: boolean
  error: string | null
  first: SandboxRow | null
}

/** /build: sandbox list. Learn checklist lives in-world. */
export default class BuildPage extends Component<{}, State> {
  state: State = { loading: true, error: null, first: null }

  componentDidMount() {
    cachedFetch('/api/sandboxes.json')
      .then((r) => r.json())
      .then((r) => {
        const first: SandboxRow | null = (r.sandboxes || [])[0] || null
        this.setState({ loading: false, error: null, first })
      })
      .catch(() => this.setState({ loading: false, error: 'failed to load sandboxes' }))
  }

  sent = false

  componentDidUpdate() {
    const { first } = this.state
    if (!first || this.sent) return
    if (window.grid?.currentParcel()?.id === first.id) return
    this.sent = true
    naviportHere(new ParcelHelper(first as any).centerLocation)
  }

  render() {
    const { loading, error } = this.state

    return (
      <section>
        <Head title="Build" description="Learn voxels in a sandbox, then get a parcel in the shop." url="/build" />
        {loading && loadingBox()}
        {error && <p>{error}</p>}
        {!loading && !error && <SandboxesAside />}
      </section>
    )
  }
}
