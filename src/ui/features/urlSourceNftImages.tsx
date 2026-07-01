import { OpenSeaNFTV2Extended } from '../../../common/messages/api-opensea'
import NftCollectionsComponent, { Collection } from '../../components/nft-images-by-collections'
import NftImage from '../../features/nft-image'
import { LOADING } from './misc'
import { ReuseTab, tabNames, UrlSourceComponent, UrlSourceComponentProps, UrlSourceComponentState, URLTab } from './urlSourceComponent'

type UrlSourceNftImagesProps = UrlSourceComponentProps & {
  feature: NftImage
}

type UrlSourceNftImagesState = UrlSourceComponentState & {
  collections: Collection[]
  loading: boolean
}

export class UrlSourceNftImages extends UrlSourceComponent<UrlSourceNftImagesProps, UrlSourceNftImagesState> {
  constructor(props: UrlSourceNftImagesProps) {
    super(props)
    this.state = {
      ...this.initialUrlSourceComponentState,
      collections: [],
      loading: false,
    }
  }

  initVault() {
    this.setState({ urlTab: 'vault' })
    this.updateCollections()
  }

  async updateCollections() {
    this.setState({ loading: true, collections: [] })

    const nfts: OpenSeaNFTV2Extended[] = await fetch(`${process.env.API}/externals/opensea/nfts.json`)
      .then((res) => res.json())
      .then((r) => (r.success ? r.nfts : []))
      .catch((e) => {
        console.warn(`Error fetching NFTs: ${e}`)
        return []
      })

    const collections: Collection[] = nfts
      // get collection names from the NFTs
      .map((n) => n.collection)
      // remove duplicates
      .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
      // simple alpha-numeric sorting
      .sort()
      // group all NFTs into each collection
      .map((collectionName: string) => ({
        collection: collectionName,
        items: nfts.filter((n) => n.collection === collectionName),
      }))

    this.setState({ loading: false, collections })
  }

  // only refresh a single NFT
  async refreshNFT() {
    this.setState({ loading: true }, () => {
      this.props.feature.forceRefresh()
      //for the sake of UX
      setTimeout(() => {
        this.setState({ loading: false })
      }, 1500)
    })
  }

  render() {
    return (
      <>
        <dd class="full">
          <div class="button-tabs">
            <button className={this.isActiveTab('url') ? 'active' : ''} onClick={() => this.setActiveTab('url')}>
              URL
            </button>
            <button className={this.isActiveTab('vault') ? 'active' : ''} onClick={() => this.initVault()}>
              Your NFTs
            </button>
            <button className={this.isActiveTab('re-use') ? 'active' : ''} onClick={() => this.setActiveTab('re-use')}>
              Recent
            </button>
          </div>
        </dd>
        <URLTab urlTab={this.state.urlTab} url={this.state.url} setURL={this.updateUrl.bind(this)}>
          <div>
            <small>Copy the Asset URL from OpenSea.</small>
            {this.state.url && (
              <button title="Force refresh of Opensea Data" onClick={() => this.refreshNFT()}>
                {this.state.loading ? 'Refreshing...' : 'Refresh'}
              </button>
            )}
          </div>
        </URLTab>
        <CollectionsTab urlTab={this.state.urlTab} setURL={this.setUrl.bind(this)} collection={this.state.collections} loading={this.state.loading} refreshVault={this.updateCollections.bind(this)} />
        <ReuseTab urlTab={this.state.urlTab} setURL={this.setUrl.bind(this)} userResources={this.userResources} type={this.props.feature.type} />
      </>
    )
  }
}

interface CollectionsTabProps {
  urlTab: tabNames
  setURL: (v: string | undefined) => void
  collection: Collection[]
  loading: boolean
  refreshVault: () => void
}

function CollectionsTab(props: CollectionsTabProps) {
  if (props.urlTab !== 'vault') return null

  const vault = props.collection.map((c: any) => <NftCollectionsComponent collection={c} callback={props.setURL} />)

  return (
    <>
      <dt>Your NFTs</dt>
      <dd class="full">
        <div className="voxel-library">{props.loading ? LOADING : vault.length > 0 ? vault : 'You have no NFTs'}</div>
        <button onClick={props.refreshVault}>Refresh</button>
      </dd>
    </>
  )
}
