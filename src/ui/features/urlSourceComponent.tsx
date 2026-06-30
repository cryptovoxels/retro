import Feature from '../../features/feature'
import { Component } from 'preact'
import { FullParcelRecord } from '../../../common/messages/parcel'
import { tidyURL } from '../../utils/helpers'
import { debounce, uniqBy } from 'lodash'
import { uploadMedia } from '../../../common/helpers/upload-media'
import { app, AppEvent } from '../../../web/src/state'
import { updateHighlight } from './common'
import { WompCatalog } from '../../components/womp-catalog'
import { FeatureType, WompRecord } from '../../../common/messages/feature'
import CategorizedItemsComponent from '../../components/item-by-categories'
import { NO_PARCEL_FOUND } from './misc'

export type tabNames = 'url' | 'file' | 'library' | 're-use' | 'upload' | 'vault' | 'womps'

export type UrlSourceComponentProps = {
  handleStateChange?: (url?: string) => void
  feature: Feature
  url?: string
}

export type UrlSourceComponentState = {
  url?: string
  urlTab: tabNames
}

export class UrlSourceComponent<TProps extends UrlSourceComponentProps = UrlSourceComponentProps, TState extends UrlSourceComponentState = UrlSourceComponentState> extends Component<TProps, TState> {
  private static userResources: FullParcelRecord[] = []
  public updateUrl: (url: string) => void
  public wallet: string | undefined
  protected initialUrlSourceComponentState: UrlSourceComponentState // Derived classes can use to populate state in their ctors

  constructor(props: TProps) {
    super(props)

    const state: UrlSourceComponentState = { urlTab: 'url' }
    const url = props.url ?? props.feature.description.url ?? undefined

    if (url) {
      state.url = tidyURL(url)
    }

    this.initialUrlSourceComponentState = state

    this.updateUrl = debounce((url: string) => this.setState({ url }), 200, { leading: false, trailing: true })
  }

  get userResources() {
    return UrlSourceComponent.userResources || []
  }

  isActiveTab = (name: tabNames) => this.state.urlTab === name

  setActiveTab = (name: tabNames) => this.setState({ urlTab: name })

  setUrl = (url?: string) => this.setState({ url: url, urlTab: 'url' })

  /**
   * Uploads the first file in the given file list, ignoring the rest
   */
  async handleFileUpload(file: FileList | null) {
    const result = file && file[0] ? await uploadMedia(file[0]) : { success: false as const }
    if (result.success) {
      this.setState({ url: result.location, urlTab: 'url' })
    } else {
      alert('Could not upload the file. Make sure it is a supported file type.')
    }
  }

  onAppChange = () => {
    this.wallet = app.state.wallet ?? undefined
    this.fetchParcelsResources().then(/** ignored promise */)
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    this.onAppChange()
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Change, this.onAppChange)
  }

  componentDidUpdate(prevProps: TProps, prevState: TState) {
    if (this.state.url === prevState.url) {
      return
    }

    const url = this.state.url
    this.props.feature.set({ url })
    updateHighlight()
    if (this.props.handleStateChange) this.props.handleStateChange(this.state.url)
  }

  render() {
    return <div className="f"></div>
  }

  private async fetchParcelsResources() {
    UrlSourceComponent.userResources = []
    if (!this.wallet) return
    return fetch(`${process.env.API}/parcels/resources/${this.wallet}.json`)
      .then((f) => f.json())
      .then((r) => {
        if (!r.success) {
          throw new Error('fetching parcel resources failed')
        }
        // just keep features with unique URLs
        UrlSourceComponent.userResources = r.resources.map((parcel: FullParcelRecord) => {
          parcel.features = uniqBy(parcel.features, (f) => f.url)
          return parcel
        })
      })
      .catch(console.error)
  }
}

interface URLTabProps {
  urlTab: tabNames
  url: string | undefined
  setURL: (v: string) => void
}

export class URLTab extends Component<URLTabProps> {
  render() {
    if (this.props.urlTab !== 'url') {
      return null
    }
    return (
      <>
        <dt>URL</dt>
        <dd>
          <input className="default-focus" type="text" value={this.props.url} onInput={(e) => this.props.setURL(e.currentTarget.value)} />
          {this.props.children}
        </dd>
      </>
    )
  }
}

interface WompsTabProps {
  urlTab: tabNames
  onRefresh: () => void
  loading: boolean
  womps: WompRecord[]
  setURL?: (v: string) => void
  returnWomp?: (w: WompRecord) => void
}

export function WompsTab(props: WompsTabProps) {
  if (props.urlTab !== 'womps') {
    return null
  }

  let womps = <span>Loading</span>
  if (!props.loading) womps = <WompCatalog womps={props.womps} callback={props.setURL} returnWomp={props.returnWomp} />

  return (
    <>
      <dt>Womps you've taken</dt>
      <dd class="full">
        <div className="voxel-library">{womps}</div>
        <button onClick={props.onRefresh}>{props.loading ? 'Refreshing' : 'Refresh'}</button>
      </dd>
    </>
  )
}

interface ReuseTabProps {
  urlTab: tabNames
  setURL: (v: string) => void
  userResources: FullParcelRecord[]
  type: FeatureType
}

export function ReuseTab(props: ReuseTabProps) {
  if (props.urlTab !== 're-use') {
    return null
  }

  const imagesUserResources = props.userResources.map((p) => {
    return <CategorizedItemsComponent category={p} type={props.type} callback={props.setURL} />
  })

  return (
    <>
      <dt>Urls previously used</dt>
      <dd class="full">
        <div className="voxel-library">{imagesUserResources || NO_PARCEL_FOUND}</div>
      </dd>
    </>
  )
}

interface UploadTabProps {
  urlTab: tabNames
  handleFileUpload: (files: FileList | null) => void
  url: string | undefined
}

export function UploadTab(props: UploadTabProps) {
  if (props.urlTab !== 'upload') {
    return null
  }
  return (
    <>
      <dt>Upload</dt>
      <dd class="upload-url">
        <input className="default-focus" type="file" accept=".jpeg,.jpg,.gif,.png" value={props.url} onChange={(e) => props.handleFileUpload(e.currentTarget.files)} />
      </dd>
    </>
  )
}
