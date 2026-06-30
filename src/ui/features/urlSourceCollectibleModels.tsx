import { JSXInternal } from 'preact/src/jsx'
import { CollectiblesData, fetchUsersCollectiblesData } from '../../../common/helpers/collections-helpers'
import { CollectibleModelRecord } from '../../../common/messages/feature'
import { app } from '../../../web/src/state'
import { CollectiblesGrid } from '../../components/editor-ui/collectibles-grid'
import CollectibleModel from '../../features/collectible-model'
import { updateHighlight } from './common'
import { LOADING } from './misc'
import { UrlSourceComponent, UrlSourceComponentProps, UrlSourceComponentState } from './urlSourceComponent'

type UrlSourceCollectibleModelsProps = UrlSourceComponentProps & {
  feature: CollectibleModel
  handleStateChange?: (collectible?: CollectibleModelRecord['collectible']) => void
}
type UrlSourceCollectibleModelsState = UrlSourceComponentState & {
  collectible: CollectibleModelRecord['collectible']
  collectibles: CollectiblesData[]
  filter: string
  loading: boolean
}

export class UrlSourceCollectibleModels extends UrlSourceComponent<UrlSourceCollectibleModelsProps, UrlSourceCollectibleModelsState> {
  constructor(props: UrlSourceCollectibleModelsProps) {
    super(props)
    this.state = {
      ...this.initialUrlSourceComponentState,
      collectible: props.feature.description.collectible,
      collectibles: [],
      filter: '',
      loading: false,
    }
  }

  getCollectibleLibrary(cachebust = false) {
    this.fetchCollectibles(cachebust)
  }

  componentDidMount() {
    this.getCollectibleLibrary()
  }

  componentDidUpdate(prevProps: UrlSourceCollectibleModelsProps, prevState: UrlSourceCollectibleModelsState) {
    if (this.state.collectible?.hash === prevState.collectible?.hash) {
      return
    }
    const collectible = this.state.collectible
    if (collectible) {
      this.props.feature.set({ collectible })
      updateHighlight()
    }
    if (this.props.handleStateChange) this.props.handleStateChange(this.state.collectible)
  }

  async fetchCollectibles(cachebust = false) {
    if (!app.state.wallet) {
      console.warn('Can not fetch Collectibles. No wallet')
      return
    }
    this.setState({ loading: true })
    const collectibles = await fetchUsersCollectiblesData(app.state.wallet, cachebust)
    this.setState({ collectibles, loading: false })
  }

  setCollectible(collectible: CollectiblesData) {
    this.setState({ collectible: collectible as any })
  }

  handleInputChange(event: JSXInternal.TargetedEvent<HTMLInputElement>) {
    this.setState({ filter: event.currentTarget.value })
  }

  render() {
    let collectibles = null
    if (this.state.collectibles.length > 0) {
      collectibles = <CollectiblesGrid collectibles={this.state.collectibles} filter={this.state.filter} callback={this.setCollectible.bind(this)} />
    }

    return (
      <>
        <dt>Your Collectibles</dt>
        <dd class="full">
          <div className="voxel-library">{this.state.loading ? LOADING : collectibles}</div>
          <div style="display: flex; margin-top: 10px">
            <button onClick={() => this.getCollectibleLibrary(true)}>Refresh</button>
            <input style="font-size: smaller" value={this.state.filter} onInput={this.handleInputChange.bind(this)} placeholder="Search collectibles" type="text" />
          </div>
        </dd>
      </>
    )
  }
}
