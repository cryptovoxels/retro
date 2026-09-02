import { useState } from 'preact/hooks'
import { JSX } from 'preact'

export type Controls = { sort: string; view: string; query: string; submitCount: number }

export function qs(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

export function useListControls(initialQuery = ''): [Controls, JSX.Element] {
  const [sort, setSort] = useState('popular')
  const [view, setView] = useState('grid')
  const [query, setQuery] = useState(initialQuery)
  const [submitCount, setSubmitCount] = useState(0)

  const link = (patch: Partial<{ v: string; s: string; q: string }>) => location.pathname + '?' + qs({ v: view, s: sort, q: query, ...patch })

  const el = (
    <div class="list-controls">
      <div>
        <h5>View as</h5>
        {['grid', 'list'].map((v, i) => (
          <>
            {i > 0 && ' | '}
            <a key={v} href={link({ v })} aria-current={v === view ? 'page' : undefined} onClick={() => setView(v)}>
              {v}
            </a>
          </>
        ))}
      </div>
      <div>
        <h5>Sort by</h5>
        {['popular', 'newest', 'oldest'].map((s, i) => (
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
        <button type="submit">Search</button>
      </form>
    </div>
  )

  return [{ sort, view, query, submitCount }, el]
}
