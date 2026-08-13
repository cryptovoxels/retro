import { Component } from 'preact'
import VoxelImage from './voxel-image'

type Props = {
  id: string
  class?: string
  title?: string
}

export default class WearableIcon extends Component<Props> {
  render() {
    const { id, class: className, title } = this.props
    if (!id) return null
    return (
      <span class={['wearable-icon', className].filter(Boolean).join(' ')} title={title}>
        <VoxelImage src={`/api/collectibles/${id}/vox`} background="#e0e0e0" alt={title || ''} />
      </span>
    )
  }
}
