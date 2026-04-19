import { Component, createRef, Ref, RefObject } from 'preact'
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
  cid?: number
  id?: number
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
    if (this.props !== prevProps) {
      this.fetch()
    }
  }

  fetch = async () => {
    let url = `/api/collections/${this.props.cid}/collectibles/${this.props.id}`

    const f = await fetch(url)
    const { collectible } = await f.json()

    this.setState({ collectible, loading: false })

    setTimeout(this.loadView, 100)
  }

  loadView = () => {
    if (!this.viewer) {
      this.viewer = new WearableViewer(this.canvas.current!)
    }

    this.viewer?.loadURL(`/api/collections/${this.props.cid}/collectibles/${this.props.id}/vox`)
  }

  get wearable() {
    return this.state.collectible
  }

  render() {
    if (this.state.loading || !this.wearable) {
      return <LoadingPage />
    }

    const openseaUrl = `https://opensea.io/assets/${this.wearable.collection_address}/${this.wearable.token_id}`

    return (
      <section class="columns">
        <h1>{this.wearable.name}</h1>

        <article>
          <figure>
            <canvas ref={this.canvas} class="wearable-canvas" />
          </figure>
        </article>
        <aside>
          <h3>Details</h3>
          <p>
            By <a href={`/marketplace/collectibles?q=${this.wearable.author}`}>{this.wearable.author}</a>
          </p>
          <p>
            <a href={openseaUrl}>View on OpenSea</a>
          </p>
          <dl>
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
