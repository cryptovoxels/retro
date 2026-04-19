import { Component } from 'preact'
import { route } from 'preact-router'
import { ssrFriendlyWindow } from '../../common/helpers/utils'
import Scope from '../../common/scope'
import { LibraryAsset_Type } from '../../src/library-asset'
import Image from './components/image'
import { InplaceEdit } from './components/inplace-edit'
import PaginationLinks from './components/pagination-links'
import UploadButton from './components/upload-button'
import { invalidateUrl } from './helpers/cached-fetch'
import { Spinner } from './spinner'
import { app } from './state'
import { assetCache } from './store/index'
import { fetchAPI, fetchOptions } from './utils'

interface Props {
  assets?: LibraryAsset_Type[]
  path?: string
  page?: any
  wallet?: string
  q?: string
}

interface State {
  assets: LibraryAsset_Type[]
  sort: string
  ascending: boolean
  query?: string
  loading: boolean
  view: string
  page: number
  editing: boolean
}

export function getHash(...args: string[]): string {
  const hash = window.location.hash.substring(1)

  if (args.includes(hash)) {
    return hash
  }

  return args[0]
}

export function bucketUrl(id: string) {
  return `https://ugc.crvox.com/renders/asset-${id}.png`
}

export function renderUrl(id: string) {
  return `https://render.voxels.com/assets/${id}`
  // return `http://localhost:4321/assets/${id}`
}

export default class Library extends Component<Props, State> {
  controller: any

  constructor(props: any) {
    super()

    const page = (props.page && parseInt(props.page, 10)) || 1

    this.state = {
      assets: props.assets || [],
      sort: 'id',
      ascending: true,
      query: props.q,
      page,
      loading: true,
      editing: false,
      view: getHash('grid', 'list'),
    }
  }

  get queryParams(): URLSearchParams | undefined {
    return ssrFriendlyWindow ? new URLSearchParams(document.location.search.substring(1)) : undefined
  }

  componentDidMount() {
    this.fetch()
  }

  componentWillUnmount() {
    if (this.controller) {
      this.controller.abort('ABORT:Unmounting')
    }
  }

  componentDidUpdate(prevProps: Readonly<Props>): void {
    if (prevProps.q !== this.props.q) {
      this.setState({ query: this.props.q, page: 1, loading: true, assets: [] })
      this.fetch()
    }
  }

  get scope(): Scope {
    const scope = new Scope('/api/assets')
    scope.query = this.state.query
    scope.page = this.state.page
    scope.sort = this.state.sort
    scope.reverse = !this.state.ascending
    scope.nonce = this.state.editing

    if (this.props.wallet) {
      scope.author = this.props.wallet
    }

    return scope
  }

  async fetch() {
    if (this.controller) {
      this.controller.abort('ABORT:Refetching')
      this.controller = null
    }

    this.controller = new AbortController()

    const r = await fetchAPI(this.scope.toString(), fetchOptions(this.controller))
    if (!r) {
      this.setState({ loading: false })
      return
    }

    const assets = (r.assets || []) as LibraryAsset_Type[]
    this.controller = null

    this.setState({ assets, loading: false })
    this.populateCache()
  }

  async refetch() {
    this.setState({ editing: true })

    assetCache.clear()
    invalidateUrl(`/api/assets/*`)

    await this.fetch()
  }

  onSearch = async (e: any) => {
    e.preventDefault()

    // this.setState({ loading: true, assets: [], page: 1 })

    route(`/assets?q=${encodeURIComponent(this.state.query!)}`)
  }

  populateCache() {
    this.state.assets.forEach((a) => {
      assetCache.put(`/assets/${a.id}`, a)
    })
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
    const canEdit = (asset: LibraryAsset_Type) => {
      return app.isAdmin() || asset.author === app.state.wallet
    }

    // note double arrow function
    const onView = (view: string) => (e: Event) => {
      e.preventDefault()
      this.setState({ view })
      history.pushState(null, '', `#${view}`)
    }

    const onRename = (asset: LibraryAsset_Type) => async (name: string) => {
      const headers = {
        'Content-Type': 'application/json',
        credentials: 'include',
      }

      await fetch(`/api/assets/${asset.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
        headers,
      })

      await this.refetch()
    }

    // const assets =
    let list

    if (this.state.view === 'list') {
      list = this.state.assets.map((asset) => (
        <tr class="asset">
          <td>
            <input type="checkbox" />
          </td>
          <td>
            <Image type={asset.type} src={bucketUrl(asset.id!)} altsrc={renderUrl(asset.id!)} />
          </td>
          <td>
            <InplaceEdit value={asset.name} onChange={onRename(asset)}>
              <a href={`/assets/${asset.id}`}>{asset.name}</a>
            </InplaceEdit>
          </td>

          <td>{canEdit(asset) && <a href={`/assets/${asset.id}/edit`}>Edit</a>}</td>
        </tr>
      ))
    } else {
      list = this.state.assets.map((asset) => (
        <div class="asset" onClick={() => route(`/assets/${asset.id}`)}>
          <Image src={bucketUrl(asset.id!)} altsrc={renderUrl(asset.id!)} />

          <p>{asset.name}</p>
        </div>
      ))
    }

    return (
      <section class="columns">
        <hgroup>
          <h1>Assets</h1>
          <p>User generated assets and publicly available</p>
        </hgroup>

        <article>
          <div style={{ display: 'flex', gap: '1rem', padding: '1rem', alignItems: 'center' }}>
            View as:
            <a href="#grid" aria-current={this.state.view === 'grid' ? 'page' : undefined} onClick={onView('grid')}>
              Grid
            </a>
            <a href="#list" aria-current={this.state.view === 'list' ? 'page' : undefined} onClick={onView('list')}>
              List
            </a>
          </div>

          <form role="search" onSubmit={this.onSearch}>
            <input name="search" type="search" value={this.state.query} placeholder="Search" onInput={(e: any) => this.setState({ query: e.target.value })} />
            <button type="submit">Search</button>
          </form>

          {this.state.loading ? (
            <Spinner />
          ) : (
            <>
              {this.state.view === 'list' ? <table class="assets-list">{list}</table> : <div class="wrap-grid">{list}</div>}
              <PaginationLinks path="/assets" page={this.state.page} limit={100} queryParams={this.queryParams} description="assets" />
            </>
          )}
        </article>

        <aside>
          <h3>Upload Asset</h3>

          <p>Drop many .vox files here or pick files. Two or more files also open a new collection with wearables.</p>

          <UploadButton />
        </aside>
      </section>
    )
  }
}
