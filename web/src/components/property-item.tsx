import { Component } from 'preact'
import ParcelHelper from '../../../common/helpers/parcel-helper'
import { truncate } from '../lib/string-utils'

interface Props {
  record: any
  helper: ParcelHelper
  teleportTo?: (coords: string) => void
}

interface State {
  collapsed?: boolean
}

export default class PropertyItem extends Component<Props, State> {
  state = { collapsed: true }

  onClick(event: MouseEvent) {
    if (!this.props.teleportTo) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    this.teleport(this.props.helper)
  }

  render() {
    return (
      <tr>
        <td>
          <a href={'/parcels/' + this.props.record.id} onClick={this.onClick.bind(this)}>
            #{this.props.record.id}
          </a>
        </td>
        <td>
          <b>
            <a href={'/parcels/' + this.props.record.id} onClick={this.onClick.bind(this)}>
              {truncate(this.props.record.name || this.props.record.address, 80)}
            </a>
          </b>
          <br />
          <small>{this.props.helper.island}</small>
        </td>
        <td></td>
      </tr>
    )
  }

  private teleport(p: ParcelHelper) {
    p.spawnUrl().then((url) => {
      this.props.teleportTo?.(url)
    })
  }
}
