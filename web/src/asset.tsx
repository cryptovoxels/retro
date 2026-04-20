import { Component } from 'preact'
import { route } from 'preact-router'
import { ethTrunc } from '../../common/utils'
import cachedFetch, { invalidateUrl } from './helpers/cached-fetch'
import WearableHelper from './helpers/collectible'
import LoadingPage from './loading-page'
import { app } from './state'
import { assetCache } from './store'
import { fetchOptions } from './utils'
import { WearableViewer } from './wearable-viewer'

interface Props {
  path?: string
  id?: any
}

interface State {
  asset: Assetish
}

export type Assetish = {
  id: string
  name: string
  description: string
  author: string
  issues: number
  token_id: number | null
  created_at: string
  updated_at: string
  hash?: string
  rejected_at: string | null
  offer_prices: any // replace `any` with a proper type if known
  collection_id: number
  custom_attributes: any[] // replace `any` with proper attribute type if known
  suppressed: boolean
  category: string
  default_settings: any // replace `any` with a proper type if known
  content?: any
  type: AssetType
}

type AssetType = 'wearable' | 'asset'

export default class Asset extends Component<Props, State> {
  abort: AbortController | null = null
  contract: any
  private canvas: HTMLCanvasElement | null = null
  private viewer?: WearableViewer

  constructor(props: Props) {
    super()

    const asset = assetCache.get(`/assets/${props.id}`) || {}
    asset.id = props.id

    this.state = {
      asset,
    }
  }

  componentDidMount() {
    this.fetch()
  }

  componentDidUpdate(prevProps: any) {
    if (this.props !== prevProps) {
      this.fetch()
    }
  }

  fetch = async () => {
    if (this.abort) {
      this.abort.abort('ABORT:starting new request')
      this.abort = null
    }

    this.abort = new AbortController()
    const f = await cachedFetch(`/api/assets/${this.props.id}`, fetchOptions(this.abort))
    const { asset } = await f.json()

    this.setState({ asset })

    console.log(asset)

    setTimeout(() => {
      this.loadViewer()
    }, 100)
  }

  loadViewer() {
    if (!this.viewer && this.canvas) {
      this.viewer = new WearableViewer(this.canvas)
    }

    if (this.state.asset.id) {
      this.viewer?.loadURL(`/api/collectibles/${this.state.asset.id}/vox`)
    }
  }

  get type(): AssetType {
    return this.state.asset.type
  }

  get wearable() {
    return this.state.asset.type === 'wearable'
  }

  get collectible() {
    return new WearableHelper(this.state.asset as any)
  }

  get asset() {
    return this.state.asset.type === 'asset'
  }

  get author() {
    return this.state.asset?.author?.toLowerCase() == app.wallet?.toLowerCase()
  }

  get canEdit() {
    return app.isAdmin() || this.author
  }

  onDelete = async () => {
    if (!confirm('Are you sure you want to delete this asset?')) {
      return
    }

    await fetch(`/api/assets/${this.state.asset.id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const url = `/api/assets?author=${this.state.asset.author}`
    invalidateUrl(url)

    route(`/u/${this.state.asset.author}/assets`, true)
  }

  render() {
    if (!this.state.asset) {
      return <LoadingPage />
    }

    const iframe = `/assets/${this.state.asset.id}/play?mode=orbit`
    return (
      <section class="columns">
        <h1>{this.state.asset.name}</h1>

        <article>
          {this.canEdit && (
            <ul class="actions">
              <li>
                <button onClick={this.onDelete}>Delete</button>
              </li>
              <li>
                <a class="button" href={`/assets/${this.state.asset.id}/edit`}>
                  Edit
                </a>
              </li>
            </ul>
          )}

          <figure>
            {this.asset ? (
              <iframe src={iframe} />
            ) : (
              <canvas
                ref={(c) => {
                  this.canvas = c
                }}
              />
            )}
          </figure>

          {this.state.asset.description && <h3>Description</h3>}

          <p>{this.state.asset.description}</p>

          {this.asset ? (
            <>
              <h3>Code</h3>
              <pre>
                <code>{JSON.stringify(this.state.asset.content, null, 2)}</code>
              </pre>
            </>
          ) : null}
        </article>

        <aside>
          <h3>Details</h3>

          <dl>
            <dt>Author</dt>
            <dd>
              <a href={`/u/${this.state.asset.author}`}>{ethTrunc(this.state.asset.author)}</a>
            </dd>
            <dt>Created</dt>
            <dd>{this.state.asset.created_at}</dd>
            <dt>Updated</dt>
            <dd>{this.state.asset.updated_at}</dd>
            <dt>Type</dt>
            <dd>{this.state.asset.type}</dd>
            <dt>Category</dt>
            <dd>{this.state.asset.category}</dd>
            {this.state.asset.token_id && (
              <>
                <dt>Issues</dt>
                <dd>{this.state.asset.issues}</dd>
                <dt>Collection</dt>
                <dd>{this.state.asset.collection_id}</dd>
                <dt>Token ID</dt>
                <dd>{this.state.asset.token_id}</dd>
              </>
            )}
          </dl>

          {this.state.asset.custom_attributes && (
            <>
              <h3>Custom Attributes</h3>
              <pre>
                <code>{JSON.stringify(this.state.asset.custom_attributes, null, 2)}</code>
              </pre>
            </>
          )}

          {this.state.asset.default_settings && (
            <>
              <h3>Serving Suggestion</h3>

              <pre>
                <code>{JSON.stringify(this.state.asset.default_settings, null, 2)}</code>
              </pre>
            </>
          )}
        </aside>
      </section>
    )
  }
}
