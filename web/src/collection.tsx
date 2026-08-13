import { debounce, truncate } from 'lodash'
import pluralize from 'pluralize'
import { Component, Fragment } from 'preact'
import { SUPPORTED_CHAINS_BY_ID } from '../../common/helpers/chain-helpers'
import { Collection, CollectionHelper } from '../../common/helpers/collections-helpers'
import { ssrFriendlyDocument } from '../../common/helpers/utils'
import { CollectibleInfoRecord } from '../../common/messages/feature'
import { isAddress } from 'ethers'
import WearableIcon from './components/wearable-icon'
import Pagination from './components/pagination'
import UploadButton from './components/upload-button'
import { app, AppEvent } from './state'
import { AvatarLink } from './components/avatar-link'
import { avatarName } from '../../common/messages/avatar-ref'

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
    const c = this.state.collectibles?.[0]
    return c?.author ? avatarName(c.author) : ''
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

  render() {
    if (this.state.loading || !this.state.collection) {
      return <p>Loading...</p>
    }

    const collectibles = this.state.collectibles?.map((w: any) => {
      const url = `/collections/${this.props.id}/collectibles/${w.token_id}`

      const hasDescription = w.description && w.description != ''
      //let price = w.offer_prices && w.offer_prices[0]

      return (
        <div key={w.id}>
          <a href={url}>
            <WearableIcon id={w.id!} title={w.name} />
            <p>{truncate(w.name, { length: 40 })}</p>
          </a>
        </div>
      )
    })
    // Placeholder is for the sake of UX when there is only 1 wearable in the grid. (flex-box)
    const placeholder = <div></div>

    const empty = collectibles.length === 0
    const upload = <UploadButton targetCollectionId={this.state.collection.id} onUpload={this.refetch} />

    return (
      <section class="columns">
        <article>
          <h1>{this.state.collection.name}</h1>
          {empty ? upload : <div class="wrap-grid">{collectibles}</div>}
        </article>

        <aside>
          {(app.isAdmin() || this.state.collection.owner?.toLowerCase() === app.wallet?.toLowerCase()) && <a href={`/collections/${this.props.id}/edit`}>Edit</a>}
          {empty ? null : upload}

          <p class="description">{this.state.collection.description}</p>

          <dl>
            <dt>Author</dt>
            <dd>
              <AvatarLink avatar={this.state.collection.owner} />
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
