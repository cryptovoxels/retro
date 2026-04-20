import { Component, createRef, Ref, RefObject } from 'preact'
import { CollectibleRecord } from '../../common/messages/collectibles'
import LoadingPage from './loading-page'
import { WearableViewer } from './wearable-viewer'

export interface Props {
  path?: string
  cid?: string
  tid?: string
}

export interface State {
  collectible?: CollectibleRecord
  loading: boolean
}

export default class Wearable extends Component<Props, State> {
  private viewer?: WearableViewer
  private canvas = createRef<HTMLCanvasElement>()
  state: State = { loading: true }

  componentDidMount() {
    this.fetch()
  }

  componentWillUnmount() {
    this.viewer?.dispose()
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props.cid !== prevProps.cid) {
      this.fetch()
    } else if (this.props.tid !== prevProps.tid) {
      this.fetch()
    }
  }

  fetch = async () => {
    let url = `/api/collections/${this.props.cid}/collectibles/${this.props.tid}`

    const f = await fetch(url)
    const { collectible } = await f.json()

    this.setState({ collectible, loading: false })

    setTimeout(this.loadView, 100)
  }

  loadView = () => {
    if (!this.viewer) {
      this.viewer = new WearableViewer(this.canvas.current!)
    }

    this.viewer?.loadURL(`/api/collectibles/${this.wearable!.id}/vox`)
  }

  get wearable() {
    return this.state.collectible
  }

  get tid() {
    return parseInt(this.props.tid!, 10)
  }

  get previousUrl() {
    if (this.tid > 1) {
      return `/collections/${this.props.cid}/collectibles/${this.tid - 1}`
    } else {
      return null
    }
  }

  get nextUrl() {
    return `/collections/${this.props.cid}/collectibles/${this.tid + 1}`
  }

  render() {
    if (this.state.loading || !this.wearable) {
      return <LoadingPage />
    }

    const openseaUrl = `https://opensea.io/assets/${this.wearable.collection_address}/${this.wearable.token_id}`

    return (
      <section class="columns">
        <hgroup>
          <h1>{this.wearable.name}</h1>

          <p>
            <a href={`/collections/${this.props.cid}`}>Back to collection</a>
          </p>
        </hgroup>

        <article>
          <figcaption>
            <a disabled={!this.previousUrl} class="buttonish" href={this.previousUrl}>
              Previous
            </a>
            <a class="buttonish" href={this.nextUrl}>
              Next
            </a>
          </figcaption>
          <figure>
            <canvas ref={this.canvas} class="wearable-canvas" />
          </figure>
        </article>
        <aside>
          <h2>Details</h2>
          <dl>
            <dt>Author</dt>
            <dd>
              <a href={`/marketplace/collectibles?q=${this.wearable.author}`}>{this.wearable.author}</a>
            </dd>
            <dt>OpenSea</dt>
            <dd>
              <a href={openseaUrl}>Visit</a>
            </dd>
            <dt>Collection</dt>
            <dd>
              <a href={`/collections/${this.props.cid}`}>{this.wearable.collection_name}</a>
            </dd>
          </dl>
        </aside>
      </section>
    )
  }
}
