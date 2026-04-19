import { Component, Fragment } from 'preact'
import { Collection, CollectionHelper } from '../../common/helpers/collections-helpers'
import CollectiblesComponent from './components/collectibles'
import { CollectionTabsNavigation } from './components/collections/collection-nav'
import CollectionSettings from './components/collections/collection-settings'
import UploadButton from './components/upload-button'
import { app, AppEvent } from './state'
import UploadWearable from './upload-wearable'

export interface Props {
  path?: string
  chain_identifier?: string
  address?: string
  id?: string
  collection?: Collection
}

export interface State {
  collection?: Collection
  listings?: Array<any>
  signedIn: boolean
}

export default class CollectionPage extends Component<Props, State> {
  constructor(props: Props) {
    super()

    // SSR
    const collection = props.collection

    this.state = {
      collection: collection,
      signedIn: false,
    }
  }

  private get isMod() {
    if (!app.signedIn) {
      return false
    }
    return app.state.moderator
  }

  private get helper() {
    return new CollectionHelper({ address: this.props.address, chain_identifier: this.props.chain_identifier })
  }

  private get isOwner() {
    if (!this.state.collection || !app.signedIn) {
      return false
    }
    return this.state.collection?.owner?.toLowerCase() == app.state.wallet?.toLowerCase()
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
    app.on(AppEvent.Change, this.onAppChange)
    this.fetch()
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Change, this.onAppChange)
  }

  render() {
    if (!this.state.collection) {
      return <p>Loading...</p>
    }

    if (this.isSuppressed) {
      return (
        <section>
          <h4>This collection has been suppressed.</h4>
        </section>
      )
    }

    const collection = this.state.collection

    const isOwner = this.isOwner

    return (
      <section class="columns">
        <h1>{this.state.collection.name}</h1>

        <article>
          {isOwner && (
            <>
              <UploadWearable collection={this.state.collection} path={`/collections/${this.helper.chainIdentifier}/${this.state.collection.address}/tab/upload`} />
              <CollectionSettings collection={this.state.collection} onRefresh={this.fetch.bind(this)} path={`/collections/${this.helper.chainIdentifier}/${this.state.collection.address}/tab/admin`} />
            </>
          )}

          <CollectiblesComponent
            default
            collection={this.state.collection}
            paginationAPIName={`collections/${this.helper.chainIdentifier}/${this.state.collection.address}`}
            listings={this.state.listings}
            path={`/collections/${this.helper.chainIdentifier}/${this.state.collection.address}`}
          />
        </article>

        <aside>
          <p class="description">{this.state.collection.description}</p>

          <UploadButton targetCollectionId={this.state.collection.id} />

          <CollectionTabsNavigation collection={this.state.collection} />

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

  private async fetch(cachebust = false) {
    const f = await fetch(`/api/collections/${this.props.id}`)
    const { collection } = await f.json()
    this.setState({ collection })
  }
}
