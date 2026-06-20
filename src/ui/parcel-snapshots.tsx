import { Component } from 'preact'
import ParcelSnapshot, { type ParcelSnapshotRecord } from '../../web/src/components/parcel-snapshot'
import type Parcel from '../parcel'

interface Props {
  parcel?: Parcel

  scene: BABYLON.Scene
}

interface State {
  takingSnapshot?: boolean
  loading?: boolean
  snapshots?: ParcelSnapshotRecord[]
  parcel?: Parcel
}

export default class ParcelSnapshots extends Component<Props, State> {
  constructor(props: Props) {
    super(props)

    this.state = { takingSnapshot: false, loading: false, snapshots: [], parcel: props.parcel }
  }

  get parcel() {
    const parcel = Object.assign({}, this.state.parcel)
    parcel.content = {
      features: this.props.parcel?.features,
      palette: this.props.parcel?.palette,
      tileset: this.props.parcel?.tileset,
      voxels: this.props.parcel?.voxels,
      brightness: this.props.parcel?.brightness || null,
    }
    return parcel
  }

  get scene() {
    return this.props.scene
  }

  get grid() {
    return window.connector!.grid
  }

  componentDidMount() {
    this.fetch()
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.parcel?.id != this.props.parcel?.id || prevProps.parcel != this.props.parcel) {
      this.setState({ parcel: this.parcel })
    }
  }

  fetch() {
    this.setState({ loading: true, snapshots: [] })
    fetch(`${process.env.API}/parcels/${this.state.parcel?.id}/snapshots.json?autosave=include`)
      .then((r) => r.json())
      .then((r) => {
        if (r.success) {
          this.setState({ snapshots: r.snapshots })
        }
        this.setState({ loading: false })
      })
  }

  refresh() {
    this.fetch()
  }

  takeSnapshot() {
    this.setState({ takingSnapshot: true })
    return fetch(`/api/parcels/snapshot`, {
      method: 'post',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parcel_id: this.state.parcel?.id }),
    })
      .then((r) => r.json())
      .then((r) => {
        if (r.success) {
          this.setState({ takingSnapshot: false }, () => {
            this.fetch()
          })
        }
      })
  }

  render() {
    const parcelSnapshots =
      this.state.snapshots?.map((s: ParcelSnapshotRecord) => {
        return <ParcelSnapshot parcel={this.parcel} version={s} refresh={this.refresh.bind(this)} />
      }) ?? []

    return (
      <section className="parcel-states">
        <header>
          <h2>Snapshots</h2>
        </header>
        <div className="scrollContainer">
          <div className="overlay-header">
            <p>Parcels are automatically saved every edit. Snapshots are user-selected states of your parcel that you can chose to come back to later.</p>

            {!this.state.takingSnapshot ? (
              <div>
                <button name="snapshot" title="Take a snapshot of this parcel's version" id="snapshot" onClick={() => this.takeSnapshot()}>
                  Take snapshot
                </button>
                <button onClick={() => this.refresh()}>Refresh</button>
                <p style={{ margin: '0' }}>
                  <small>Only owners can take Snapshots</small>
                  <br />
                  <small>Autosaves are available for one hour, use a snapshot if you want to keep your changes.</small>
                </p>
              </div>
            ) : (
              'Saving snapshot...'
            )}
          </div>
          <p>Snapshots for {this.state.parcel?.address}:</p>
          <ul className="unordered-list">{this.state.loading ? 'Loading...' : parcelSnapshots.length > 0 ? parcelSnapshots : 'No snapshots.'}</ul>
        </div>
      </section>
    )
  }
}
