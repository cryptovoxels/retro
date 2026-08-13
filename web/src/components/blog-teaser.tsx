import { useEffect, useState } from 'preact/hooks'
import { format } from 'timeago.js'
import cachedFetch from '../helpers/cached-fetch'
import Icon from './icons/icons'
import { app, AppEvent } from '../state'

type Post = { slug: string; title: string; created_at: string; replies?: number }

export default function BlogTeaser({ onOpen }: { onOpen?: (slug: string) => void }) {
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
      <h3>Updates</h3>
      {posts.length ? (
        <table>
          <tbody>
            {posts.slice(0, 7).map((p) => (
              <tr key={p.slug}>
                <td>
                  {onOpen ? (
                    <a
                      href={`/blog/${p.slug}`}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onOpen(p.slug)
                      }}
                    >
                      {p.title}
                    </a>
                  ) : (
                    <a href={`/blog/${p.slug}`}>{p.title}</a>
                  )}
                </td>
                <td title={p.replies ? `${p.replies} ${p.replies === 1 ? 'reply' : 'replies'}` : undefined}>
                  {p.replies ? (
                    <>
                      {p.replies} <Icon name="chat" size={10} />
                    </>
                  ) : (
                    ''
                  )}
                </td>
                <td>{ago(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>nothing yet</p>
      )}
      {posts.length > 0 && (
        <p>
          <a href="/blog">View the blog</a>
        </p>
      )}
    </>
  )
}
