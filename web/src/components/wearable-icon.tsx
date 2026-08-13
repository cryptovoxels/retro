import { Component } from 'preact'
import { wearableThumbUrl } from '../../../common/renderable/thumb-url'
import VoxelImage from './voxel-image'

type Props = {
  id: string
  class?: string
  title?: string
}

type State = {
  cdnFailed: boolean
}

export default class WearableIcon extends Component<Props, State> {
  state: State = { cdnFailed: false }

  render() {
    const { id, class: className, title } = this.props
    if (!id) return null
    const wrap = ['wearable-icon', className].filter(Boolean).join(' ')

    if (!this.state.cdnFailed) {
      return (
        <span class={wrap} title={title}>
          <img src={wearableThumbUrl(id)} alt={title || ''} onError={() => this.setState({ cdnFailed: true })} />
        </span>
      )
    }

    return (
      <span class={wrap} title={title}>
        <VoxelImage src={`/api/collectibles/${id}/vox`} background="#e0e0e0" alt={title || ''} />
      </span>
    )
  }
}
