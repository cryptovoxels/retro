import type { WompRecord } from '../../../common/messages/feature'
import { app } from '../../../web/src/state'
import { fetchOptions } from '../../../web/src/utils'
import Cube from '../../features/cube'
import Image from '../../features/image'
import { ReuseTab, UploadTab, UrlSourceComponent, UrlSourceComponentProps, UrlSourceComponentState, URLTab, WompsTab } from './urlSourceComponent'

type UrlSourceImagesProps = UrlSourceComponentProps & {
  feature: Image | Cube
}

type UrlSourceImagesState = UrlSourceComponentState & {
  womps: WompRecord[]
  wompsLoading: boolean
}

export class UrlSourceImages extends UrlSourceComponent<UrlSourceImagesProps, UrlSourceImagesState> {
  constructor(props: UrlSourceImagesProps) {
    super(props)
    this.state = {
      ...this.initialUrlSourceComponentState,
      womps: [],
      wompsLoading: true,
    }
  }

  getWomps() {
    this.setActiveTab('womps')
    this.fetchWomps()
  }

  fetchWomps() {
    this.setState({ wompsLoading: true, womps: [] })
    fetch(`${process.env.API}/womps/by/${app.state.wallet}`, fetchOptions())
      .then((r) => r.json())
      .then((r: any) => {
        if (!r.success) throw new Error('failed fetching womps')
        this.setState({ wompsLoading: false, womps: r.womps || [] })
      })
      .catch(console.error)
  }

  render() {
    return (
      <>
        <dd class="full">
          <div class="button-tabs">
            <button class={this.isActiveTab('url') ? 'active' : ''} onClick={() => this.setActiveTab('url')}>
              URL
            </button>
            <button class={this.isActiveTab('upload') ? 'active' : ''} onClick={() => this.setActiveTab('upload')}>
              Upload
            </button>
            <button class={this.isActiveTab('womps') ? 'active' : ''} onClick={this.getWomps.bind(this)}>
              Womps
            </button>
            <button class={this.isActiveTab('re-use') ? 'active' : ''} onClick={() => this.setActiveTab('re-use')}>
              Recent
            </button>
          </div>
        </dd>
        <URLTab urlTab={this.state.urlTab} setURL={this.updateUrl.bind(this)} url={this.state.url} />
        <UploadTab urlTab={this.state.urlTab} handleFileUpload={this.handleFileUpload.bind(this)} url={this.state.url} />
        <WompsTab urlTab={this.state.urlTab} setURL={this.setUrl.bind(this)} onRefresh={this.fetchWomps.bind(this)} loading={this.state.wompsLoading} womps={this.state.womps} />
        <ReuseTab urlTab={this.state.urlTab} setURL={this.setUrl.bind(this)} userResources={this.userResources} type={this.props.feature.type} />
      </>
    )
  }
}
