import { useEffect, useRef, useState } from 'preact/hooks'

import { route } from 'preact-router'
import { ssrFriendlyWindow } from '../../common/helpers/utils'
import Scope from '../../common/scope'
import { LibraryAsset_Type } from '../../src/library-asset'
import Image from './components/image'
import { InplaceEdit } from './components/inplace-edit'
import { useListControls } from './components/list-controls'
import PaginationLinks from './components/pagination-links'
import { invalidateUrl } from './helpers/cached-fetch'
import { Spinner } from './spinner'
import { app } from './state'
import { assetCache } from './store/index'
import { fetchOptions } from './utils'

interface Props {
  assets?: LibraryAsset_Type[]
  path?: string
  page?: any
  wallet?: string
  q?: string
}

export function bucketUrl(id: string) {
  return `https://ugc.voxels.com/renders/asset-${id}.png`
}

export function renderUrl(id: string) {
  return `https://render.voxels.com/assets/${id}`
}

export default function Library(props: Props) {
  const page = (props.page && parseInt(props.page, 10)) || 1
  const [assets, setAssets] = useState<LibraryAsset_Type[]>(props.assets || [])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const queryParams = ssrFriendlyWindow ? new URLSearchParams(document.location.search.substring(1)) : undefined

  const [controls, controlsEl] = useListControls(props.q)

  async function doFetch() {
    if (controller.current) {
      controller.current.abort('ABORT:Refetching')
      controller.current = null
    }
    controller.current = new AbortController()

    const scope = new Scope('/api/assets')
    scope.query = controls.query
    scope.page = page
    // todo: map sort values (popular/newest/oldest) to assets API params
    scope.sort = controls.sort
    scope.reverse = false
    scope.nonce = editing
    if (props.wallet) scope.author = props.wallet

    const r = await fetch(scope.toString(), fetchOptions(controller.current)).then((r) => r.json())
    if (!r) {
      setLoading(false)
      return
    }

    const data = (r.assets || []) as LibraryAsset_Type[]
    controller.current = null
    setAssets(data)
    setLoading(false)
    data.forEach((a) => assetCache.put(`/assets/${a.id}`, a))
  }

  async function refetch() {
    setEditing(true)
    assetCache.clear()
    invalidateUrl('/api/assets/*')
    await doFetch()
  }

  useEffect(() => {
    doFetch()
    return () => {
      controller.current?.abort('ABORT:Unmounting')
    }
  }, [controls.sort, controls.view, props.q])

  useEffect(() => {
    if (controls.submitCount > 0) route(`/assets?q=${encodeURIComponent(controls.query)}`)
  }, [controls.submitCount])

  const canEdit = (asset: LibraryAsset_Type) => app.isAdmin() || asset.author === app.state.wallet

  const onRename = (asset: LibraryAsset_Type) => async (name: string) => {
    await fetch(`/api/assets/${asset.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
      headers: { 'Content-Type': 'application/json', credentials: 'include' },
    })
    await refetch()
  }

  const list =
    controls.view === 'list'
      ? assets.map((asset) => (
          <tr class="asset">
            <td>
              <input type="checkbox" />
            </td>
            <td>
              <Image type={asset.type} src={bucketUrl(asset.id!)} altsrc={renderUrl(asset.id!)} />
            </td>
            <td>
              <InplaceEdit value={asset.name} onChange={onRename(asset)}>
                <a href={`/assets/${asset.id}`}>{asset.name}</a>
              </InplaceEdit>
            </td>
            <td>{canEdit(asset) && <a href={`/assets/${asset.id}/edit`}>Edit</a>}</td>
          </tr>
        ))
      : assets.map((asset) => (
          <div class="asset" onClick={() => route(`/assets/${asset.id}`)}>
            <Image src={bucketUrl(asset.id!)} altsrc={renderUrl(asset.id!)} />
            <p>{asset.name}</p>
          </div>
        ))

  return (
    <section class="columns">
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
        <a href="/assets/new">Upload asset</a>
      </aside>
    </section>
  )
}
