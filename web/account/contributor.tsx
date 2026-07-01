import { sortBy } from 'lodash'
import { Component } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { loadingBox } from '../src/components/loading-icon'
import PropertyItem from '../src/components/property-item'
import cachedFetch from '../src/helpers/cached-fetch'
import { fetchOptions } from '../src/utils'

const TTL = 60

export interface Props {
  wallet?: string
  isOwner?: boolean
}

export interface State {
  contributorsParcels: any
  sort: string
  ascending: boolean
  showAll: boolean
  loading: boolean
}

export class Contributor extends Component<Props, State> {
  constructor() {
    super()
    this.state = { contributorsParcels: [], showAll: false, loading: false, sort: 'id', ascending: true }
  }

  componentDidMount() {
    this.fetch()
  }

  fetch() {
    this.setState({ loading: true })

    cachedFetch(`${process.env.API}/wallet/${this.props.wallet}/contributing-parcels.json`, fetchOptions(), TTL)
      .then((r) => r.json())
      .then((r) => {
        const contributorsParcels = r.parcels || []
        this.setState({ contributorsParcels, loading: false })
      })
  }

  toggleShowAll() {
    this.setState({ showAll: !this.state.showAll })
  }

  getContributorsParcelsSorted() {
    const result = sortBy(this.state.contributorsParcels, (p: any) => {
      const h = new ParcelHelper(p)

      switch (this.state.sort) {
        case 'id':
          return parseInt(p.id, 10)
        case 'footprint':
          return Math.abs((h.x2 - h.x1) * (h.z2 - h.z1))
        case 'owner':
          return h.ownerName
        case 'suburb':
          return p.suburb
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
    const contributorsParcels = this.getContributorsParcelsSorted()
      .slice(0, this.state.showAll ? this.state.contributorsParcels.length : showTheseMany)
      .map((p: any) => <PropertyItem record={p} helper={new ParcelHelper(p)} />)

    if (contributorsParcels.length === 0) return null

    return (
      <>
        <h2>Collaborations</h2>
        <table class="parcels">
          <tbody>{contributorsParcels}</tbody>
        </table>
      </>
    )
  }
}
