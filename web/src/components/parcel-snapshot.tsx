import { isEqual, omit } from 'lodash'
import { Component } from 'preact'
import { format } from 'timeago.js'
import ParcelHelper from '../../../common/helpers/parcel-helper'
import type { ApiStatusResponse } from '../../../common/messages/api-parcels'
import { app } from '../state'
import { AssetType } from './Editable/editable'
import EditableName from './Editable/editable-name'
import { PanelType } from './panel'

export type ParcelSnapshotRecord = {
  id: number
  is_snapshot?: boolean
  parcel_id: number
  content: Record<string, any>
  snapshot_name?: string
  ipfs_hash?: string
  name?: string
  updated_at?: string
  created_at?: string
  content_hash?: string
}

const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

interface Props {
  parcel?: any
  version: ParcelSnapshotRecord
  refresh?: Function
}

interface State {
  snapshot_name?: string
  percentageBuilt?: number
  countFeatures?: number
  saving?: boolean
  remove?: boolean
  isAutosave?: boolean
  parcel?: any
}

export default class ParcelSnapshot extends Component<Props, State> {
  helper: ParcelHelper = undefined!

  constructor(props: Props) {
    super(props)
    this.state = {
      saving: false,
      remove: false,
      parcel: props.parcel,
      isAutosave: !props.version.is_snapshot,
    }
  }

  get parcel() {
    return this.state.parcel
  }

  get isOwner() {
    return app.isOwner(this.parcel?.owner)
  }

  setHelper() {
    // The props are a confusing to work with so we create our own parcel object to guarantee its definition.
    const p = Object.assign({}, this.parcel)
    p.content = this.props.version.content
    this.helper = new ParcelHelper({
      x1: p.x1,
      x2: p.x2,
      y1: p.y1,
      y2: p.y2,
      z1: p.z1,
      z2: p.z2,
      height: p.y2,
      distance_to_center: p.distance_to_center,
      distance_to_ocean: p.distance_to_ocean,
      distance_to_closest_common: p.distance_to_closest_common,
      content: p.content,
      geometry: p.geometry,
    })
    return p
  }

  setStateAsync(state: State): Promise<void> {
    return new Promise((resolve) => {
      this.setState(state, resolve)
    })
  }

  async componentDidMount() {
    await this.setStateAsync({ parcel: this.props.parcel })
    this.setHelper()
    this.setState({
      snapshot_name: this.props.version.snapshot_name || 'Snapshot',
      countFeatures: this.props.version.content.features?.length || 0,
      percentageBuilt: parseFloat(this.helper.percentageBuilt || '0'),
    })
  }

  revertTo() {
    if (!confirm('Are you sure you want to revert to version #' + this.props.version.id + ': ' + this.state.snapshot_name)) {
      return
    }
    this.save(this.props.version.content)
  }

  async revertToParcelVersion() {
    await this.setStateAsync({ saving: true })
    const p = await fetch(`${process.env.API}/parcels/${this.props.version.parcel_id}/revert`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ parcel_version_id: this.props.version.id }),
    })

    if (!p.ok) throw p
    const r = (await p.json()) as ApiStatusResponse
    if (r.success) {
      setTimeout(() => {
        this.setState({ saving: false })
        this.props.refresh && this.props.refresh()
      }, 1500)
    } else {
      this.setState({ saving: false })
      console.error(r)
      app.showSnackbar(r.message || 'Something went wrong, please try again', PanelType.Danger)
    }
  }

  async save(content?: Record<string, any>) {
    if (!content) {
      alert('No content')
      return
    }
    this.setState({ saving: true })

    const res = await fetch(`/grid/parcels/${this.parcel.id}`, {
      method: 'put',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw res
    const r = (await res.json()) as ApiStatusResponse
    if (!r.success) {
      alert('Error reverting.\n\nPlease jump on discord and report the error.')
    }
    // time out for the sake of UX
    setTimeout(() => {
      this.setState({ saving: false })
      this.props.refresh && this.props.refresh()
    }, 1500)
  }

  remove() {
    if (!confirm('Are you sure you want to remove Snapshot ' + this.props.version.snapshot_name)) {
      return
    }
    this.setState({ saving: true })

    return fetch(`/api/parcels/snapshot/remove`, {
      method: 'post',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version: this.props.version }),
    })
      .then((r) => r.json())
      .then((r) => {
        if (r.success) {
          this.setState({ remove: true })
          this.props.refresh && this.props.refresh()
        }
        this.setState({ saving: false })
      })
      .catch(() => {
        this.setState({ saving: false, remove: false })
      })
  }

  isCurrent() {
    // check whether version is same as current parcel
    // The version attribute causes problems on some features so we omit it.
    const parcelContent = {
      features:
        this.parcel.content.features?.map((f: any) => {
          return omit(f, 'version')
        }) || [],
      palette: this.parcel.content.palette,
      scripting: this.parcel.content.scripting,
      tileset: this.parcel.content.tileset,
      voxels: this.parcel.content.voxels,
      brightness: this.parcel.content.brightness || null,
    }

    const versionContent = Object.assign({}, this.props.version.content)
    versionContent.brightness = versionContent.brightness || null //make sure we have a brightness property
    versionContent.features =
      versionContent.features?.map((f: any) => {
        return omit(f, 'version')
      }) || []
    return isEqual(versionContent, parcelContent)
  }

  render() {
    if (!this.state.snapshot_name) {
      return <li></li>
    }
    if (this.state.remove) {
      return null
    }
    return (
      <li>
        <div>
          <header>
            <div>
              <small>#{this.props.version.id}</small>
              {this.state.isAutosave ? (
                <div>
                  <em>autosave</em>
                </div>
              ) : (
                <EditableName value={this.state.snapshot_name} isowner={this.isOwner} type={AssetType.Snapshot} data={this.props.version} title="Name of this snapshot" />
              )}
            </div>
            <div>
              {this.state.parcel && !this.isCurrent() ? (
                <button
                  onClick={() => {
                    !this.state.saving && this.revertToParcelVersion()
                  }}
                >
                  {this.state.saving ? 'Reverting..' : `Revert to ${this.state.isAutosave ? 'autosave' : 'snapshot'}`}
                </button>
              ) : (
                <span>Is current</span>
              )}
            </div>
          </header>
          <small>
            {format(this.props.version.created_at || Date.now().toString())} - {this.state.countFeatures} features - {!!this.state.percentageBuilt && `${(this.state.percentageBuilt * 100).toFixed(2)}% voxels built `}
            {!this.state.isAutosave && (
              <>
                {' '}
                - <a onClick={() => this.remove()}>Remove</a>
              </>
            )}
          </small>
        </div>
      </li>
    )
  }
}
