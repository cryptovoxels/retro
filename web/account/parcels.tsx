import { sortBy } from 'lodash'
import { Component } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import type { Emoji } from '../../common/messages/emoji'
import { SimpleParcelRecord } from '../../common/messages/parcel'
import { loadingBox } from '../src/components/loading-icon'
import PropertyItem from '../src/components/property-item'
import cachedFetch from '../src/helpers/cached-fetch'
import { fetchOptions } from '../src/utils'

type OwnedParcel = SimpleParcelRecord & {
  emoji_list: { total: number; emoji: Emoji }
}

export interface Props {
  wallet?: string
  isOwner?: boolean
  cacheBust?: boolean
}

export interface State {
  parcels: OwnedParcel[]
  sort: string
  ascending: boolean
  showAll: boolean
  loading: boolean
}

export class Parcels extends Component<Props, State> {
  state: State = { parcels: [], showAll: false, loading: false, sort: 'id', ascending: true }

  componentDidMount() {
    this.fetch()
  }

  fetch() {
    this.setState({ loading: true })
    const opts = fetchOptions()

    return cachedFetch(`/api/wallet/${this.props.wallet}/parcels.json`, opts)
      .then((r) => r.json())
      .then((r) => {
        const parcels: OwnedParcel[] = r.parcels || []

        this.setState({ parcels, loading: false })
      })
  }

  getParcelsSorted() {
    const result = sortBy(this.state.parcels, (p) => {
      const h = new ParcelHelper(p)

      switch (this.state.sort) {
        case 'id':
          return p.id
        case 'footprint':
          return Math.abs((h.x2 - h.x1) * (h.z2 - h.z1))
        case 'owner':
          return p.owner
        case 'suburb':
          return p.suburb
        case 'height':
          return p.height
        case 'distance':
          return h.distance_to_center
        case 'island':
          return p.island
      }
    })

    if (!this.state.ascending) {
      result.reverse()
    }

    return result
  }

  toggleSort(field: any) {
    if (this.state.sort === field) {
      this.setState({
        ascending: !this.state.ascending,
      })
    } else {
      this.setState({
        sort: field,
        ascending: false,
      })
    }
  }

  render() {
    if (this.state.loading) {
      return loadingBox()
    }

    const showTheseMany = 10
    const parcels = this.getParcelsSorted()
      .slice(0, this.state.showAll ? this.state.parcels.length : showTheseMany)
      .map((p: any) => <PropertyItem key={p.id} record={p} helper={new ParcelHelper(p)} />)

    if (parcels.length === 0) return null

    return (
      <>
        <h2>Parcels</h2>
        <table class="parcels">
          <tbody>{parcels}</tbody>
        </table>
      </>
    )
  }
}
