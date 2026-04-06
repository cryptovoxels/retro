import { Component } from 'preact'
import { opensea, readOpenseaUrl } from '../utils/proxy'
import { SingleParcelRecord } from '../../common/messages/parcel'
import { FeatureCommon, FeatureType } from '../../common/messages/feature'
import { imageUrlViaProxy, tidyURL } from '../utils/helpers'

interface Props {
  items: FeatureCommon[]
  callback?: (url: string) => void
}

interface State {
  items: FeatureCommon[]
  category: null
  imgUrls: Record<string, string>
  loaded: boolean
}

export class ItemsByCategories extends Component<Props, State> {
  constructor(props: any) {
    super()

    this.state = {
      items: props.items || [],
      category: null,
      imgUrls: {},
      loaded: true,
    }
  }

  componentDidMount = () => this.refresh()

  setStateAsync = (state: Partial<State>): Promise<void> => new Promise((resolve) => this.setState(state, resolve))

  refresh() {
    this.setState({ loaded: false })
    const imgUrls: Record<string, string> = {}

    // @todo(stojg) run this with promise all
    this.onlyFeaturesWithUrl().forEach(async (feature) => {
      if (!feature.uuid) {
        return
      }
      const u = await this.getImage(feature)
      if (u) imgUrls[feature.uuid] = imageUrlViaProxy(u, 55)
    })

    this.setState({ imgUrls: imgUrls, loaded: true })
  }

  async componentDidUpdate(prevProps: Props) {
    if (prevProps.items != this.props.items) {
      await this.setStateAsync({ items: this.props.items || [] })
      this.refresh()
    }
  }

  onClick(url: any) {
    this.props.callback?.(url)
  }

  onlyFeaturesWithUrl() {
    return this.state.items.filter((f: FeatureCommon) => tidyURL(f.url))
  }

  async nftImage(feature: FeatureCommon) {
    const url = tidyURL(feature.url)
    if (!url) return ''
    const info = readOpenseaUrl(url)
    if (!info) return ''
    const r = await opensea(info.contract, info.token, info.chain)
    return r.animation_url || r.image_url || r.image_preview_url || ''
  }

  async getImage(item: FeatureCommon) {
    switch (item.type) {
      case 'image':
      case 'cube':
        return tidyURL(item.url)
      case 'nft-image':
        return tidyURL(await this.nftImage(item))
      case 'vox-model':
        return `${process.env.ASSET_PATH}/icons/vox-model.png`
      case 'audio':
        return `${process.env.ASSET_PATH}/icons/audio.png`
      default:
        return ''
    }
  }

  shortenDropboxUrl(url: string | undefined) {
    if (!url) return ''
    const u = url
    if (!!u.match(/(https?:\/\/(.+?\.)?dropbox\.com(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/gim)) {
      const path = u.substring(u.lastIndexOf('/') + 1)
      return `dropbox/.../${path}`
    }
    return url
  }

  render() {
    const items = this.state.imgUrls
      ? this.onlyFeaturesWithUrl().map((feature: FeatureCommon) => {
          if (!feature.uuid) return
          const imgUrl = this.state.imgUrls[feature.uuid]
          const url = tidyURL(feature.url)
          const name = 'id' in feature ? `id: ${feature.id}` : this.shortenDropboxUrl(url)
          return (
            <a onClick={() => this.onClick(url)} style="overflow: hidden;display: inline-flex; max-width: 100%;">
              <img width={20} height={20} src={imgUrl} alt={url} />
              <p>{name}</p>
            </a>
          )
        })
      : null

    return (
      <div className="category-models">
        {this.onlyFeaturesWithUrl().length > 0 ? (
          items
        ) : (
          <a>
            <p>{this.state.loaded ? 'No features to show.' : 'Loading...'}</p>
          </a>
        )}
      </div>
    )
  }
}

interface categoryProps {
  category: SingleParcelRecord
  type: FeatureType
  callback?: (url: string) => void
}

interface categoryState {
  collapsed: boolean
  features: Record<FeatureType, FeatureCommon[]>
}

export default class CategorizedItemsComponent extends Component<categoryProps, categoryState> {
  constructor(props: categoryProps) {
    super()

    const perType: Record<string, FeatureCommon[]> = {}

    if (props.category.features) {
      props.category.features.forEach((f) => {
        if (!perType[f.type]) perType[f.type] = []
        perType[f.type].push(f)
      })
    }
    this.state = { collapsed: true, features: perType }
  }

  get isCategoryAParcel() {
    return !!this.props.category.address && !!this.props.category.features
  }

  get categoryObject(): SingleParcelRecord {
    return this.props.category
  }

  render() {
    return (
      <div>
        <div className="category-name" onClick={() => this.setState({ collapsed: !this.state.collapsed })}>
          <h5>
            {this.state.collapsed ? '+ ' : '- '}
            {this.isCategoryAParcel ? this.categoryObject.name || this.categoryObject.address : this.categoryObject.name}
          </h5>
        </div>
        <div className={`collapsible ${this.state.collapsed ? 'collapsed' : ''}`}>
          <ItemsByCategories items={this.state.features[this.props.type]} callback={this.props.callback} />
        </div>
      </div>
    )
  }
}
