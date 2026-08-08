import { isAddress } from 'ethers'
import { sortBy } from 'lodash'
import { Component } from 'preact'
import { route } from 'preact-router'
import { ssrFriendlyWindow } from '../../common/helpers/utils'
import Head from './components/head'
import PaginationLinks from './components/pagination-links'
import cachedFetch from './helpers/cached-fetch'
import { track } from './helpers/umami'
import { getWearableGif } from './helpers/wearable-helpers'
import { Spinner } from './spinner'
import { fetchOptions } from './utils'

const ttl = 300

interface SearchResult {
  id: string
  name: string
  description: string
  type: string
  created_at: string
}

function getUrl(type: string, id: string) {
  return `/${type}/${id.replace(/^.+:/, '')}`
}

function Wearable(props: any) {
  const wearable = props.wearable as SearchResult
  const url = getUrl('assets', wearable.id)
  const img = getWearableGif({ id: wearable.id, token_id: wearable.id, name: wearable.name })

  return (
    <div>
      <a href={url}>
        <img src={img} class="render" />
      </a>
      <p>
        <a href={url}>{wearable.name}</a>
      </p>
    </div>
  )
}

function Parcel(props: any) {
  const parcel = props.parcel as SearchResult
  const url = getUrl('parcels', parcel.id)

  return (
    <div>
      <a href={url}>
        <code>Parcel</code>
      </a>
      <p>
        <a href={url}>{parcel.name}</a>
      </p>
    </div>
  )
}

function Space(props: any) {
  const space = props.space as SearchResult
  const url = getUrl('spaces', space.id)

  return (
    <div>
      <a href={url}>
        <code>Space</code>
      </a>
      <p>
        <a href={url}>{space.name}</a>
      </p>
      <address>Space</address>
    </div>
  )
}

function Avatar(props: any) {
  const avatar = props.avatar as SearchResult
  const url = getUrl('u', avatar.id)

  return (
    <div>
      <a href={url}>
        <code>Avatar</code>
      </a>
      <p>
        <a href={url}>{avatar.name}</a>
      </p>
      <address style={{ fontSize: '0.8rem' }}>Wallet: {avatar.description || avatar.id}</address>
    </div>
  )
}

function Asset(props: any) {
  const asset = props.asset as SearchResult
  const url = getUrl('assets', asset.id)

  return (
    <div>
      <a href={url}>
        <code>Asset</code>
      </a>
      <p>
        <a href={url}>{asset.name}</a>
      </p>
      <address style={{ fontSize: '0.8rem' }}>Description: {asset.description}</address>
    </div>
  )
}

const Result = (props: any) => {
  switch (props.record.type) {
    case 'wearable':
      return <Wearable wearable={props.record} />
    case 'parcel':
      return <Parcel parcel={props.record} />
    case 'avatar':
      return <Avatar avatar={props.record} />
    case 'space':
      return <Space space={props.record} />
    case 'asset':
      return <Asset asset={props.record} />
    default:
      return (
        <tr>
          <td>{JSON.stringify(props.record)}</td>
        </tr>
      )
  }
}

export interface Props {
  path?: string
}

export interface State {
  results: any
  loading: boolean
  page: number
  query: string | null
  total?: number
}

export default class Search extends Component<Props, State> {
  controller: AbortController | null = null

  constructor(props: any) {
    super()

    const page = (props.page && parseInt(props.page, 10)) || 1

    this.state = {
      loading: true,
      query: this.query ?? '',
      results: [],
      page,
    }
  }

  get queryParams(): URLSearchParams | undefined {
    return ssrFriendlyWindow ? new URLSearchParams(document.location.search.substring(1)) : undefined
  }

  get query() {
    return this.queryParams && this.queryParams.get('q')
  }

  componentWillMount() {
    if (this.query && isAddress(this.query)) {
      route(`/u/${this.query}`, true)
    }
  }

  componentDidMount() {
    this.fetch()
  }

  componentWillUnmount() {
    if (this.controller) {
      this.controller.abort('ABORT: quitting component')
    }
  }

  async componentWillReceiveProps() {
    await this.fetch()
  }

  async fetch() {
    if (this.controller) {
      this.controller.abort('ABORT:fetching')
      this.controller = null
    }

    const q = this.query
    this.setState({ query: q ?? '', loading: true, results: [] })

    if (!q) {
      this.setState({ loading: false })
      return
    }

    track('search')
    this.controller = new AbortController()

    const r = await cachedFetch(`/api/search?q=${encodeURIComponent(q)}`, fetchOptions(this.controller), ttl)
    const { results } = await r.json()

    this.setState({ results, loading: false, total: results.length })
    this.populateCache()
  }

  populateCache() {
    // this.state.parcels.forEach((p: any) => {
    //   parcelCache.put(`/parcels/${p.id}`, p)
    // })
  }

  sort = (r: SearchResult) => {
    let order = 3

    if (r.type == 'parcel') {
      order = 1
    } else if (r.type == 'avatar') {
      order = 2
    }

    return `${order}-${r.id}`
  }

  render() {
    let results

    if (!this.state.loading && !this.state.results) {
      results = <div>No results found.</div>
    } else {
      results = sortBy(this.state.results, this.sort).map((r: any) => <Result record={r} />)
    }

    const description = `items matching ${this.query}`

    return (
      <section>
        <Head title={'Search'} />

        <br />

        <h1>Search</h1>

        {this.state.loading && <Spinner />}

        <PaginationLinks path="/search" total={this.state.total} page={this.state.page} limit={100} description={description} queryParams={this.queryParams} />

        <div class="search">{this.state.loading ? <div /> : results}</div>
      </section>
    )
  }
}
