import { useEffect, useState } from 'preact/hooks'
import cachedFetch from '../helpers/cached-fetch'
import { app, AppEvent } from '../state'

type Post = { slug: string; title: string; body: string; created_at: string }

function firstParagraph(body: string) {
  const lines = body.split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    return t.replace(/^[-*>\s]+/, '').slice(0, 200)
  }
  return ''
}

export default function BlogTeaser() {
  const [post, setPost] = useState<Post | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    cachedFetch('/api/posts.json')
      .then((r) => r.json())
      .then((d) => setPost(d.posts?.[0] ?? null))
      .catch(() => setPost(null))
    const rerender = () => tick((n) => n + 1)
    app.on(AppEvent.Login, rerender)
    app.on(AppEvent.Logout, rerender)
    return () => {
      app.off(AppEvent.Login, rerender)
      app.off(AppEvent.Logout, rerender)
    }
  }, [])

  const blurb = post ? firstParagraph(post.body) : ''

  return (
    <>
      <h3>News</h3>
      {post ? (
        <>
          <p>
            <a href={`/blog/${post.slug}`}>{post.title}</a>
          </p>
          {blurb && <p>{blurb}</p>}
        </>
      ) : (
        <p>nothing yet</p>
      )}
      <p>
        <a href="/blog">more</a>
        {app.isAdmin() && (
          <>
            {' · '}
            <a href="/blog">write a post</a>
          </>
        )}
      </p>
    </>
  )
}
