import { Component } from 'preact'
import { debounce } from 'lodash'
import { Attachment } from './index'
import { bucketUrl, renderUrl } from '../assets'
import Image from '../components/image'

export type WearableRow = { id: string; name: string; is_free: boolean; default_bone?: string | null }

interface Props {
  attachment: Attachment
  bone: string
  onPick: (w: WearableRow) => void
}

interface State {
  query: string
  open: boolean
  wearables: WearableRow[]
  loading: boolean
}

export default class WearableSelector extends Component<Props, State> {
  state: State = { query: '', open: true, wearables: [], loading: true }

  componentDidMount() {
    void this.suggest()
  }

  componentDidUpdate(prev: Props) {
    if (prev.bone !== this.props.bone) {
      this.setState({ query: '' })
      void this.suggest()
    }
  }

  suggest = async () => {
    this.setState({ loading: true })
    const res = await fetch(`/api/wearables/suggest?bone=${encodeURIComponent(this.props.bone)}`)
    if (!res.ok) {
      this.setState({ loading: false })
      return
    }
    const { wearables } = await res.json()
    this.setState({ wearables, loading: false })
  }

  search = debounce(async (q: string) => {
    this.setState({ loading: true })
    const res = await fetch(`/api/wearables/search?q=${encodeURIComponent(q)}`)
    if (!res.ok) {
      this.setState({ loading: false })
      return
    }
    const { wearables } = await res.json()
    this.setState({ wearables, loading: false })
  }, 300)

  onInput = (e: Event) => {
    const q = (e.currentTarget as HTMLInputElement).value
    this.setState({ query: q })
    if (q) {
      this.search(q)
    } else {
      void this.suggest()
    }
  }

  render() {
    const { attachment } = this.props
    const { query, open, wearables, loading } = this.state

    const free = wearables.filter((w) => w.is_free)
    // todo: ownership not yet tracked in DB - 'yours' tab always empty for now
    const editions = wearables.filter((w) => !w.is_free)

    const grid = (items: WearableRow[]) =>
      items.map((w) => (
        <li key={w.id} class={attachment.wid === w.id ? 'active' : ''} onClick={() => this.props.onPick(w)}>
          <Image type="wearable" src={bucketUrl(w.id)} altsrc={renderUrl(w.id)} />
          <span>{w.name}</span>
        </li>
      ))

    return (
      <div class="wearable-selector">
        <div class="f">
          <input type="search" value={query} placeholder="search wearables..." onInput={this.onInput} />
          <button type="button" class="toggle" onClick={() => this.setState({ open: !open })}>
            {open ? '^' : 'v'}
          </button>
        </div>
        {open && (
          <div class="wearable-selector-grid">
            {loading && <span>loading...</span>}
            {!loading && free.length > 0 && (
              <>
                <h4>free</h4>
                <ul>{grid(free)}</ul>
              </>
            )}
            {!loading && editions.length > 0 && (
              <>
                <h4>editions</h4>
                <ul>{grid(editions)}</ul>
              </>
            )}
            {!loading && wearables.length === 0 && <span>no results</span>}
          </div>
        )}
      </div>
    )
  }
}
