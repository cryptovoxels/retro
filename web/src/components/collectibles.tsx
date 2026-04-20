import { formatEther, isAddress } from 'ethers'
import { debounce, truncate } from 'lodash'
import pluralize from 'pluralize'
import { Component } from 'preact'
import { SUPPORTED_CHAINS_BY_ID } from '../../../common/helpers/chain-helpers'
import { Collection, CollectionHelper } from '../../../common/helpers/collections-helpers'
import { ssrFriendlyDocument } from '../../../common/helpers/utils'
import { CollectibleInfoRecord } from '../../../common/messages/feature'
import { bucketUrl, renderUrl } from '../assets'
import { getWearableGif, rarityLabel } from '../helpers/wearable-helpers'
import { fetchOptions } from '../utils'
import Image from './image'
import Pagination from './pagination'

export interface Props {
  path?: string
  collection?: Collection
  listings?: Array<any>
  numberPerRows?: number
  paginationAPIName?: string
}

export interface State {
  collectibles: CollectibleInfoRecord[]
  page: number
  collection?: Collection
  loading?: boolean
  onsale?: boolean
  sort?: string
  asc?: boolean
  errorAPI?: any
  search?: string
  viewCards: boolean
  numberPerRows?: number
}

const NUM_PER_PAGE = 40

/* todo move into utils */
const priceFormat = (i: number) => (isFinite(i) ? `${i.toFixed(2)}Eth` : `${i}`)
const regex = /[\d\.]+[eE][\+\-]?\d+/
const convertENotationString = (str: string): string => {
  if (regex.test(str)) {
    const [lead, decimal, pow] = str.split(/\.|e\+/)
    const zeros = '0'.repeat(Number.parseInt(pow) - (decimal ? decimal.length : 0))

    return lead + (decimal || '') + zeros
  }
  return str
}
const parseEther = (str: string): number => {
  try {
    const eth = formatEther(convertENotationString(str))
    return parseFloat(eth)
  } catch (err) {
    console.error(err)
    return NaN
  }
}
/* end todo */

export default class CollectiblesComponent extends Component<Props, State> {
  throttledSearch = debounce(
    (value) => {
      this.setSearch(value)
    },
    500,
    { leading: false, trailing: true },
  )

  constructor(props: Props) {
    super()

    this.state = {
      page: 1,
      search: '',
      collection: props.collection,
      collectibles: [],
      sort: 'updated_at',
      onsale: false,
      asc: false,
      viewCards: true,
      numberPerRows: props.numberPerRows || 4,
    }
  }

  get page() {
    return this.state.page
  }

  get sort() {
    return this.state.sort
  }

  get ascending() {
    return this.state.asc
  }

  get query() {
    return this.state.search
  }

  get documentLocation() {
    return new URLSearchParams(ssrFriendlyDocument?.location.search.substring(1))
  }

  get numberOfCollectibles() {
    return this.state.collectibles?.length || 0
  }

  componentDidUpdate(prevProps: any, prevState: any) {
    if (this.props.collection?.id !== prevProps.collection?.id) {
      this.fetch()
    }
    if (this.state.search !== prevState.search) {
      this.fetch()
      return
    }
    if (this.state.sort !== prevState.sort || this.state.asc !== prevState.asc) {
      this.fetch()
      return
    }
  }

  componentDidMount() {
    this.fetch()
  }

  setPage(page: number) {
    this.setState({ page }, () => {
      this.fetch()
    })
  }

  async fetch() {
    this.setState({ loading: true })

    if (this.props.collection) {
      const helper = new CollectionHelper(this.props.collection)
      const collectibles = await helper.fetchCollectibles(this.state.page, this.state.search, this.state.sort, this.state.asc)
      this.setState({ collectibles, loading: false })
    } else {
      let url = `/api/collectibles.json?page=${this.state.page}`

      if (this.state.search) {
        url += '&q=' + this.state.search
      }

      if (this.state.sort) {
        url += '&sort=' + this.state.sort
      }

      url += '&asc=' + this.state.asc

      fetch(url, fetchOptions())
        .then((r) => r.json())
        .then((response) => {
          const { collectibles } = response as { collectibles?: CollectibleInfoRecord[] }
          this.setState({ collectibles: collectibles || [], loading: false })
        })
    }
  }

  setStateAsync(state: any): Promise<void> {
    return new Promise((resolve) => {
      this.setState(state, resolve)
    })
  }

  toggleSortOrder() {
    this.setState({ asc: !this.state.asc })
  }

  toggleViewCatalog() {
    this.setState({ viewCards: !this.state.viewCards })
  }

  async toggleSort(sort: any) {
    if (this.state.sort === sort) {
      this.toggleSortOrder()
    } else {
      await this.setStateAsync({ sort: sort, asc: true })
    }
    this.fetch()
  }

  setSearch(value: string) {
    if (this.documentLocation.get('q')) {
      history.replaceState({}, 'Voxels - marketplace', ssrFriendlyDocument?.location?.pathname) // kill the document's query and the local query of this component takes over.
    }
    this.setState({ search: value })
  }

  render() {
    const hasCollectibles = this.numberOfCollectibles > 0

    const collectibles =
      hasCollectibles &&
      this.state.collectibles?.map((w: any) => {
        const url = `/collections/${SUPPORTED_CHAINS_BY_ID[w.chain_id]}/${w.collection_address}/${w.token_id}`
        return (
          <div key={w.id}>
            <a href={url}>
              <Image type="wearable" src={bucketUrl(w.id!)} altsrc={renderUrl(w.id!)} />
              <p>{truncate(w.name, { length: 40 })}</p>
            </a>
          </div>
        )
      })
    // Placeholder is for the sake of UX when there is only 1 wearable in the grid. (flex-box)
    const placeholder = <div></div>

    return (
      <div>
        <div>
          <div>
            <label for="searchInput">Search: </label>
            <input
              type="text"
              id="searchInput"
              onInput={(e) => {
                this.throttledSearch(e.currentTarget['value'])
              }}
            ></input>
          </div>

          <div>
            Sort by:
            <a className={this.state.sort == 'name' && ('active' as any)} onClick={() => this.toggleSort('name')}>
              Name {this.state.sort == 'name' && (this.state.asc ? '↓' : '↑')}
            </a>
            <a className={this.state.sort == 'updated_at' && ('active' as any)} onClick={() => this.toggleSort('updated_at')}>
              Date {this.state.sort == 'updated_at' && (this.state.asc ? '↓' : '↑')}
            </a>
            <a className={this.state.sort == 'issues' && ('active' as any)} onClick={() => this.toggleSort('issues')}>
              Issues {this.state.sort == 'issues' && (this.state.asc ? '↓' : '↑')}
            </a>
          </div>
        </div>

        {this.state.loading && (
          <p>
            <div />
            Searching...
          </p>
        )}

        {this.state.loading || this.numberOfCollectibles > 0 ? (
          <div class="wrap-grid">
            {collectibles}
            {placeholder}
          </div>
        ) : (
          <div>
            <h2 />
          </div>
        )}
      </div>
    )
  }
}
