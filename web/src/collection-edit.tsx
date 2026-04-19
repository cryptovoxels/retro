import { Component } from 'preact'
import { Collection } from '../../common/helpers/collections-helpers'
import CollectionSettings from './components/collections/collection-settings'
import { app, AppEvent } from './state'

export interface Props {
  path?: string
  id?: string
  collection?: Collection
}

export interface State {
  collection?: Collection
  signedIn: boolean
}

export default class CollectionEditPage extends Component<Props, State> {
  constructor(props: Props) {
    super()
    this.state = {
      collection: props.collection,
      signedIn: false,
    }
  }

  private get isOwner() {
    if (!this.state.collection || !app.signedIn) {
      return false
    }
    return this.state.collection?.owner?.toLowerCase() == app.state.wallet?.toLowerCase()
  }

  private get isMod() {
    if (!app.signedIn) {
      return false
    }
    return app.state.moderator
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

    const c = this.state.collection
    if (!(this.isOwner || this.isMod)) {
      return (
        <section>
          <p>You do not have access to edit this collection.</p>
          <p>
            <a href={`/collections/${c.id}`}>Back</a>
          </p>
        </section>
      )
    }

    return (
      <section class="columns">
        <h1>
          <a href={`/collections/${c.id}`}>{c.name}</a>
          <span> / settings</span>
        </h1>
        <article>
          <CollectionSettings collection={c} onRefresh={this.fetch.bind(this)} />
        </article>
      </section>
    )
  }

  private async fetch(cachebust = false) {
    const id = this.props.id
    if (!id) {
      return
    }
    let url = `/api/collections/${id}`
    if (cachebust) {
      url += `?cb=${Date.now()}`
    }
    const f = await fetch(url)
    const { collection } = await f.json()
    this.setState({ collection })
  }
}
