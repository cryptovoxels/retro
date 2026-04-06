import { render } from 'preact'
import { getWearableGif } from '../../../web/src/helpers/wearable-helpers'

import CollectibleModel from '../../features/collectible-model'
import { exitPointerLock } from '../../../common/helpers/ui-helpers'
import { HTMLUi } from './html-ui'
import { unmountComponentAtNode } from 'preact/compat'
import { SUPPORTED_CHAINS_BY_ID } from '../../../common/helpers/chain-helpers'
import type { Scene } from '../../scene'

type Props = {
  collectible: CollectibleModel
  onClose: () => void
  status?: string
  scene: Scene
}
type State = {
  collectible: CollectibleModel
  author_name: string | null
  status?: string
}

export class CollectibleHTMLUi extends HTMLUi<Props, State> {
  static currentElement: HTMLDivElement

  constructor(props: Props) {
    super()

    this.state = {
      collectible: props.collectible,
      author_name: null,
    }
  }

  get asset() {
    return this.feature?.description.collectible
  }

  get enteredParcel() {
    return this.connector.enteredParcel
  }

  get name() {
    return this.asset?.name
  }

  get collection_name() {
    return this.asset?.collection_name
  }

  get urlPage() {
    if (this.asset) {
      return `${process.env.ASSET_PATH}/collections/${SUPPORTED_CHAINS_BY_ID[this.asset.chain_id]}/${this.asset.collection_address}/${this.asset.token_id}`
    }
  }

  get collection_address() {
    return this.asset?.collection_address
  }

  get isTriable() {
    return !!this.feature?.description.tryable
  }

  get openseaUrl() {
    return this.asset?.chain_id == 1 ? 'https://opensea.io/assets/ethereum/' : 'https://opensea.io/assets/matic/'
  }

  get connector() {
    return window.connector
  }

  get isWearing() {
    return this.feature && this.feature.currentAvatar === this.connector.persona.avatar
  }

  get feature() {
    return this.state.collectible
  }

  componentDidMount() {
    this.fetchAuthorName()
  }

  async fetchAuthorName() {
    if (this.asset) {
      const p = await fetch(`${process.env.API}/avatar/${this.asset.author}/name.json`)
      const r = await p.json()
      if (r.success) {
        this.setState({ author_name: r.name.name })
      }
    }
  }

  redirectToPage() {
    window.open(`${this.urlPage}`, '_blank')
  }

  redirectToOpensea() {
    if (this.asset) {
      window.open(`${this.openseaUrl + this.asset.collection_address}/${this.asset.token_id}`, '_blank')
    }
  }

  getAvatar(wallet: string) {
    if (!this.connector) {
      return null
    }
    return this.connector.findAvatarByWallet(wallet)
  }

  onTryCollectible() {
    this.feature?.tryOnCollectible && this.feature?.tryOnCollectible()
    this.close()
  }

  onTakeOffCollectible() {
    this.feature?.takeOffCollectible && this.feature?.takeOffCollectible()
    this.close()
  }

  close() {
    this.props.onClose()
  }

  render() {
    return (
      <div className={`OverlayWindow -nft-view`}>
        <header>
          <h3>{this.name}</h3>
          <button className="close" onClick={() => this.close()}>
            &times;
          </button>
        </header>
        <section className="SplitPanel">
          <div className="Panel">
            <div className="Center">
              <img src={getWearableGif(this.asset)}></img>
              {this.isTriable && (
                <div className="overlay-large-button" onClick={() => (this.isWearing ? this.onTakeOffCollectible() : this.enteredParcel && this.onTryCollectible())}>
                  <h1>{this.isWearing ? 'Remove' : 'Try it on'}</h1>
                  <small>
                    {!!this.isWearing
                      ? `You're currently testing this wearable. Click to remove it`
                      : this.enteredParcel
                        ? `Try this wearable with the author's recommended placement`
                        : `Enter this parcel to be able to tryOnCollectible this collectible.`}
                  </small>
                </div>
              )}
            </div>
          </div>
          <div className="Panel">
            <div className="OverlayHighlightContent">
              <h4>Collection:</h4>
              <p>{this.collection_name}</p>
            </div>
            <div className="OverlayHighlightContent -scrollable">
              <h4>Description</h4>
              <p>{this.asset?.description}</p>
            </div>
            <div className="OverlayHighlightContent -link">
              <h4>Creator</h4>
              <p>{this.state.author_name || this.asset?.author}</p>
            </div>
            <div className="OverlayHighlightContent">
              <h4>Chain</h4>
              <p>{this.asset?.chain_id == 137 ? 'Matic' : 'Ethereum'}</p>
            </div>
            <div className="OverlayHighlightContent">
              <h4>Token Id</h4>
              <p>{this.asset?.token_id}</p>
            </div>
            <div className="OverlayHighlightContent">
              <button
                onClick={() => {
                  this.redirectToPage()
                }}
              >
                View Collectible
              </button>
              <button
                onClick={() => {
                  this.redirectToOpensea()
                }}
              >
                View on OpenSea
              </button>
            </div>
          </div>
        </section>
      </div>
    )
  }
}

export default function showCollectibleHTMLUi(collectible: CollectibleModel, scene: Scene) {
  if (!!CollectibleHTMLUi.currentElement) {
    unmountComponentAtNode(CollectibleHTMLUi.currentElement)
    CollectibleHTMLUi.currentElement = null!
    CollectibleHTMLUi.close()
  }

  const div = document.createElement('div')
  div.className = 'pointer-lock-close'
  CollectibleHTMLUi.currentElement = div
  document.body.appendChild(div)

  const onClose = () => {
    unmountComponentAtNode(div)
    div.remove()
    CollectibleHTMLUi.currentElement = null!
    HTMLUi.close()
  }

  render(<CollectibleHTMLUi collectible={collectible} onClose={onClose} scene={scene} />, div)

  exitPointerLock()
}
