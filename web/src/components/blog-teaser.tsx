import { useEffect, useState } from 'preact/hooks'
import cachedFetch from '../helpers/cached-fetch'

type Post = { slug: string; title: string }

export default function BlogTeaser() {
  const [posts, setPosts] = useState<Post[]>([])

  useEffect(() => {
    cachedFetch('/api/posts.json')
      .then((r) => r.json())
      .then((d) => setPosts((d.posts || []).slice(0, 5)))
      .catch(() => setPosts([]))
  }, [])

  if (!posts.length) return null

  return (
    <>
      <h3>Blog</h3>
      <ul>
        {posts.map((p) => (
          <li key={p.slug}>
            <a href={`/blog/${p.slug}`}>{p.title}</a>
          </li>
        ))}
      </ul>
    </>
  )
}
