import { truncate } from 'lodash'
import { Component, Fragment } from 'preact'
import { Collection } from '../../common/helpers/collections-helpers'
import { isAddress } from 'ethers'
import UploadButton from './components/upload-button'
import { app } from './state'
import { AvatarLink } from './components/avatar-link'
import { avatarName } from '../../common/messages/avatar-ref'
import { YeetPane } from '../../src/ui/interact/yeet-pane'
import { yeetCollectionId } from '../../src/store'

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
    if (this.props.id) yeetCollectionId.value = this.props.id
    this.fetch()
  }

  componentWillUnmount() {
    // leave yeetCollectionId so in-world yeet pane still has a collection
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (this.props.id && this.props.id !== yeetCollectionId.value) {
      yeetCollectionId.value = this.props.id
    }
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

    const empty = (this.state.collectibles?.length || 0) === 0
    const upload = <UploadButton targetCollectionId={this.state.collection.id} onUpload={this.refetch} />

    return (
      <section class="columns">
        <article>
          <h1>{this.state.collection.name}</h1>
          {empty ? upload : <p>{this.state.collectibles.length} wearables - open Yeet in the sidebar or press Y in-world</p>}
        </article>

        <aside>
          <YeetPane />
          {(app.isAdmin() || this.state.collection.owner?.toLowerCase() === app.wallet?.toLowerCase()) && <a href={`/collections/${this.props.id}/edit`}>Edit</a>}
          {empty ? null : upload}
        </aside>
      </section>
    )
  }
}
