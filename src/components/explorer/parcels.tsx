import { Component } from 'preact'
import AllParcels from '../../../web/src/components/parcels/parcel-lists/all-parcels'
import AllContributingParcels from '../../../web/src/components/parcels/parcel-lists/contributing-parcels'
import AllOwnedParcels from '../../../web/src/components/parcels/parcel-lists/my-parcels'

interface Props {
  onTeleport?: () => void
}

export class ParcelsList extends Component<Props> {
  teleportTo(coords: string) {
    window.persona.teleport(coords)
    this.props.onTeleport?.()
  }

  render() {
    return <AllParcels teleportTo={this.teleportTo.bind(this)} />
  }
}

export class AccountParcels extends ParcelsList {
  render() {
    return (
      <div>
        <AllOwnedParcels teleportTo={this.teleportTo.bind(this)} />
        <AllContributingParcels teleportTo={this.teleportTo.bind(this)} />
      </div>
    )
  }
}
