import { Component } from 'preact'
import { fetchOptions } from './utils'
import UploadButton from './components/upload-button'
import { SUPPORTED_CHAINS_BY_ID } from '../../common/helpers/chain-helpers'
import { Collection } from '../../common/helpers/collections-helpers'

export interface Props {}

type Sorting = 'popular' | 'newest' | 'oldest'

export interface State {
  fetching?: boolean
  page: any
  query: string
  collections: Collection[]
  sort: Sorting
  asc?: boolean
  search?: any
}

const NUM_COLLECTIONS = 100

export default class ListCollectionsComponent extends Component<Props, State> {
  constructor(props: any) {
    super(props)
    this.state = {
      fetching: true,
      query: null!,
      page: 0,
      collections: [],
      sort: 'popular',
      asc: true,
      search: null,
    }
  }

  get page() {
    return this.state.page || 0
  }

  get sort() {
    return this.state.sort
  }

  get ascending() {
    return !!this.state.asc
  }

  get query() {
    return this.state.query
  }

  setStateAsync(state: any): Promise<void> {
    return new Promise((resolve) => {
      this.setState(state, resolve)
    })
  }

  async componentDidMount() {
    await this.setStateAsync({ page: this.state.page, fetching: true })
    this.fetch()
  }

  componentDidUpdate(prevProps: any, prevState: any) {
    if (this.state.search !== prevState.search) {
      this.fetch()
    }
    if (this.state.page !== prevState.page) {
      this.fetch()
    }
  }

  constructURL() {
    let url = `/api/collections?page=${this.state.page}&limit=${NUM_COLLECTIONS}`

    if (this.query) {
      url += '&q=' + this.query
    }

    if (this.state.search) {
      url += '&q=' + this.state.search
    }

    if (this.state.sort) {
      url += '&sort=' + this.state.sort
    }

    return url
  }

  fetch() {
    this.setState({ fetching: true })
    const url = this.constructURL()

    fetch(url, fetchOptions())
      .then((r) => r.json())
      .then((response) => {
        const { collections } = response
        this.setState({ collections: collections || [], fetching: false })
      })
  }

  setSort(sort: Sorting) {
    this.setState({ sort, asc: true })
    this.fetch()
  }

  onSearch = (e: any) => {
    e.preventDefault()

    this.setState({ query: e.target.value })
    this.fetch()
  }

  render() {
    const collections = this.state.collections.map((c: Collection) => {
      return (
        <tr key={c.id}>
          <td>
            <a href={`/collections/${c.id}`}>{c.name}</a>
            <br />
            <small>{c.description}&nbsp;</small>
          </td>
          <td>{c.total_wearables}</td>
        </tr>
      )
    })

    const outline = (sort: Sorting) => (this.state.sort === sort ? 'outline' : '')

    return (
      <section class="columns">
        <hgroup>
          <h1>Collections</h1>
          <p>Asset and wearable collections made by users</p>
        </hgroup>

        <article>
          <div class="sort grid">
            <label>Sort by</label>
            <button class={outline('popular')} onClick={() => this.setSort('popular')}>
              Popular
            </button>
            <button class={outline('newest')} onClick={() => this.setSort('newest')}>
              Newest
            </button>
            <button class={outline('oldest')} onClick={() => this.setSort('oldest')}>
              Oldest
            </button>
          </div>

          {/* <form>
            <input type="text" placeholder="Search..." onInput={(e) => this.throttledSearch((e as any).target['value'])}></input>
          </form> */}
          <form role="search" onSubmit={this.onSearch}>
            <input name="search" type="search" value={this.state.query} placeholder="Search" onInput={(e: any) => this.setState({ query: e.target.value })} />
            <button type="submit">Search</button>
          </form>
          <table>
            <thead>
              <tr>
                <th scope="col" style="width:70%">
                  Name
                </th>
                <th scope="col" style="width:10%">
                  Collectibles
                </th>
              </tr>
            </thead>
            <tbody>{this.state.fetching ? 'Fetching...' : this.state.collections.length > 0 ? collections : 'No collections found.'}</tbody>
          </table>
        </article>

        <aside>
          <h3>Upload Collection</h3>

          <p>Drop .vox files here: each upload creates a collection and wearables (plus library assets).</p>

          <UploadButton collection={true} />
        </aside>
      </section>
    )
  }
}
