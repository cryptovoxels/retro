import { debounce } from 'lodash'
import { Component, JSX } from 'preact'
import { isMobile } from '../../common/helpers/detector'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { autoFocusRef } from '../../common/helpers/ui-helpers'
import type { CachedParcelsMessage } from '../../common/messages/api-parcels'
import { SimpleParcelRecord } from '../../common/messages/parcel'
import type { ParcelsSubTab, Tab } from './explorer'

interface SearchBarProps {
  autoFocus?: boolean
  onSelect?: () => void
  onSearch?: (search?: string | null) => void
  scene: BABYLON.Scene
}

type State = {
  query: string
  items: SimpleParcelRecord[] // need to set up api for parcel ratings
  collapsed: boolean
  loading: boolean
}

export abstract class SearchBar<Props extends SearchBarProps = SearchBarProps> extends Component<Props, State> {
  state: State = {
    query: '',
    items: [],
    collapsed: true,
    loading: false,
  }
  throttledSearch = debounce(
    (value) => {
      this.setState({ query: value })
    },
    500,
    { leading: false, trailing: true },
  )
  abstract search: () => void

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (prevState.query !== this.state.query) {
      this.search()
    }
  }

  onKey = (e: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && this.state.query.length > 0) {
      e.stopPropagation()
      this.setState({ collapsed: true })
    } else if (e.key === 'Enter' && this.state.items.length > 0) {
      e.stopPropagation()
      this.select(this.state.items[0])
    }
  }

  select(parcel: SimpleParcelRecord) {
    const h = new ParcelHelper(parcel)
    h.spawnUrl().then((url) => window.persona.teleport(url))
    this.props.onSelect?.()
  }

  render() {
    let results = this.state.items.map((parcel) => (
      <li tabIndex={0} className="result" onKeyDown={this.onKey} onClick={() => this.select(parcel)} title="Teleport to this parcel">
        <p>{parcel.name || parcel.address}</p>
        <p>
          <small>
            {parcel.name ? `${parcel.address}, ` : ''}
            {parcel.suburb || parcel.island}
          </small>
        </p>
      </li>
    ))

    if (!this.state.loading && results.length === 0 && this.state.query?.length > 0) {
      results = [
        <li>
          <small>No results found</small>
        </li>,
      ]
    }

    return (
      <form className="SearchBar" onSubmit={(e) => e.preventDefault()}>
        <input onInput={(e) => this.throttledSearch((e as any).target['value'])} ref={!isMobile() && autoFocusRef(this.props.autoFocus)} onKeyDown={this.onKey} type="search" placeholder="Search" />
        <ul>{results}</ul>
      </form>
    )
  }
}

type ExplorerSearchBarProps = SearchBarProps & {
  currentTab?: Tab
  currentSubTab?: ParcelsSubTab
}

export class ExplorerSearchBar extends SearchBar<ExplorerSearchBarProps> {
  search = async () => {
    const query = String(this.state.query)

    if (query.length === 0) {
      this.setState({ items: [], loading: false })
      return
    }

    this.setState({ loading: true })
    try {
      const res = await fetch(`${process.env.API}/parcels/search.json?q=${encodeURIComponent(query || '')}&limit=10`)
      if (!res.ok) throw res
      const r = (await res.json()) as CachedParcelsMessage
      if (!r.success) console.error(`search failed for query: ${query}`)
      if (query !== this.state.query) return
      const result = r.parcels || []
      this.setState({ items: result, loading: false })
    } catch {
      if (query === this.state.query) this.setState({ loading: false })
    }
  }
}

export class AssetLibrarySearchBar extends SearchBar {
  select(parcel: SimpleParcelRecord) {
    // Asset library search bar doesn't handle parcel selection
    // This method is overridden from the base class
  }

  search = () => {
    const query = String(this.state.query)
    this.setState({ loading: true })

    if (query.length === 0) {
      this.props.onSearch?.(null)
    } else {
      this.props.onSearch?.(query)
    }
  }

  render() {
    return (
      <form className="SearchBar" onSubmit={(e) => e.preventDefault()}>
        <input onInput={(e: any) => this.throttledSearch(e.target['value'])} onKeyDown={this.onKey} onFocus={this.search} type="search" placeholder="Search" />
      </form>
    )
  }
}
