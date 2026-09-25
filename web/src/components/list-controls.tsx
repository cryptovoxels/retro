import { useState } from 'preact/hooks'
import { JSX } from 'preact'
import { ssrFriendlyWindow } from '../../../common/helpers/utils'

export type Controls = { sort: string; view: string; query: string; submitCount: number }

export type ListControlsOptions = {
  sorts?: string[]
  views?: string[]
  initialSort?: string
  initialView?: string
}

export function qs(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

export function useListControls(initialQuery = '', opts: ListControlsOptions = {}): [Controls, JSX.Element] {
  const sorts = opts.sorts ?? ['popular', 'newest', 'oldest']
  const views = opts.views ?? ['grid', 'list']
  const [sort, setSort] = useState(opts.initialSort ?? sorts[0])
  const [view, setView] = useState(opts.initialView ?? views[0])
  const [query, setQuery] = useState(initialQuery)
  const [submitCount, setSubmitCount] = useState(0)

  if (!ssrFriendlyWindow) {
    var link = (patch: Partial<{ v: string; s: string; q: string }>) => '#'
  } else {
    var link = (patch: Partial<{ v: string; s: string; q: string }>) => location.pathname + '?' + qs({ v: view, s: sort, q: query, ...patch })
  }

  const el = (
    <div class="list-controls">
      {views.length > 0 && (
        <div>
          <small>view</small>
          {views.map((v, i) => (
            <>
              {i > 0 && ' | '}
              <a key={v} href={link({ v })} aria-current={v === view ? 'page' : undefined} onClick={() => setView(v)}>
                {v}
              </a>
            </>
          ))}
        </div>
      )}
      <div>
        <small>sort</small>
        {sorts.map((s, i) => (
          <>
            {i > 0 && ' | '}
            <a key={s} href={link({ s })} aria-current={s === sort ? 'page' : undefined} onClick={() => setSort(s)}>
              {s}
            </a>
          </>
        ))}
      </div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitCount((n) => n + 1)
        }}
      >
        <input type="search" value={query} onInput={(e: any) => setQuery(e.target.value)} placeholder="Search" />
      </form>
    </div>
  )

  return [{ sort, view, query, submitCount }, el]
}
