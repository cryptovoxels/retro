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
