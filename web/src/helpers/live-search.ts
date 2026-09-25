import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { debounce } from 'lodash'
import { route } from 'preact-router'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TinyCache = require('tinycache')
const searchCache = new TinyCache()
const SEARCH_TTL_MS = 60_000

export type LiveSearchLoadResult<T, M = unknown> = T[] | { items: T[]; meta?: M }

export type LiveSearchOptions<T, M = unknown> = {
  query: string
  submitCount: number
  /** Extra deps that should trigger a refetch (sort, page, wallet, …). */
  deps: unknown[]
  cacheKey: string
  match: (item: T, q: string) => boolean
  load: (signal: AbortSignal) => Promise<LiveSearchLoadResult<T, M>>
  /** Base path for debounced `?q=` sync. Pass null to skip. */
  path: string | null
  initial?: T[]
}

function normalize<T, M>(r: LiveSearchLoadResult<T, M>): { items: T[]; meta?: M } {
  if (Array.isArray(r)) return { items: r }
  return r
}

export function useLiveSearch<T, M = unknown>(opts: LiveSearchOptions<T, M>) {
  const [rows, setRows] = useState<T[]>(opts.initial ?? [])
  const [meta, setMeta] = useState<M | undefined>(undefined)
  const [loading, setLoading] = useState(!opts.initial?.length)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(false)

  const optsRef = useRef(opts)
  optsRef.current = opts
  const rowsLen = useRef(rows.length)
  rowsLen.current = rows.length

  const items = useMemo(() => rows.filter((r) => opts.match(r, opts.query)), [rows, opts.query, opts.match])

  const doFetch = useRef(async (force = false) => {
    const { cacheKey, load } = optsRef.current

    if (!force) {
      const hit = searchCache.get(cacheKey) as { items: T[]; meta?: M } | undefined
      if (hit) {
        setRows(hit.items)
        setMeta(hit.meta)
        setLoading(false)
        return
      }
    }

    if (controller.current) {
      controller.current.abort('ABORT:Refetching')
      controller.current = null
    }
    controller.current = new AbortController()
    if (rowsLen.current === 0) setLoading(true)

    try {
      const result = normalize(await load(controller.current.signal))
      controller.current = null
      searchCache.put(cacheKey, result, SEARCH_TTL_MS)
      setRows(result.items)
      setMeta(result.meta)
      setLoading(false)
    } catch (err: any) {
      if (err?.name === 'AbortError' || String(err).includes('ABORT')) return
      setLoading(false)
    }
  }).current

  const debouncedFetch = useRef(debounce(() => void doFetch(false), 300, { leading: false, trailing: true })).current
  const debouncedRoute = useRef(
    debounce(
      (q: string) => {
        const path = optsRef.current.path
        if (path == null) return
        const next = q ? `${path}?q=${encodeURIComponent(q)}` : path
        if (location.pathname + location.search !== next) route(next)
      },
      300,
      { leading: false, trailing: true },
    ),
  ).current

  async function refetch() {
    searchCache.del(optsRef.current.cacheKey)
    await doFetch(true)
  }

  function clearCache() {
    searchCache.clear()
  }

  // query + caller deps
  const depKey = JSON.stringify(opts.deps)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      void doFetch(false)
    } else {
      debouncedFetch()
    }
    return () => {
      controller.current?.abort('ABORT:Unmounting')
    }
  }, [opts.query, opts.cacheKey, depKey])

  useEffect(() => {
    if (opts.submitCount > 0) {
      debouncedFetch.flush()
      void doFetch(true)
    }
  }, [opts.submitCount])

  useEffect(() => {
    debouncedRoute(opts.query)
  }, [opts.query])

  useEffect(() => {
    return () => {
      debouncedFetch.cancel()
      debouncedRoute.cancel()
    }
  }, [])

  return { items, rows, loading, meta, refetch, clearCache }
}
