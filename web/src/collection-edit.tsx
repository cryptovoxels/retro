import { Component } from 'preact'
import { Collection } from '../../common/helpers/collections-helpers'
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

  fetch = async () => {
    const f = await fetch(`/api/collections/${this.props.id}`)
    const { collection } = await f.json()
    this.setState({ collection })
  }

  componentDidMount() {
    this.fetch()
  }

  onSave = async (e: Event) => {
    e.preventDefault()

    const f = await fetch(`/api/collections/${this.props.id}`, {
      method: 'PUT',
      body: JSON.stringify(this.state.collection),
    })
  }

  set(key: keyof Collection, value: any) {
    this.setState({ collection: { ...this.state.collection, [key]: value } })
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
          <form onSubmit={this.onSave}>
            <div>
              <label>Name</label>
              <input type="text" value={c.name} onChange={(e: any) => this.set('name', e.target.value)} />
            </div>
            <div>
              <label>Description</label>
              <textarea value={c.description} onChange={(e: any) => this.set('description', e.target.value)} />
            </div>
            <div>
              <button type="submit">Save</button> or <a href={`/collections/${c.id}`}>back</a>
            </div>
          </form>
        </article>
      </section>
    )
  }
}
