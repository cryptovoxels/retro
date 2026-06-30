import { MegavoxRecord, VoxModelRecord } from '../../../common/messages/feature'
import { fetchOptions } from '../../../web/src/utils'
import CategorizedItemsComponent from '../../components/item-by-categories'
import PublicVoxelLibrary from '../../components/voxmodels-by-category'
import VoxModel, { Megavox } from '../../features/vox-model'
import { uploadVoxModelMedia } from '../../utils/upload-vox-media'
import { NO_PARCEL_FOUND } from './misc'
import { UrlSourceComponent, UrlSourceComponentProps, UrlSourceComponentState } from './urlSourceComponent'

export type UrlSourceVoxModelsProps = UrlSourceComponentProps & {
  feature: Megavox | VoxModel<VoxModelRecord>
  scene: BABYLON.Scene
}
type UrlSourceVoxModelsState = UrlSourceComponentState & {
  type: VoxModelRecord['type'] | MegavoxRecord['type']
  library: any
}

export class UrlSourceVoxModels extends UrlSourceComponent<UrlSourceVoxModelsProps, UrlSourceVoxModelsState> {
  static library: any

  constructor(props: UrlSourceVoxModelsProps) {
    super(props)
    this.state = {
      ...this.initialUrlSourceComponentState,
      type: props.feature.type,
      library: null,
    }
  }

  get isMegavox() {
    return this.state.type === 'megavox'
  }

  get library() {
    return !!this.state.library && this.state.library
  }

  getLibrary() {
    if (UrlSourceVoxModels.library) {
      this.setState({ library: UrlSourceVoxModels.library, urlTab: 'library' })
    } else {
      this.fetchLibrary()
    }
  }

  fetchLibrary() {
    this.setState({ urlTab: 'library' })
    fetch(`${process.env.API}/voxels-library.json`, fetchOptions())
      .then((r) => r.json())
      .then((r) => {
        if (r) {
          this.setState({ library: r })
          UrlSourceVoxModels.library = r
        }
      })
  }

  render() {
    const library = this.state.urlTab === 'library' && this.library && this.library.map((c: any) => <PublicVoxelLibrary category={c} callback={this.setUrl.bind(this)} />)

    const userResources = this.state.urlTab === 're-use' && this.userResources.map((parcel) => <CategorizedItemsComponent category={parcel} type={this.props.feature.type} callback={this.setUrl.bind(this)} />)

    return (
      <>
        <dd class="full">
          <div class="button-tabs">
            <button class={(this.state.urlTab == 'url' && 'active') as any} onClick={() => this.setState({ urlTab: 'url' })}>
              URL
            </button>
            <button class={(this.state.urlTab == 'upload' && 'active') as string} onClick={() => this.setState({ urlTab: 'upload' })}>
              Upload
            </button>
            {!this.isMegavox && (
              <button class={(this.state.urlTab == 'library' && 'active') as string} onClick={() => this.getLibrary()}>
                Library
              </button>
            )}
            <button class={(this.state.urlTab == 're-use' && 'active') as string} onClick={() => this.setState({ urlTab: 're-use' })}>
              Recent
            </button>
          </div>
        </dd>
        {this.state.urlTab == 'url' ? (
          <>
            <dt>URL</dt>
            <dd>
              <input class="default-focus" type="text" value={this.state.url} onInput={(e) => this.updateUrl(e.currentTarget.value)} />
            </dd>
          </>
        ) : this.state.urlTab == 'library' ? (
          <>
            <dt>Public models</dt>
            <dd class="full">
              <div className="voxel-library">{library}</div>
              <button onClick={() => this.fetchLibrary()}>Refresh</button>
            </dd>
          </>
        ) : this.state.urlTab == 'upload' ? (
          <>
            <dt>Upload</dt>
            <dd class="upload-url">
              <input class="default-focus" type="file" accept=".vox" value={this.state.url} onChange={(e) => this._handleVoxFileUpload(e.currentTarget.files)} />
            </dd>
          </>
        ) : (
          <>
            <dt>Urls previously used</dt>
            <dd class="full">
              <div className="voxel-library">{(userResources as any).length > 0 ? userResources : NO_PARCEL_FOUND}</div>
            </dd>
          </>
        )}
      </>
    )
  }

  private async _handleVoxFileUpload(file: FileList | null) {
    const result =
      file && file[0]
        ? await uploadVoxModelMedia(file[0], this.props.feature.type === 'megavox', this.props.scene)
        : {
            success: false as const,
            error: 'Could not upload the file. Make sure it is a supported file type.',
          }
    if (result.success) {
      this.setState({ url: result.location, urlTab: 'url' })
    } else {
      alert(result.error)
    }
  }
}
