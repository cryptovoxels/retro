import { useEffect, useState } from 'preact/hooks'
import { route } from 'preact-router'
import Head from './components/head'
import cachedFetch, { invalidateUrl } from './helpers/cached-fetch'
import { app, AppEvent } from './state'
import { fetchOptions } from './utils'

type Post = { slug: string; title: string; body: string; author: string; created_at: string; replies?: number }

export default function Blog(_props: { path?: string }) {
  const [posts, setPosts] = useState<Post[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)

  const load = () => {
    cachedFetch('/api/posts.json')
      .then((r) => r.json())
      .then((d) => setPosts(d.posts || []))
      .catch(() => setPosts([]))
  }

  useEffect(() => {
    load()
    const rerender = () => tick((n) => n + 1)
    app.on(AppEvent.Login, rerender)
    app.on(AppEvent.Logout, rerender)
    return () => {
      app.off(AppEvent.Login, rerender)
      app.off(AppEvent.Logout, rerender)
    }
  }, [])

  const publish = async () => {
    if (!title.trim() || !body.trim() || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/posts', fetchOptions(undefined, JSON.stringify({ title, body }))).then((x) => x.json())
      if (r.success) {
        setTitle('')
        setBody('')
        await invalidateUrl('/api/posts.json', true)
        route(`/blog/${r.slug}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <Head title="blog" url="/blog" />
      <h1>blog</h1>

      {app.isAdmin() && (
        <form>
          <div class="f">
            <label>title</label>
            <input type="text" autoFocus value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
          </div>
          <div class="f">
            <label>body</label>
            <textarea value={body} rows={8} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
          </div>

          <div class="f">
            <button type="button" disabled={busy} onClick={publish}>
              post
            </button>
          </div>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>title</th>
            <th>replies</th>
            <th>date</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.slug}>
              <td>
                <a href={`/blog/${p.slug}`}>{p.title}</a>
              </td>
              <td>{p.replies ?? 0}</td>
              <td>{new Date(p.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
