import { Component } from 'preact'
import UploadButton from './components/upload-button'
import { app } from './state'
import { YeetPane } from '../../src/ui/interact/yeet-pane'
import { yeetCollectionId } from '../../src/store'
import { deployCollection, mintWearable } from './helpers/mint-collection'
import { PanelType } from './components/panel'

export interface Props {
  path?: string
  id?: string
}

export interface State {
  collection?: any
  collectibles: any[]
  loading?: boolean
  deploying?: boolean
  mintingId?: string | null
  qty: Record<string, number>
  error?: string | null
}

export default class CollectionPage extends Component<Props, State> {
  constructor(props: Props) {
    super()
    this.state = {
      collectibles: [],
      qty: {},
    }
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
    this.setState({ loading: true, error: null })

    const p = await fetch(`/api/collections/${this.props.id}`)
    const { collection } = await p.json()
    this.setState({ collection })

    const f = await fetch(`/api/collections/${this.props.id}/collectibles`)
    const { collectibles } = await f.json()
    this.setState({ collectibles: collectibles || [], loading: false })
  }

  refetch = async () => {
    const f = await fetch(`/api/collections/${this.props.id}/collectibles?nonce=${Date.now()}`)
    const { collectibles } = await f.json()
    this.setState({ collectibles: collectibles || [], loading: false })
  }

  get isOwner() {
    return !!this.state.collection?.owner && this.state.collection.owner.toLowerCase() === app.wallet?.toLowerCase()
  }

  onDeploy = async () => {
    const c = this.state.collection
    if (!c?.id || !c.name) return
    this.setState({ deploying: true, error: null })
    try {
      const address = await deployCollection(c.id, c.name)
      this.setState({ collection: { ...c, address }, deploying: false })
      app.showSnackbar?.(`deployed ${address}`, PanelType.Success)
    } catch (e: any) {
      this.setState({ deploying: false, error: e?.message || 'deploy failed' })
    }
  }

  onMint = async (w: any) => {
    const c = this.state.collection
    if (!c?.address || !w?.id) return
    const qty = this.state.qty[w.id] || 1
    this.setState({ mintingId: w.id, error: null })
    try {
      const tokenId = await mintWearable(c.address, w.id, qty)
      this.setState({
        mintingId: null,
        collectibles: this.state.collectibles.map((x) => (x.id === w.id ? { ...x, token_id: tokenId, issues: qty } : x)),
      })
      app.showSnackbar?.(`minted #${tokenId}`, PanelType.Success)
    } catch (e: any) {
      this.setState({ mintingId: null, error: e?.message || 'mint failed' })
    }
  }

  render() {
    if (this.state.loading || !this.state.collection) {
      return <p>Loading...</p>
    }

    const c = this.state.collection
    const empty = (this.state.collectibles?.length || 0) === 0
    const upload = this.isOwner ? <UploadButton targetCollectionId={c.id} onUpload={this.refetch} /> : null
    const deployed = !!c.address

    return (
      <section class="columns">
        <article>
          <h1>{c.name}</h1>
          {c.description && <p>{c.description}</p>}
          {deployed ? (
            <p>
              <small>{c.address} on polygon</small>
            </p>
          ) : this.isOwner ? (
            <p>
              <button type="button" onClick={this.onDeploy} disabled={this.state.deploying}>
                {this.state.deploying ? 'Deploying...' : 'Deploy on Polygon'}
              </button>
            </p>
          ) : (
            <p>
              <small>not deployed yet</small>
            </p>
          )}
          {this.state.error && <p>{this.state.error}</p>}

          {empty ? (
            upload || <p>no wearables yet</p>
          ) : (
            <table>
              <tbody>
                {this.state.collectibles.map((w) => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td>
                      {w.token_id != null ? (
                        <a href={`/collections/${c.id}/collectibles/${w.token_id}`}>#{w.token_id}</a>
                      ) : this.isOwner && deployed ? (
                        <span>
                          <select value={this.state.qty[w.id] || 1} onChange={(e: any) => this.setState({ qty: { ...this.state.qty, [w.id]: parseInt(e.target.value, 10) } })}>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                              <option value={n} key={n}>
                                {n}
                              </option>
                            ))}
                          </select>{' '}
                          <button type="button" onClick={() => this.onMint(w)} disabled={this.state.mintingId === w.id}>
                            {this.state.mintingId === w.id ? 'Minting...' : 'Mint'}
                          </button>
                        </span>
                      ) : (
                        <small>draft</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <aside>
          <YeetPane />
          {(app.isAdmin() || this.isOwner) && <a href={`/collections/${this.props.id}/edit`}>Edit</a>}
          {empty ? null : upload}
        </aside>
      </section>
    )
  }
}
