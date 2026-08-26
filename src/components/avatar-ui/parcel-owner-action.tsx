import { Component } from 'preact'
import ParcelHelper from '../../../common/helpers/parcel-helper'
import { app } from '../../../web/src/state'
import type Avatar from '../../avatar'
import type Grid from '../../grid'
import { SceneContext } from '@babylonjs/lite'

interface Props {
  avatar: Avatar
  scene: SceneContext
}

export default class ParcelOwnerActions extends Component<Props> {
  get avatar() {
    return this.props.avatar as Avatar
  }

  get grid() {
    return window.grid as Grid
  }

  get currentParcel() {
    if (!this.grid) return null
    return this.grid.currentOrNearestParcel()
  }

  get isOwnerOfCurrentParcel() {
    if (!app.signedIn) return false
    const parcel = this.currentParcel
    if (!parcel) return false
    return new ParcelHelper(parcel).isOwner(app.state.wallet)
  }

  render() {
    if (!this.isOwnerOfCurrentParcel) return null
    const parcel = this.currentParcel!
    return (
      <div className="OverlayHighlightContent -canEdit">
        <h4>
          Parcel Owner Actions{' '}
          <small>
            (#{parcel.id} - {parcel.name || parcel.address})
          </small>
        </h4>
        <a href={`/parcels/${parcel.id}/edit`} target="_blank" rel="noreferrer">
          Edit parcel on web
        </a>
      </div>
    )
  }
}
