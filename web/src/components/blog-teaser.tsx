import { useEffect, useState } from 'preact/hooks'
import { format } from 'timeago.js'
import cachedFetch from '../helpers/cached-fetch'
import { app, AppEvent } from '../state'

type Post = { slug: string; title: string; created_at: string; replies?: number }

export default function BlogTeaser() {
  const [posts, setPosts] = useState<Post[]>([])
  const [, tick] = useState(0)

  useEffect(() => {
    cachedFetch('/api/posts.json')
      .then((r) => r.json())
      .then((d) => setPosts(d.posts || []))
      .catch(() => setPosts([]))
    const rerender = () => tick((n) => n + 1)
    app.on(AppEvent.Login, rerender)
    app.on(AppEvent.Logout, rerender)
    return () => {
      app.off(AppEvent.Login, rerender)
      app.off(AppEvent.Logout, rerender)
    }
  }, [])

  const ago = (date: string) => format(date).replace(/ ([a-z]).+/, '$1')

  return (
    <>
      <h3>Blog</h3>
      {posts.length ? (
        <table>
          <tbody>
            {posts.map((p) => (
              <tr key={p.slug}>
                <td>
                  <a href={`/blog/${p.slug}`}>{p.title}</a>
                </td>
                <td>{p.replies ?? 0}</td>
                <td>{ago(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>nothing yet</p>
      )}
    </>
  )
}
