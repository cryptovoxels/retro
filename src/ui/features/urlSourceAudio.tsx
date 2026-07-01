import { ReuseTab, UploadTab, UrlSourceComponent, URLTab } from './urlSourceComponent'
import { UrlSourceVoxModelsProps } from './urlSourceVoxModels'

export class UrlSourceAudio extends UrlSourceComponent {
  constructor(props: UrlSourceVoxModelsProps) {
    super(props)
    this.state = { ...this.initialUrlSourceComponentState }
  }

  render() {
    return (
      <>
        <dd class="full">
          <div class="button-tabs">
            <button className={this.isActiveTab('url') ? 'active' : ''} onClick={() => this.setActiveTab('url')}>
              URL
            </button>
            <button className={this.isActiveTab('upload') ? 'active' : ''} onClick={() => this.setActiveTab('upload')}>
              Upload
            </button>
            <button className={this.isActiveTab('re-use') ? 'active' : ''} onClick={() => this.setActiveTab('re-use')}>
              Recent
            </button>
          </div>
        </dd>
        <URLTab urlTab={this.state.urlTab} setURL={this.updateUrl.bind(this)} url={this.state.url} />
        <UploadTab urlTab={this.state.urlTab} handleFileUpload={this.handleFileUpload.bind(this)} url={this.state.url} />
        <ReuseTab urlTab={this.state.urlTab} setURL={this.setUrl.bind(this)} userResources={this.userResources} type={this.props.feature.type} />

        {this.props.children}
      </>
    )
  }
}
