import { Component } from 'preact'

import { Link } from 'preact-router/match'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { ssrFriendlyWindow } from '../../common/helpers/utils'
import { SimpleParcelRecord } from '../../common/messages/parcel'
import Head from './components/head'
import PaginationLinks from './components/pagination-links'
import cachedFetch from './helpers/cached-fetch'
import parse from './helpers/parse'
import { Spinner } from './spinner'
import { app } from './state'
import { isSplit } from './helpers/coords-nav'
import { parcelCache } from './store/index'
import { fetchOptions } from './utils'

const limit = 50 // limit on server is 50 so can't go any higher than that..

type TableRowProps = {
  record: SimpleParcelRecord
  helper: ParcelHelper
}

const TableRow = (props: TableRowProps) => {
  return (
    <tr>
      <td>{props.record.id}</td>
      <td>
        {props.record.name ? (
          <p>
            <b>
              <Link activeClassName="active" href={'/parcels/' + props.record.id}>
                {props.record.name}
              </Link>
            </b>
            <br />
            <small>{props.helper.address}</small>
          </p>
        ) : (
          <p>
            <b>
              <Link activeClassName="active" href={'/parcels/' + props.record.id}>
                {props.record.address}
              </Link>
            </b>
            <br />
            <small>{props.record.island}</small>
          </p>
        )}
      </td>
      <td>
        {props.helper.width} &times; {props.helper.depth}
        <small> cm</small>
      </td>
      <td>
        {props.record.height}
        <small>m</small>
      </td>
    </tr>
  )
}

const propertiesSort = ['id', 'height', 'island', 'suburb', 'distance'] as const
type PropertiesSort = (typeof propertiesSort)[number]

export interface Props {
  parcels?: any
  path?: string
  page?: any
}

export interface State {
  parcels: any
  sort: PropertiesSort
  ascending: boolean
  query?: string
  loading: boolean
  view?: string
  page: number
  total?: number
}

export default class Parcels extends Component<Props, State> {
  controller: any

  constructor(props: any) {
    super()

    const page = (props.page && parseInt(props.page, 10)) || 1

    this.state = {
      loading: !props.parcels,
      parcels: props.parcels || [],
      sort: 'id',
      ascending: true,
      query: this.getQuery() ?? undefined,
      page,
    }
  }

  get queryParams(): URLSearchParams | undefined {
    return ssrFriendlyWindow ? new URLSearchParams(document.location.search.substring(1)) : undefined
  }

  get owner(): undefined | string {
    return this.queryParams && parse.ethaddress(this.queryParams.get('owner'))
  }

  componentDidMount() {
    this.fetch()
  }

  componentWillUnmount() {
    if (this.controller) {
      this.controller.abort('ABORT: quitting component')
    }
  }

  componentWillReceiveProps(nextProps: Props) {
    const page = (nextProps.page && parseInt(nextProps.page, 10)) || 1
    this.setState({ page }, this.fetch.bind(this))
  }

  getQuery() {
    if (this.owner) {
      return this.owner
    }
    return this.queryParams?.get('q') ?? undefined
  }

  async fetch() {
    if (this.controller) {
      this.controller.abort('ABORT:fetching')
      this.controller = null
    }

    const query = this.getQuery()

    this.setState({ query: query, loading: true, parcels: [] })

    const searchParams = new URLSearchParams({
      sort: this.state.sort,
      asc: this.state.ascending ? 'true' : 'false',
      page: (this.state.page - 1).toString(),
      limit: limit.toString(),
      q: query ?? '',
    })
    this.controller = new AbortController()
    const r = await cachedFetch(`/api/parcels/search.json?${searchParams}`, fetchOptions(this.controller))
    const r_1 = await r.json()
    const parcels = r_1.parcels || []
    const total = parcels.length > 0 ? parcels[0].pagination_count : 0
    this.controller = null
    this.setState({ parcels, total, loading: false })
    this.populateCache()
  }

  populateCache() {
    this.state.parcels.forEach((p: SimpleParcelRecord) => parcelCache.put(`/parcels/${p.id}`, p))
  }

  toggleSort(field: PropertiesSort) {
    if (this.state.sort === field) {
      this.setState({ ascending: !this.state.ascending })
    } else {
      this.setState({ sort: field, ascending: false })
    }
  }

  componentDidUpdate(previousProps: Readonly<Props>, previousState: Readonly<State>, snapshot: any): void {
    if (previousState.sort !== this.state.sort || previousState.ascending !== this.state.ascending) {
      this.fetch()
    }
  }

  render() {
    let view

    if (!this.state.loading && !this.state.parcels) {
      view = <div>No parcels found</div>
    } else {
      const parcels = this.state.parcels.map((p: any) => <TableRow record={p} helper={new ParcelHelper(p)} />)

      view = (
        <table class="parcels-table">
          <tr>
            <th>#</th>
            <th onClick={() => this.toggleSort('id')}>Address</th>
            <th title="Ground footprint (width x depth in cm)">Footprint</th>
            <th onClick={() => this.toggleSort('height')} title="Building height limit">
              Height
            </th>
          </tr>
          {parcels}
        </table>
      )
    }

    const description = this.owner ? `owned by ${this.owner}` : null

    if (isSplit()) {
      return (
        <section class="sidebar-view">
          {this.state.loading ? <Spinner size={18} /> : view}
        </section>
      )
    }

    return (
      <section>
        <Head title={'All parcels'} description={'See all currently minted parcels'} url={'/parcels'} />

        <br />
        <div style={{ display: 'flex', flex: 1, width: '100%' }}>
          <div style={{ flexGrow: 1 }} />
          <div>
            {app.state.wallet && (
              <button class="outline" onClick={() => (window.location.href = '/parcels/new')}>
                View New listings
              </button>
            )}
          </div>
        </div>

        <div role={'group'} style={'gap:1.5rem;'}>
          <label htmlFor="select">Sort by </label>
          <select
            name="asc"
            aria-label="Order"
            onChange={(e) => {
              this.setState({ ascending: e.currentTarget.value === 'Asc' ? true : false })
            }}
          >
            <option selected={this.state.ascending} value="Asc">
              Asc
            </option>
            <option selected={!this.state.ascending} value="Desc">
              Desc
            </option>
          </select>
          <label htmlFor="select">Order by </label>
          <select
            name="Order by"
            aria-label="Order"
            onChange={(e) => {
              this.setState({ sort: e.currentTarget.value as PropertiesSort })
            }}
          >
            {propertiesSort.map((prop) => (
              <option selected={this.state.sort == prop} value={prop}>
                {prop.charAt(0).toUpperCase() + prop.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <PaginationLinks path="/parcels" total={this.state.total} page={this.state.page} limit={limit} description={description} queryParams={this.queryParams} />

        <article>{this.state.loading ? <Spinner size={18} /> : view}</article>
      </section>
    )
  }
}
