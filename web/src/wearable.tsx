import { Component } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { SUPPORTED_CHAINS_BY_ID } from '../../common/helpers/chain-helpers'
import { canUseDom } from '../../common/helpers/utils'
import { CollectibleRecord } from '../../common/messages/collectibles'
import CollectibleNotFound from './components/collectibles/collectible-not-found'
import CustomCollectibleAttributes from './components/collectibles/custom-collectible-traits'
import { toggleEditCollectibleWindow } from './components/collectibles/edit-collectible'
import Head from './components/head'
import { PanelType } from './components/panel'
import { CollectibleAuthorOnly, CollectionOwnerOrModOnly, CollectionOwnerOrModOrCollectibleAuthorOnly } from './components/parcels/permissions'
import ReportButton from './components/report-button'
import WearableHelper from './helpers/collectible'
import { AssetType, saveAsset } from './helpers/save-helper'
import { getWearableGif, rarityLabel } from './helpers/wearable-helpers'
import LoadingPage from './loading-page'
import { toggleCollectibleTransfer } from './popup-ui/transfer-collectible'
import { Spinner } from './spinner'
import { app, AppEvent } from './state'
import { WearableCategory } from './upload-wearable'
import { fetchAPI } from './utils'
import { WearableViewer } from './wearable-viewer'

export interface Props {
  path?: string
  collectible?: CollectibleRecord
  token_id?: number
  chain_identifier?: string
  address?: string
}

export interface State {
  collectible: CollectibleRecord
  balance: number
  isCollectionOwner: boolean
  ownersOwnsAll: boolean
  ownersCachebuster?: number
}

export default class Wearable extends Component<Props, State> {
  private canvas: HTMLCanvasElement | null = null
  private viewer?: WearableViewer

  constructor(props: Props) {
    super()

    const d = canUseDom && document.querySelector && document.querySelector('#collectible-json')
    let collectible = null

    const id = props.chain_identifier + ':' + props.address + ':' + props.token_id

    if (d && d.getAttribute('data-collectible-id') == id) {
      const val = d.getAttribute('value')
      collectible = val ? JSON.parse(val) : null
    } else if (props.collectible) {
      collectible = props.collectible
    }

    this.state = {
      collectible: collectible,
      balance: 0,
      isCollectionOwner: false,
      ownersOwnsAll: false,
    }
  }

  get wearable(): WearableHelper {
    return new WearableHelper(this.state.collectible)
  }

  get isMod() {
    if (!app.signedIn) {
      return false
    }
    return !!app.state.moderator
  }

  get helper() {
    return new WearableHelper(this.state.collectible)
  }

  get isOffChain() {
    return this.state.collectible.chain_id == 0
  }

  /* Get the balance from the blockchain */
  getBalance(cacheBust = false) {
    if (!app.signedIn) {
      this.setState({ balance: 0 })
      return
    }
    let url = `/api/collectibles/w/${SUPPORTED_CHAINS_BY_ID[this.wearable.chain_id ?? 1]}/${this.wearable.collection_address}/${this.wearable.token_id}/balanceof/${app.state.wallet}`
    if (cacheBust) url += `?cb=${Date.now()}`
    fetchAPI(url)
      .then((r) => {
        this.setState({ balance: r.balance })
      })
      .catch((err) => {
        console.error(err)
        this.setState({ balance: 0 })
      })
  }

  onAppSignInSignOut = () => {
    // causes a re-render
    this.forceUpdate()
    this.getBalance()
  }

  componentDidMount() {
    this.fetch()
    app.on(AppEvent.AvatarLoad, this.onAppSignInSignOut) // use avatarLoad as it includes the mod info
    app.on(AppEvent.Logout, this.onAppSignInSignOut)
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Logout, this.onAppSignInSignOut)
    app.removeListener(AppEvent.AvatarLoad, this.onAppSignInSignOut)
    this.viewer?.dispose()
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props !== prevProps) {
      this.fetch()
    }
  }

  fetch = async (shouldCachebust?: boolean) => {
    if (!this.props.chain_identifier || !this.props.address || !this.props.token_id) {
      return
    }
    let url = `/api/collections/${this.props.chain_identifier}/collectibles/${this.props.token_id}`
    if (shouldCachebust) url += `?cb=${Date.now()}`

    fetchAPI(url)
      .then((collectionsResponseData) => {
        const { collectible } = collectionsResponseData
        this.setState({ collectible: collectible }, () => {
          if (this.wearable.hash) {
            if (!this.viewer && this.canvas) {
              this.viewer = new WearableViewer(this.canvas)
            }
            this.viewer?.loadHash(this.wearable.hash)
          }
          this.getBalance(true)
        })
      })
      .catch((err) => {
        console.error(err)
        throw new Error('Voxels collection API failed; please try again later.')
      })
  }

  burnCollectible = () => {
    if (this.wearable && this.state.balance <= 0) {
      app.showSnackbar(`You can only burn collectibles you own!`)
      return
    }
    toggleCollectibleTransfer(this.wearable, '0x0000000000000000000000000000000000000001', this.getBalance.bind(this, true))
  }

  toggleSuppress = () => {
    this.wearable.toggleSuppress(this.fetch)
  }

  onOwnersListResult = (owners: string[]) => {
    if (owners.length > 1) {
      // if we have more than one owner, do not allow editing of the wearable's info
      this.setState({ ownersOwnsAll: false })
      return
    }
    const p = owners.find((o) => {
      return !!this.wearable.isAuthor(o)
    })
    // if the only owner is the author, allow editing.
    this.setState({ ownersOwnsAll: !!p })
  }

  onAfterTransfer = () => {
    this.getBalance(true)
    this.setState({ ownersCachebuster: Date.now() })
  }

  render() {
    if (!this.state.collectible) {
      return <LoadingPage />
    }
    if (!this.isMod && this.wearable.isSuppressed()) {
      return <CollectibleNotFound />
    }

    const id = this.props.chain_identifier + ':' + this.props.address + ':' + this.props.token_id
    const previous = `${this.helper.collectionPage()}/${this.wearable.token_id - 1}`
    const subsequent = `${this.helper.collectionPage()}/${this.wearable.token_id + 1}`

    return (
      <section>
        <Head
          title={this.wearable.name || `Wearable #${this.wearable.token_id}`}
          description={this.wearable.description || `${this.wearable.name} by ${this.wearable.author}`}
          url={`${this.helper.collectionPage()}/${this.wearable.token_id}`}
          imageURL={getWearableGif(this.wearable)}
        >
          <script id="collectible-json" data-collectible-id={id} type="application/json">
            {JSON.stringify(this.props.collectible)}
          </script>
        </Head>
        <hgroup>
          <h1>{this.wearable.name}</h1>
          <p>
            By <a href={`/marketplace/collectibles?q=${this.wearable.author}`}>{this.wearable.ownerName()}</a>
          </p>
          <p>
            <a href={this.wearable.openseaUrl}>View on OpenSea</a>
          </p>
        </hgroup>

        <div style="display: flex; gap: 10px;  flex:1;">
          <canvas
            ref={(c) => {
              this.canvas = c
            }}
            style={{ flexGrow: 1 }}
          />

          <article>
            <div>
              <div style="display: flex; justify-content: flex-end;">
                <div class={`rarity-label ${rarityLabel(this.wearable.issues)}`}>{rarityLabel(this.wearable.issues)}</div>
              </div>
              <div>{!!this.wearable?.offer_prices && this.wearable.offer_prices?.length > 0 && <span>{this.wearable.offer_prices[0] + ` Eth`}</span>}</div>
            </div>

            <h3>Details</h3>
            <dl>
              <dt>Collection</dt>
              <dd>
                <a href={this.helper.collectionPage()}>{this.wearable.collection_name}</a>
              </dd>
              <dt>Author</dt>
              <dd>
                <a href={`https://www.voxels.com/avatar/${this.wearable.author}`}>{this.wearable.ownerName()}</a>
              </dd>
              <dt>Token id</dt>
              <dd>{this.props.token_id}</dd>
              <dt>Issues</dt>
              <dd>{this.wearable.issues}</dd>
              <dt>Description</dt>
              <dd>{this.wearable.description}</dd>
            </dl>
          </article>
        </div>

        <WearableActionBar {...this.state} isOffChain={this.isOffChain} refresh={this.fetch} burnCollectible={this.burnCollectible} toggleSuppress={this.toggleSuppress} isSuppressed={this.wearable.isSuppressed()} />

        {this.wearable &&
          !this.isOffChain &&
          (app.signedIn && this.state.balance > 0 ? (
            <div>
              <h4>You own {this.state.balance} of this collectible. </h4>
              <div>
                <a onClick={() => toggleCollectibleTransfer(this.wearable, undefined, this.onAfterTransfer.bind(this))}>Transfer</a>
              </div>
            </div>
          ) : !app.signedIn ? (
            ''
          ) : (
            ''
          ))}

        {this.wearable && this.wearable.collectionHasAttributes() && (this.wearable.isAuthor(app.state.wallet) || !!app.state.moderator) && (
          <div>
            <h3>Collection's attributes </h3>
            <CustomCollectibleAttributes collectible_id={this.wearable.id} collectionAttributesNames={this.wearable.collection_attributes_names!} customAttributes={this.wearable.custom_attributes} onSave={this.fetch.bind(this)} />
          </div>
        )}
        {!this.wearable.category && (this.wearable.isAuthor(app.state.wallet) || !!app.state.moderator) && (
          <div>
            <h3>Collectible's Category</h3>
            <p>This wearable does not have a category. Set one up!</p>
            <EditWearableCategory wearable={this.wearable} onSave={this.fetch.bind(this)} />
          </div>
        )}

        {!this.isOffChain && (
          <div>
            <OwnersOfCollectible collectible={this.wearable} onResult={this.onOwnersListResult} cachebuster={this.state.ownersCachebuster} />
          </div>
        )}
      </section>
    )
  }
}

interface WearableActionBarProps {
  ownersOwnsAll: boolean
  balance: number
  isOffChain: boolean
  isCollectionOwner: boolean
  collectible?: CollectibleRecord
  burnCollectible: () => void
  toggleSuppress: () => void
  isSuppressed: boolean
  refresh: () => void
}

function WearableActionBar(props: WearableActionBarProps) {
  const { collectible, balance, isOffChain, ownersOwnsAll, burnCollectible, toggleSuppress, refresh, isSuppressed } = props

  if (!collectible) {
    return null
  }

  return (
    <CollectionOwnerOrModOrCollectibleAuthorOnly collectible={collectible} balance={balance}>
      <div>
        <h3>Actions</h3>
        <p>These are visible only for you</p>
        <ul>
          {ownersOwnsAll && (
            <CollectibleAuthorOnly collectible={collectible}>
              <li>
                <a onClick={() => toggleEditCollectibleWindow(collectible, refresh)} style="display: block;">
                  Edit
                </a>
                <small> Edit the collectible's name or description.</small>
              </li>
            </CollectibleAuthorOnly>
          )}
          {!isOffChain && (
            <li>
              <a href={`/c/v2/${SUPPORTED_CHAINS_BY_ID[collectible.chain_id ?? 1]}/${collectible.collection_address}/${collectible.token_id}`} target="_blank" style="display: block;">
                Metadata
              </a>
              <small> Find what the metadata for this collection looks like.</small>
            </li>
          )}

          {!isOffChain && balance > 0 && (
            <li>
              <a onClick={() => burnCollectible()}> Burn</a>
              <small>Send collectible to burn address</small>
            </li>
          )}

          <CollectionOwnerOrModOnly collectible={collectible}>
            <li>
              <a onClick={() => toggleSuppress()}>{isSuppressed ? 'Unsuppress' : 'Suppress Collectible'}</a>
              <small>Deprecate or blacklist wearable</small>
            </li>
          </CollectionOwnerOrModOnly>
          <li>
            <ReportButton type="collectible" item={{ id: collectible.chain_id + ':' + collectible.collection_address + ':' + collectible.token_id }}>
              <option value="Asset contains NSFW content">Asset contains NSFW content</option>
              <option value="Asset contains Violent content">Asset contains Violent content</option>
              <option value="Asset has plagiarised content">Asset has plagiarised content</option>
              <option value="Asset violates the rules in other ways">Asset violates the rules in other ways</option>
            </ReportButton>
          </li>
        </ul>
      </div>
    </CollectionOwnerOrModOrCollectibleAuthorOnly>
  )
}

const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

function OwnersOfCollectible(props: { collectible: CollectibleRecord | WearableHelper; onResult: (owners: string[]) => void; cachebuster?: number }) {
  const { collectible, onResult } = props
  const [owners, setOwners] = useState<{ wallet: string; name?: string; quantity: number }[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  if (!collectible) {
    return null
  }

  const fetchOwnersOfAsset = async (update: boolean) => {
    setLoading(true)
    let url = `${process.env.SUBGRAPHS_ROUTER}/api/wallets/${collectible.collection_address}/${collectible.token_id}.json`
    if (update) url += '?force_update=true'
    const p = await fetch(url, { headers })
    const r = await p.json()
    if (r.owners.length) {
      const parsedOwners: { wallet: string; name?: string; quantity: number }[] = r.owners.map((o: { address: string; quantity: string }) => {
        return { ...o, wallet: o.address }
      })
      onResult(parsedOwners.map((o) => o.wallet)) // send back result to parent component
      setOwners(parsedOwners)
    }
    setLoading(false)
  }

  const fetchNamesOfOwners = async () => {
    const body = {
      wallets: owners.map((o) => o.wallet),
    }

    const p = await fetch(`${process.env.API}/avatars/name-by-wallets.json`, { method: 'post', headers, body: JSON.stringify(body) })
    const r = await p.json()

    let ownersWithNames = [...owners]

    if (r.names) {
      ownersWithNames = owners.map((o) => {
        const nameRecord = r.names.find((namesAndWallet: any) => {
          return namesAndWallet.owner.toLowerCase() == o.wallet.toLowerCase()
        })
        return { ...o, name: nameRecord?.name || null }
      })
    }
    setOwners(ownersWithNames)
  }

  useEffect(() => {
    fetchOwnersOfAsset(false)
  }, [])

  useEffect(() => {
    if (props.cachebuster) {
      fetchOwnersOfAsset(true).then(fetchNamesOfOwners)
    }
  }, [props.cachebuster])

  useEffect(() => {
    if (owners.length) {
      fetchNamesOfOwners()
    }
  }, [owners.length])

  return (
    <div>
      <h3>Owners</h3>
      {!loading ? (
        <div>
          {owners.map((o: any) => (
            <Owner {...o} />
          ))}
        </div>
      ) : (
        <div>
          <Spinner size={16} bg="light" />
        </div>
      )}
    </div>
  )
}

function Owner(props: { wallet: string; name: string; quantity: number }) {
  const { wallet, name, quantity } = props

  const displayName = () => {
    return name.length > 64 ? name.substring(0, 63) + '...' : name
  }

  const classes = `quantity quantity-${quantity}`
  const link = `/u/${wallet}`

  return (
    <div>
      <a href={link}>{(!!name && displayName()) || wallet.substring(0, 7) + '...'}</a>
      <span class={classes}>{quantity}</span>
    </div>
  )
}

function EditWearableCategory({ wearable, onSave }: { wearable: WearableHelper; onSave?: () => void }) {
  const [category, setCategory] = useState<WearableCategory>(WearableCategory.Accessory)

  const saveCategory = async () => {
    if (!wearable.id) {
      app.showSnackbar('Invalid wearable data.. Can not save', PanelType.Danger)
      return
    }
    const p = await saveAsset(AssetType.Collectible, wearable.id, { category })
    if (p.success) {
      app.showSnackbar('Success!', PanelType.Success)
      !!onSave && onSave()
    } else {
      app.showSnackbar('Try again later', PanelType.Danger)
    }
  }

  return (
    <div>
      <select onChange={(e) => setCategory(e.currentTarget['value'] as WearableCategory)}>
        {Object.entries(WearableCategory).map(([key, value]) => {
          return (
            <option key={value} value={value}>
              {key}
            </option>
          )
        })}
      </select>
      <button onClick={() => saveCategory()}>Save</button>
    </div>
  )
}
