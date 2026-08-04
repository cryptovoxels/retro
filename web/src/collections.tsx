import { useEffect, useState } from 'preact/hooks'

import Head from './components/head'
import { useListControls } from './components/list-controls'
import { Spinner } from './spinner'
import { fetchOptions } from './utils'
import { Collection } from '../../common/helpers/collections-helpers'
import { truncate } from './lib/string-utils'

const LIMIT = 100

export default function ListCollections({ path }: { path?: string }) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [page] = useState(0)

  const [controls, controlsEl] = useListControls()

  async function doFetch() {
    setLoading(true)
    let url = `/api/collections?page=${page}&limit=${LIMIT}`
    if (controls.query) url += '&q=' + controls.query
    if (controls.sort) url += '&sort=' + controls.sort

    const r = await fetch(url, fetchOptions())
    const data = await r.json()
    setCollections(data.collections || [])
    setLoading(false)
  }

  useEffect(() => {
    doFetch()
  }, [controls.sort, page])
  useEffect(() => {
    if (controls.submitCount > 0) doFetch()
  }, [controls.submitCount])

  const rows = collections.map((c) => (
    <tr key={c.id}>
      <td>{c.total_wearables}</td>
      <td>
        <a href={`/collections/${c.id}`}>{c.name}</a>
      </td>
      <td>
        <small>{truncate(c.description || '', 100)}</small>
      </td>
    </tr>
  ))

  return (
    <section class="columns">
      <article>
        <h1>Collections</h1>

        {controlsEl}

        <table>
          <tbody>{rows}</tbody>
        </table>

        <p>
          <a href="/collections/new">New collection</a>
        </p>
      </article>
    </section>
  )
}
