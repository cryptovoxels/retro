import { Component } from 'preact'
import { requestThumb } from '../helpers/voxel-thumb'

type Props = {
  src: string
  background?: string
  class?: string
  alt?: string
}

type State = {
  url: string | null
  failed: boolean
}

export default class VoxelImage extends Component<Props, State> {
  state: State = { url: null, failed: false }
  private alive = true

  componentDidMount() {
    void this.load()
  }

  componentDidUpdate(prev: Props) {
    if (prev.src !== this.props.src || prev.background !== this.props.background) {
      this.setState({ url: null, failed: false })
      void this.load()
    }
  }

  componentWillUnmount() {
    this.alive = false
  }

  load = async () => {
    const { src, background = '#ff00aa' } = this.props
    if (!src) {
      if (this.alive) this.setState({ failed: true })
      return
    }
    try {
      const url = await requestThumb(src, background)
      if (this.alive) this.setState({ url, failed: false })
    } catch (e) {
      console.error('[VoxelImage]', src, e)
      if (this.alive) this.setState({ failed: true })
    }
  }

  render() {
    const { alt = '', class: className } = this.props
    const { url, failed } = this.state

    if (failed) return <div class={className} />
    if (!url) {
      return <div class={['loading-image', className].filter(Boolean).join(' ')} />
    }
    return <img src={url} alt={alt} class={className} />
  }
}
