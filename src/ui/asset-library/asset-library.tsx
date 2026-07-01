import { Component } from 'preact'
import { Spinner } from '../../../web/src/spinner'
import { app, AppEvent } from '../../../web/src/state'
import { FeatureAssetCategory, FeatureAssetType, LibraryAsset, ScriptAssetCategory } from '../../library-asset'
import { AssetLibrarySearchBar } from '../search-bar'
import { AssetBrowser, NUMBER_PER_PAGE } from './asset-browser'
import { BrowserSortingOptions } from './browser-sorting-options'

enum Tab {
  All = 'all',
  Features = 'features',
  Scripts = 'scripts',
  Mine = 'mine',
}

type Props = {
  onClose?: () => void
  scene: BABYLON.Scene
}

type AssetCategory = FeatureAssetCategory | ScriptAssetCategory

type State = {
  tab: Tab
  signedIn: boolean
  assets: LibraryAsset[]
  privateOnly: boolean
  ascending: boolean
  sort: string
  page: number
  loading: boolean
  category?: AssetCategory
  featureType?: FeatureAssetType
}

type CachedSearchResult = {
  assets: LibraryAsset[]
  total: number
  page: number
  sort?: string
  ascending?: boolean
  category?: AssetCategory
  featureType?: FeatureAssetType
}

export class AssetLibraryBrowser extends Component<Props, State> {
  static currentElement: HTMLElement | null
  static currentTab: Tab | null = Tab.All
  /* Cache the search results and the sort */
  static searchResult: CachedSearchResult = { assets: null!, total: 0, page: 1, featureType: FeatureAssetType.VoxModel }
  query?: string

  constructor() {
    super()

    this.state = {
      tab: Tab.All,
      signedIn: app.signedIn,
      loading: true,
      assets: [], // list of all assets found (search result too)
      privateOnly: false, // state for a privateOnly flag when in the `My own` tab only
      ascending: !!AssetLibraryBrowser.searchResult.ascending, // sort ascending or descending
      page: AssetLibraryBrowser.searchResult.page, // Page of the browser
      sort: AssetLibraryBrowser.searchResult.sort ?? 'created_at',
      category: AssetLibraryBrowser.searchResult.category,
      featureType: AssetLibraryBrowser.searchResult.featureType,
    }
  }

  get currentTab() {
    return this.state.tab
  }

  /**
   * Return an array of the main tabs
   * {name:string,tab:'Tab type'}
   */
  get mainTabs(): Array<{ name: string; tab: Tab }> {
    const tabs = [
      { name: 'All', tab: Tab.All },
      { name: 'Features', tab: Tab.Features },
      { name: 'Scripts', tab: Tab.Scripts },
    ]
    if (this.state.signedIn) {
      tabs.push({ name: `My own`, tab: Tab.Mine })
    }
    return tabs
  }

  onAppChange = () => {
    const { signedIn } = app

    this.setState({ signedIn })
  }

  /**
   * Fetch assets from library
   */
  fetchAssets = (cacheBust = false) => {
    const searchParams = new URLSearchParams({
      q: encodeURIComponent(this.query ?? ''),
      page: `${this.state.page - 1}`,
      limit: `${NUMBER_PER_PAGE}`,
      sort: `${this.state.sort}`,
      asc: `${this.state.ascending}`,
    })

    if (this.state.category) {
      searchParams.set('category', this.state.category)
    }
    if (this.state.featureType) {
      searchParams.set('featureType', this.state.featureType)
    }
    if (this.currentTab == Tab.Mine) {
      // No need to allow the privateOnly flag if we're not on the `Mine` tab.
      searchParams.set('privateOnly', (app.signedIn && this.state.privateOnly).toString())
    }
    if (cacheBust) {
      searchParams.set('cb', Date.now.toString())
    }

    // grab the result count before the actual query.

    let url = `/api/library/all.json`
    if (this.currentTab == Tab.Features) {
      url = `/api/library/features.json`
    } else if (this.currentTab == Tab.Scripts) {
      url = `/api/library/scripts.json`
    } else if (this.currentTab == Tab.Mine) {
      url = `/api/library/all/${app.state.wallet}.json`
    }

    const tasks = [fetch(`/api/library/info.json?${searchParams}`, { credentials: 'include' }).then((r) => r.json()), fetch(`${url}?${searchParams}`, { credentials: 'include' }).then((r) => r.json())]
    this.setState({ loading: true }, () => {
      Promise.all(tasks)
        .then((result) => {
          const countResult = result[0].info
          AssetLibraryBrowser.searchResult.total = countResult.total_all
          if (this.currentTab == Tab.Features) {
            AssetLibraryBrowser.searchResult.total = countResult.total_features
          } else if (this.currentTab == Tab.Scripts) {
            AssetLibraryBrowser.searchResult.total = countResult.total_scripts
          } else if (this.currentTab == Tab.Mine) {
            AssetLibraryBrowser.searchResult.total = countResult.total_authored
          }
          const assetResult = result[1]
          AssetLibraryBrowser.searchResult.assets = assetResult.assets || []
          this.setState({ assets: assetResult.assets || [], loading: false })
        })
        .catch((err) => {
          console.error(err)
          AssetLibraryBrowser.searchResult.assets = []
          this.setState({ assets: [], loading: false })
        })
        .finally(() => {
          this.setState({ loading: false })
        })
    })
  }

  close = () => {
    this.props.onClose?.()
  }

  toggleSort = (field: string) => {
    if (this.state.sort === field) {
      this.setAndSearch({
        ascending: !this.state.ascending,
      })
    } else {
      this.setAndSearch({
        sort: field,
        ascending: false,
      })
    }
  }

  setPage = (page: number) => {
    this.setState({ page })
  }

  onSearch = (searchQuery?: string | null) => {
    if (!searchQuery) return
    this.query = searchQuery
    if (this.state.page == 1) {
      this.fetchAssets()
    } else {
      this.setState({ page: 1 })
      // we fetch Assets after changing page automatically
    }
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    if (AssetLibraryBrowser.searchResult.assets) {
      this.setState({ assets: AssetLibraryBrowser.searchResult.assets, loading: false })
    } else {
      this.fetchAssets()
    }

    AssetLibraryBrowser.currentTab = this.state.tab
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Change, this.onAppChange)
    AssetLibraryBrowser.currentTab = null
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    // If we're switching main tab and the previous main tab was the account tab; set the account sub-tab back to Myparcels.
    AssetLibraryBrowser.currentTab = this.state.tab
    if (prevState.tab !== this.state.tab) {
      this.fetchAssets()
    }

    if (prevState.page !== this.state.page) {
      AssetLibraryBrowser.searchResult.page = this.state.page
      this.fetchAssets()
    }
  }

  setStateAsync(state: Partial<State>): Promise<void> {
    return new Promise((resolve) => {
      this.setState(state, resolve)
    })
  }

  setAndSearch(dict: Partial<State>) {
    this.setStateAsync(dict).then(() => this.fetchAssets())
  }

  render() {
    const categoriesOptions = (this.currentTab == Tab.Scripts ? Object.entries(ScriptAssetCategory) : Object.entries(FeatureAssetCategory)).sort().map(([key, value]) => {
      return (
        <option key={value} value={value}>
          {key}
        </option>
      )
    })

    const typeOptions = Object.entries(FeatureAssetType)
      .sort()
      .map(([key, value]) => {
        return (
          <option key={value} value={value}>
            {key}
          </option>
        )
      })

    return (
      <section class="asset-library">
        <div class="searchBar">
          <AssetLibrarySearchBar onSelect={this.close} onSearch={this.onSearch} scene={this.props.scene} />
        </div>

        <BrowserSortingOptions toggleSort={this.toggleSort} {...this.state}></BrowserSortingOptions>

        <div class="filter-options">
          <a className="categories" title="Sort by Categories">
            <select
              onChange={(e) => {
                this.setAndSearch({
                  category: e.currentTarget.value as AssetCategory,
                })
              }}
            >
              <option value={''}>Categories</option>
              {categoriesOptions}
            </select>
          </a>
          <a className="types" title="Sort by Type">
            <select
              value={this.state.featureType}
              onChange={(e) => {
                this.setAndSearch({
                  featureType: e.currentTarget?.value as FeatureAssetType,
                })
              }}
            >
              <option value={''}>Types</option>
              {typeOptions}
            </select>
          </a>
          {app.signedIn && this.currentTab == Tab.Mine && (
            <a>
              <label>
                <input type="checkbox" checked={this.state.privateOnly} onChange={(e) => this.setAndSearch({ privateOnly: e.currentTarget.checked })} />
                Private only
              </label>
            </a>
          )}
        </div>
        <div class={`assets ${this.currentTab}`}>
          {this.state.loading && <Spinner size={48} class="spinny" />}
          <AssetBrowser total={AssetLibraryBrowser.searchResult.total} {...this.state} page={this.state.page} paginationSetPage={this.setPage} />
        </div>
      </section>
    )
  }
}
