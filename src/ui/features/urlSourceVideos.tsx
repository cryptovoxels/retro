import { ProxyAssetOpensea } from '../../../common/messages/api-opensea'
import Video from '../../features/video'
import { opensea, readOpenseaUrl } from '../../utils/proxy'
import { updateHighlight } from './common'
import { UrlSourceComponent, UrlSourceComponentProps, UrlSourceComponentState } from './urlSourceComponent'

type UrlSourceVideosProps = UrlSourceComponentProps & {
  feature: Video
  handleStateChange?: (url?: string, assetUrl?: string | null | undefined) => void
}
type UrlSourceVideosState = UrlSourceComponentState & {
  assetUrl: string | null | undefined // lol
}

export class UrlSourceVideos extends UrlSourceComponent<UrlSourceVideosProps, UrlSourceVideosState> {
  asset?: ProxyAssetOpensea
  tempUrl: string | undefined

  constructor(props: UrlSourceVideosProps) {
    super(props)

    this.state = {
      ...this.initialUrlSourceComponentState,
      assetUrl: props.feature.description.assetUrl,
    }
  }

  get isOpenseaNFT() {
    return !!this.tempUrl?.match(/(https?:\/\/(.+?\.)?opensea\.io(\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,;=]*)?)/gi) && !this.tempUrl.match(/storage.opensea/gi)
  }

  get hasAnimation() {
    return this.asset && !!this.asset.animation_url
  }

  componentDidUpdate(prevprops: UrlSourceVideosProps, prevState: UrlSourceVideosState) {
    if (this.state.url === prevState.url && this.state.assetUrl === prevState.assetUrl) {
      return
    }
    if (this.state.url) {
      this.props.feature.set({ url: this.state.url, assetUrl: this.state.assetUrl })
      updateHighlight()
    }
    if (this.props.handleStateChange) this.props.handleStateChange(this.state.url, this.state.assetUrl)
  }

  async getAssetVideo() {
    const nftInfo = this.tempUrl ? readOpenseaUrl(this.tempUrl) : null
    if (!nftInfo) {
      return null
    }

    if (this.hasAnimation && this.asset?.token_id === nftInfo.token && this.asset?.asset_contract.address === nftInfo.contract) {
      return this.asset?.animation_url
    } else {
      this.asset = await opensea(nftInfo.contract, nftInfo.token, nftInfo.chain, this.props.feature.parcel.owner, false)
      if (this.hasAnimation) {
        return this.asset?.animation_url
      }
      return null
    }
  }

  async videoUrl(): Promise<string | undefined> {
    if (this.isOpenseaNFT) {
      const url = await this.getAssetVideo()
      this.setState({ assetUrl: this.tempUrl })
      return url ?? undefined
    }
    this.setState({ assetUrl: null })
    return this.tempUrl
  }

  setUrl = async (url?: string) => {
    this.tempUrl = url
    const videoUrl = await this.videoUrl()
    this.setState({ url: videoUrl, urlTab: 'url' })
  }

  render() {
    return (
      <>
        <dt>Video URL</dt>
        <dd>
          <input type="text" value={this.state.url} onInput={(e) => this.setUrl(e.currentTarget.value)} />
        </dd>
        {this.state.assetUrl && (
          <>
            <dt>Original link</dt>
            <dd>
              <input type="text" value={this.state.assetUrl} readOnly={true} onClick={(e) => (e as any).target['select']()} />
            </dd>
          </>
        )}
        <dd class="full">
          <small>
            The video needs to be hosted somewhere that supports <strong>Anonymous CORS</strong>. We recommend using dropbox share links.
          </small>
          <small>Supports opensea link for .mp4 NFTs.</small>
        </dd>
      </>
    )
  }
}
