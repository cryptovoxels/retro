import { Link } from 'preact-router/match'

import ParcelHelper from '../../common/helpers/parcel-helper'
import { ssrFriendlyWindow } from '../../common/helpers/utils'
import { SimpleParcelRecord } from '../../common/messages/parcel'
import { useListControls } from './components/list-controls'
import PaginationLinks from './components/pagination-links'
import cachedFetch from './helpers/cached-fetch'
import { useLiveSearch } from './helpers/live-search'
import parse from './helpers/parse'
import { Spinner } from './spinner'
import { parcelCache } from './store/index'
import { ParcelTile } from './tiles/parcel-tile'
import { fetchOptions } from './utils'

const limit = 50 // limit on server is 50 so can't go any higher than that..

const PARCEL_SORTS = ['id', 'island', 'name'] as const

type TableRowProps = {
  record: SimpleParcelRecord
  helper: ParcelHelper
  selected?: boolean
}

const TableRow = (props: TableRowProps) => {
  const href = '/parcels/' + props.record.id

  const link = (text: string) => (
    <Link activeClassName="active" href={href}>
      {text}
    </Link>
  )

  return (
    <tr class={props.selected ? '-selected' : ''}>
      <td>{props.record.id}</td>
      <td>
        {props.record.name ? (
          <>
            {link(props.record.name)}
            <br />
            <small>{props.helper.address}</small>
          </>
        ) : (
          <>
            {link(props.record.address ?? '')}
            <br />
            <small>{props.record.island}</small>
          </>
        )}
      </td>
    </tr>
  )
}

function matchesParcel(p: SimpleParcelRecord, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return !!p.name?.toLowerCase().includes(needle) || !!p.address?.toLowerCase().includes(needle) || !!p.island?.toLowerCase().includes(needle) || String(p.id).includes(needle)
}

const matchAll = () => true

export interface Props {
  parcels?: any
  path?: string
  page?: any
  q?: string
}

export default function Parcels(props: Props) {
  const page = (props.page && parseInt(props.page, 10)) || 1
  const queryParams = ssrFriendlyWindow ? new URLSearchParams(document.location.search.substring(1)) : undefined
  const owner = queryParams && parse.ethaddress(queryParams.get('owner'))
  const initialQuery = owner || props.q || queryParams?.get('q') || ''

  const [controls, controlsEl] = useListControls(initialQuery, {
    sorts: [...PARCEL_SORTS],
    views: ['list', 'grid'],
    initialSort: 'id',
    initialView: 'grid',
  })

  const q = owner || controls.query || ''

  const { items, loading, meta } = useLiveSearch<SimpleParcelRecord, number>({
    query: controls.query,
    submitCount: controls.submitCount,
    deps: [controls.sort, page, owner],
    cacheKey: `parcels|${q}|${page}|${controls.sort}|${owner || ''}`,
    match: owner ? matchAll : matchesParcel,
    load: async (signal) => {
      const searchParams = new URLSearchParams({
        sort: controls.sort,
        asc: 'true',
        page: (page - 1).toString(),
        limit: limit.toString(),
        q,
      })
      const ac = new AbortController()
      signal.addEventListener('abort', () => ac.abort())
      const r = await cachedFetch(`/api/parcels/search.json?${searchParams}`, fetchOptions(ac))
      const body = await r.json()
      const next = (body.parcels || []) as SimpleParcelRecord[]
      const total = next.length > 0 ? (next[0] as any).pagination_count : 0
      next.forEach((p) => parcelCache.put(`/parcels/${p.id}`, p))
      return { items: next, meta: total as number }
    },
    path: owner ? null : '/parcels',
    initial: props.parcels,
  })

  const description = owner ? `owned by ${owner}` : null

  let view
  if (!loading && items.length === 0) {
    view = <div>No parcels found</div>
  } else if (controls.view === 'grid') {
    view = (
      <div class="wrap-grid">
        {items.map((p) => (
          <ParcelTile key={p.id} parcel={p} />
        ))}
      </div>
    )
  } else {
    view = (
      <table class="parcels-table">
        <tr>
          <th>#</th>
          <th>Address</th>
        </tr>
        {items.map((p) => (
          <TableRow key={p.id} record={p} helper={new ParcelHelper(p)} selected={false} />
        ))}
      </table>
    )
  }

  return (
    <section>
      <h1>parcels</h1>

      {controlsEl}

      <article>{loading ? <Spinner size={18} /> : view}</article>

      <PaginationLinks path="/parcels" total={meta} page={page} limit={limit} description={description} queryParams={queryParams} />
    </section>
  )
}
