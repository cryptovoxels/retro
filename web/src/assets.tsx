import { useState } from 'preact/hooks'

import { ssrFriendlyWindow } from '../../common/helpers/utils'
import Scope from '../../common/scope'
import { LibraryAsset_Type } from '../../src/library-asset'
import { InplaceEdit } from './components/inplace-edit'
import { useListControls } from './components/list-controls'
import PaginationLinks from './components/pagination-links'
import { invalidateUrl } from './helpers/cached-fetch'
import { useLiveSearch } from './helpers/live-search'
import { Spinner } from './spinner'
import { app } from './state'
import { assetCache } from './store/index'
import { AssetTile, bucketUrl, renderUrl } from './tiles/asset-tile'
import { fetchOptions } from './utils'

export { bucketUrl, renderUrl }

interface Props {
  assets?: LibraryAsset_Type[]
  path?: string
  page?: any
  wallet?: string
  q?: string
}

function matchesAsset(asset: LibraryAsset_Type, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return !!asset.name?.toLowerCase().includes(needle) || !!asset.description?.toLowerCase().includes(needle)
}

export default function Library(props: Props) {
  const page = (props.page && parseInt(props.page, 10)) || 1
  const [editing, setEditing] = useState(false)
  const queryParams = ssrFriendlyWindow ? new URLSearchParams(document.location.search.substring(1)) : undefined

  const [controls, controlsEl] = useListControls(props.q)

  const { items, loading, refetch, clearCache } = useLiveSearch<LibraryAsset_Type>({
    query: controls.query,
    submitCount: controls.submitCount,
    deps: [controls.sort, page, props.wallet, editing],
    cacheKey: `assets|${controls.query}|${page}|${controls.sort}|${props.wallet || ''}`,
    match: matchesAsset,
    load: async (signal) => {
      const scope = new Scope('/api/assets')
      scope.query = controls.query
      scope.page = page
      // todo: map sort values (popular/newest/oldest) to assets API params
      scope.sort = controls.sort
      scope.reverse = false
      scope.nonce = editing
      if (props.wallet) scope.author = props.wallet

      const ac = new AbortController()
      signal.addEventListener('abort', () => ac.abort())
      const r = await fetch(scope.toString(), fetchOptions(ac)).then((r) => r.json())
      const data = (r?.assets || []) as LibraryAsset_Type[]
      data.forEach((a) => assetCache.put(`/assets/${a.id}`, a))
      return data
    },
    path: '/assets',
    initial: props.assets,
  })

  async function onRefetch() {
    setEditing(true)
    assetCache.clear()
    clearCache()
    invalidateUrl('/api/assets/*')
    await refetch()
  }

  const canEdit = (asset: LibraryAsset_Type) => app.isAdmin() || asset.author === app.state.wallet

  const onRename = (asset: LibraryAsset_Type) => async (name: string) => {
    await fetch(`/api/assets/${asset.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
      headers: { 'Content-Type': 'application/json', credentials: 'include' },
    })
    await onRefetch()
  }

  const list =
    controls.view === 'list'
      ? items.map((asset) => (
          <tr class="asset">
            <td>
              <input type="checkbox" />
            </td>
            <td>
              <img src={bucketUrl(asset.id!)} />
            </td>
            <td>
              <InplaceEdit value={asset.name} onChange={onRename(asset)}>
                <a href={`/assets/${asset.id}`}>{asset.name}</a>
              </InplaceEdit>
            </td>
            <td>{canEdit(asset) && <a href={`/assets/${asset.id}/edit`}>Edit</a>}</td>
          </tr>
        ))
      : items.map((asset) => <AssetTile key={asset.id} asset={asset} />)

  return (
    <section>
      <h1>Assets</h1>

      <article>
        {controlsEl}

        {controls.view === 'list' ? (
          <table class="assets-list">
            {loading ? (
              <tr>
                <td>
                  <Spinner />
                </td>
              </tr>
            ) : (
              list
            )}
          </table>
        ) : (
          <div class="wrap-grid">{loading ? <Spinner /> : list}</div>
        )}
        <PaginationLinks path="/assets" page={page} limit={100} queryParams={queryParams} description="assets" />
      </article>

      <aside>
        <a class="buttonish" href="/assets/new">
          Upload asset
        </a>
      </aside>
    </section>
  )
}
