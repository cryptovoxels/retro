import { Component } from 'preact'
import { debounce } from 'lodash'
import { uploadWithProgress } from '../../../common/helpers/upload-media'
import Feature from '../../features/feature'
import { isURL, resolveUgc, tidyURL } from '../../utils/helpers'
import { updateHighlight } from './common'

const MAX_UPLOAD = 50 * 1024 * 1024
const FANCY_ACCEPTS = new Set(['image', 'vox', 'mp3', 'mp4'])

const fileAccept = (accept?: string) => {
  if (accept === 'image') return 'image/*'
  if (accept === 'vox') return '.vox'
  if (accept === 'mp3') return 'audio/mpeg,.mp3'
  if (accept === 'mp4') return 'video/mp4,.mp4'
  return undefined
}

const isUgc = (u?: string) => !!u && u.startsWith('ugc://')

const ugcName = (u: string) => {
  const file =
    u
      .replace(/^ugc:\/\//, '')
      .split('/')
      .pop() || u
  // generateFileName appends _<md5>, strip it for display: trinity_cube.vox
  return decodeURIComponent(file.replace(/_[0-9a-f]{32}(\.[^.]*)?$/i, '$1'))
}

const humanSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`)

export type SourceInputProps = {
  feature: Feature
  accept?: string
  url?: string
  handleStateChange?: (url?: string) => void
}

type SourceInputState = {
  url?: string
  editing: boolean
  progress: number | null
  error?: string
  size?: number
}

export class SourceInput extends Component<SourceInputProps, SourceInputState> {
  updateUrl = debounce((url: string) => this.setState({ url }), 200, { leading: false, trailing: true })

  constructor(props: SourceInputProps) {
    super(props)
    const url = props.url ?? props.feature.description.url ?? undefined
    this.state = {
      url: url ? tidyURL(url) : undefined,
      editing: false,
      progress: null,
    }
  }

  get fancy() {
    return FANCY_ACCEPTS.has(this.props.accept ?? '')
  }

  get imageAccept() {
    return this.props.accept === 'image'
  }

  componentDidMount() {
    this.fetchSize()
  }

  componentDidUpdate(_p: SourceInputProps, prev: SourceInputState) {
    if (this.state.url === prev.url) return
    this.props.feature.set({ url: this.state.url })
    updateHighlight()
    this.props.handleStateChange?.(this.state.url)
    this.fetchSize()
  }

  fetchSize = async () => {
    const { url } = this.state
    if (!isUgc(url)) return
    try {
      const res = await fetch(resolveUgc(url)!, { method: 'HEAD' })
      const len = Number(res.headers.get('content-length'))
      if (len) this.setState({ size: len })
    } catch {}
  }

  onUrlInput = (value: string) => {
    if (!value) {
      this.setState({ url: undefined, editing: false, size: undefined })
      return
    }
    this.updateUrl(value)
  }

  onChange = () => {
    if (this.imageAccept) {
      this.setState({ editing: true })
      return
    }
    this.setState({ url: undefined, editing: false, size: undefined })
  }

  onFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (file.size > MAX_UPLOAD) {
      this.setState({ error: 'File must be under 50MB' })
      return
    }

    this.setState({ error: undefined, progress: 0, size: undefined })
    const result = await uploadWithProgress(file, (pct) => this.setState({ progress: pct }))
    if (result.success) {
      this.setState({ url: result.location, editing: false, progress: null })
    } else {
      this.setState({ error: result.error, progress: null })
    }
  }

  renderFancy() {
    const { url, editing, progress, error, size } = this.state
    const accept = fileAccept(this.props.accept)

    if (progress !== null) {
      return (
        <>
          <progress max={100} value={progress} />
          <span>{progress}%</span>
        </>
      )
    }

    if (!url) {
      return (
        <>
          <input className="default-focus" type="file" accept={accept} onChange={(e) => this.onFile(e.currentTarget.files)} />
          {error && <small>{error}</small>}
        </>
      )
    }

    if (isUgc(url)) {
      return (
        <>
          <span>
            {ugcName(url)}
            {size ? ` (${humanSize(size)})` : ''}
          </span>
          <button onClick={() => this.onChange()}>change</button>
          {error && <small>{error}</small>}
        </>
      )
    }

    const showText = (this.imageAccept && (editing || !isURL(url))) || !isURL(url)

    if (showText) {
      return (
        <>
          <input className="default-focus" type="text" value={url} readOnly={!this.imageAccept} onInput={(e) => this.onUrlInput(e.currentTarget.value)} />
          {!this.imageAccept && <button onClick={() => this.onChange()}>change</button>}
          {error && <small>{error}</small>}
        </>
      )
    }

    return (
      <>
        <a href={url} target="_blank">
          {url}
        </a>
        <button onClick={() => this.onChange()}>change</button>
        {error && <small>{error}</small>}
      </>
    )
  }

  render() {
    return (
      <>
        <dt>URL</dt>
        <dd>
          {this.fancy ? this.renderFancy() : <input className="default-focus" type="text" value={this.state.url} onInput={(e) => this.updateUrl(e.currentTarget.value)} />}
          {this.props.children}
        </dd>
      </>
    )
  }
}
