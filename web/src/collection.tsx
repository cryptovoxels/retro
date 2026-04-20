import { debounce, truncate } from 'lodash'
import pluralize from 'pluralize'
import { Component, Fragment } from 'preact'
import { SUPPORTED_CHAINS_BY_ID } from '../../common/helpers/chain-helpers'
import { Collection, CollectionHelper } from '../../common/helpers/collections-helpers'
import { ssrFriendlyDocument } from '../../common/helpers/utils'
import { CollectibleInfoRecord } from '../../common/messages/feature'
import { isAddress } from 'ethers'
import { bucketUrl, renderUrl } from './assets'
import Image from './components/image'
import { CollectionTabsNavigation } from './components/collections/collection-nav'
import Pagination from './components/pagination'
import UploadButton from './components/upload-button'
import { app, AppEvent } from './state'
import { getWearableGif } from './helpers/wearable-helpers'

export interface Props {
  path?: string
  id?: string
}

export interface State {
  collection?: Collection
  signedIn: boolean
  collectibles: any[]
  page: number
  loading?: boolean
  sort?: string
  asc?: boolean
  search?: string
}

const NUM_PER_PAGE = 40

export default class CollectionPage extends Component<Props, State> {
  throttledSearch = debounce(
    (value: string) => {
      this.setSearch(value)
    },
    500,
    { leading: false, trailing: true },
  )

  constructor(props: Props) {
    super()

    this.state = {
      signedIn: false,
      page: 1,
      collectibles: [],
      sort: 'updated_at',
      asc: false,
    }
  }

  private get query() {
    return this.state.search
  }

  private get creatorName() {
    return this.isQueryAUser && this.state.collectibles?.length > 0 && this.state.collectibles[0]?.author_name !== 'null' ? this.state.collectibles[0]?.author_name : this.state.collectibles[0]?.author.substr(0, 8) + `...`
  }

  private get isQueryAUser() {
    const q = this.query
    return !!isAddress(q!)
  }

  private get numberOfCollectibles() {
    return this.state.collectibles?.length || 0
  }

  private get isSuppressed() {
    return this.state.collection?.suppressed ?? false
  }

  private get publicCanSubmit(): boolean {
    return (!this.isDiscontinued && this.state.collection?.settings?.canPublicSubmit) ?? false
  }

  private get isDiscontinued() {
    return this.state.collection?.discontinued ?? false
  }

  onAppChange = () => {
    this.setState({ signedIn: app.signedIn })
  }

  componentDidMount() {
    this.fetch()
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (this.state.collection?.id !== prevState.collection?.id) {
      this.fetch()
    }
  }

  async fetch() {
    this.setState({ loading: true })

    const p = await fetch(`/api/collections/${this.props.id}`)
    const { collection } = await p.json()
    this.setState({ collection })

    const f = await fetch(`/api/collections/${this.props.id}/collectibles`)
    const { collectibles } = await f.json()
    this.setState({ collectibles, loading: false })

    console.log(this.state)
  }

  refetch = async () => {
    const f = await fetch(`/api/collections/${this.props.id}/collectibles?nonce=${Date.now()}`)
    const { collectibles } = await f.json()
    this.setState({ collectibles, loading: false })
  }

  renderCollectiblesGrid() {
    const hasCollectibles = this.numberOfCollectibles > 0

    const cells =
      hasCollectibles &&
      this.state.collectibles?.map((w: any) => {
        const url = `/collections/${SUPPORTED_CHAINS_BY_ID[w.chain_id]}/${w.collection_address}/${w.token_id}`
        const hasDescription = w.description && w.description != ''

        return (
          <div key={w.id}>
            <a href={url}>
              <Image type="wearable" src={bucketUrl(w.id!)} altsrc={renderUrl(w.id!)} />
            </a>
            {hasDescription && <p>{truncate(w.description, { length: 40 })}</p>}
          </div>
        )
      })

    const placeholder = <div></div>

    return (
      <div>
        {!this.state.info ? (
          <p>Loading...</p>
        ) : (
          <div style="display:grid">
            {this.isQueryAUser ? (
              <p>
                Displaying {this.numberOfCollectibles} collectibles {this.numberOfCollectibles > 0 && `made by ` && <a href={`/avatar/${this.query}`}>{this.creatorName}</a>}
              </p>
            ) : this.numberOfCollectibles == 0 ? (
              <p />
            ) : (
              <p>
                Displaying <b>{(this.state.page - 1) * NUM_PER_PAGE + 1}</b> to <b>{(this.state.page - 1) * NUM_PER_PAGE + this.numberOfCollectibles}</b> of <b>{this.state.info?.total}</b> minted collectibles from{' '}
                <b>{this.state.info?.authors}</b> {pluralize('author', this.state.info?.authors)}.
              </p>
            )}
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

            <br />
            <br />

            {this.state.loading && (
              <p>
                <div />
                Searching...
              </p>
            )}

            {this.state.loading || this.numberOfCollectibles > 0 ? (
              <div class="wrap-grid">
                {cells}
                {placeholder}
              </div>
            ) : (
              <div>
                <h2 />
              </div>
            )}

            {this.state.loading || this.isQueryAUser || <Pagination url={`collections/${this.props.id}`} page={this.state.page} perPage={NUM_PER_PAGE} total={this.state.info.total} callback={this.setCollectiblesPage.bind(this)} />}
          </div>
        )}
      </div>
    )
  }

  render() {
    if (this.state.loading || !this.state.collection) {
      return <p>Loading...</p>
    }

    const collectibles = this.state.collectibles?.map((w: any) => {
      const url = `/collections/${this.props.id}/collectibles/${w.token_id}`

      const hasDescription = w.description && w.description != ''
      const src = getWearableGif(w)
      //let price = w.offer_prices && w.offer_prices[0]

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
      <section class="columns">
        <h1>{this.state.collection.name}</h1>

        <article>
          <div class="wrap-grid">{collectibles}</div>
        </article>

        <aside>
          <p class="description">{this.state.collection.description}</p>

          <UploadButton targetCollectionId={this.state.collection.id} onUpload={this.refetch} />

          <dl>
            <dt>Author</dt>
            <dd>
              <a href={`/avatar/${this.state.collection.owner}`}>{this.state.collection.owner_name ? this.state.collection.owner_name : this.state.collection.owner?.substring(0, 10) + '...' || ''}</a>
            </dd>

            {this.publicCanSubmit && (
              <Fragment>
                <dt>Submissions</dt>
                <dd>This collection accepts submissions</dd>
              </Fragment>
            )}

            {this.isDiscontinued && (
              <Fragment>
                <dt>Status</dt>
                <dd>This collection has been discontinued.</dd>
              </Fragment>
            )}
          </dl>
        </aside>
      </section>
    )
  }
}
