import { Component } from 'preact'
import { debounce } from 'lodash'
import { fetchUsersCollectiblesData } from '../../../common/helpers/collections-helpers'
import { app } from '../state'
import { Attachment } from './index'
import { wearablesForBone } from './bone-wearables'
import { bucketUrl, renderUrl } from '../assets'
import Image from '../components/image'

type WearableRow = { id: string; name: string; is_free: boolean }
type Mode = 'owned' | 'free'

interface Props {
  attachment: Attachment
  bone: string
  onPick: (w: WearableRow) => void
}

interface State {
  query: string
  open: boolean
  owned: WearableRow[]
  free: WearableRow[]
  freeLoaded: boolean
  freeSearch: WearableRow[] | null
  mode: Mode
  loading: boolean
}

function toRow(w: { id?: string | null; name?: string | null; is_free?: boolean }): WearableRow {
  return { id: String(w.id || ''), name: w.name || '', is_free: !!w.is_free }
}

export default class WearableSelector extends Component<Props, State> {
  state: State = {
    query: '',
    open: true,
    owned: [],
    free: [],
    freeLoaded: false,
    freeSearch: null,
    mode: 'owned',
    loading: true,
  }

  componentDidMount() {
    void this.loadOwned()
  }

  componentDidUpdate(prev: Props) {
    if (prev.bone !== this.props.bone) {
      this.setState({ query: '', free: [], freeLoaded: false, freeSearch: null })
      void this.loadOwned()
    }
  }

  loadOwned = async () => {
    this.setState({ loading: true })
    const wallet = app.state.wallet
    const raw = wallet ? await fetchUsersCollectiblesData(wallet) : []
    const owned = wearablesForBone(this.props.bone, raw).map(toRow)
    if (owned.length === 0) {
      await this.loadFree(true)
      return
    }
    this.setState({ owned, mode: 'owned', loading: false })
  }

  loadFree = async (fromEmptyOwned = false) => {
    if (!fromEmptyOwned) {
      this.setState({ loading: true })
    }
    const res = await fetch(`/api/wearables/suggest?bone=${encodeURIComponent(this.props.bone)}`)
    if (!res.ok) {
      this.setState({ loading: false, freeLoaded: true, mode: 'free' })
      return
    }
    const { wearables } = await res.json()
    const free = (wearables as WearableRow[]).filter((w) => w.is_free)
    this.setState({
      free,
      freeLoaded: true,
      freeSearch: null,
      mode: 'free',
      loading: false,
    })
  }

  setMode = (mode: Mode) => {
    if (mode === 'free' && !this.state.freeLoaded) {
      void this.loadFree()
      return
    }
    this.setState({ mode, query: '', freeSearch: null })
  }

  searchFree = debounce(async (q: string) => {
    this.setState({ loading: true })
    const res = await fetch(`/api/wearables/search?q=${encodeURIComponent(q)}`)
    if (!res.ok) {
      this.setState({ loading: false })
      return
    }
    const { wearables } = await res.json()
    const freeSearch = (wearables as WearableRow[]).filter((w) => w.is_free)
    this.setState({ freeSearch, loading: false })
  }, 300)

  onInput = (e: Event) => {
    const q = (e.currentTarget as HTMLInputElement).value
    this.setState({ query: q })
    if (this.state.mode === 'free' && q) {
      this.searchFree(q)
    } else {
      this.setState({ freeSearch: null })
    }
  }

  render() {
    const { attachment } = this.props
    const { query, open, owned, free, freeSearch, mode, loading } = this.state
    const q = query.trim().toLowerCase()

    let items: WearableRow[] = []
    if (mode === 'owned') {
      items = q ? owned.filter((w) => w.name.toLowerCase().includes(q)) : owned
    } else {
      items = q ? (freeSearch ?? []) : free
    }

    const grid = (list: WearableRow[]) =>
      list.map((w) => (
        <li key={w.id} class={attachment.wid === w.id ? 'active' : ''} onClick={() => this.props.onPick(w)}>
          <Image type="wearable" src={bucketUrl(w.id)} altsrc={renderUrl(w.id)} />
          <span>{w.name}</span>
        </li>
      ))

    return (
      <div class="wearable-selector">
        <div class="f">
          {owned.length > 0 && (
            <button type="button" onClick={() => this.setMode('owned')}>
              owned
            </button>
          )}
          <button type="button" onClick={() => this.setMode('free')}>
            free
          </button>
        </div>
        <div class="f">
          <input type="search" value={query} placeholder="search wearables..." onInput={this.onInput} />
          <button type="button" class="toggle" onClick={() => this.setState({ open: !open })}>
            {open ? '^' : 'v'}
          </button>
        </div>
        {open && (
          <div class="wearable-selector-grid">
            {loading && <span>loading...</span>}
            {!loading && items.length > 0 && (
              <>
                <h4>{mode === 'owned' ? 'owned' : 'free'}</h4>
                <ul>{grid(items)}</ul>
              </>
            )}
            {!loading && items.length === 0 && <span>{mode === 'owned' ? 'no wearables for this slot' : 'no results'}</span>}
          </div>
        )}
      </div>
    )
  }
}
