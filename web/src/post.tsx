import { useEffect, useState } from 'preact/hooks'
import { micromark } from 'micromark'
import Head from './components/head'
import { postExcerpt, postShareUrl, tweetIntentUrl } from './helpers/blog-share'
import cachedFetch, { invalidateUrl } from './helpers/cached-fetch'
import { app, AppEvent } from './state'
import { fetchOptions } from './utils'

type Author = { name?: string; owner?: string } | string
type Comment = { id: number; body: string; created_at: string; author: Author }
export type BlogPost = { slug: string; title: string; body: string; author: Author; created_at: string }

function authorLabel(author: Author) {
  if (author && typeof author === 'object') return author.name || short(author.owner)
  const s = String(author ?? '')
  if (s === 'voxels') return 'voxels'
  return short(s)
}

function short(w?: string) {
  return w ? `${w.slice(0, 6)}...${w.slice(-4)}` : 'someone'
}

function authorWallet(author: Author) {
  if (author && typeof author === 'object') return (author.owner ?? '').toLowerCase()
  return String(author ?? '').toLowerCase()
}

export default function PostPage(props: {
  path?: string
  slug?: string
  onBack?: () => void
  // SSR / fastboot
  post?: BlogPost | null
  comments?: Comment[]
}) {
  const slug = props.slug ?? props.post?.slug ?? ''
  const [post, setPost] = useState<BlogPost | null>(props.post ?? null)
  const [comments, setComments] = useState<Comment[]>(props.comments ?? [])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(!props.post && !!slug)
  const [copied, setCopied] = useState(false)
  const [, tick] = useState(0)

  const load = () => {
    if (!slug) return
    setLoading(true)
    cachedFetch(`/api/posts/${slug}.json`, fetchOptions(undefined, undefined, true))
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) {
          setPost(null)
          return
        }
        setPost(d.post)
        setComments(d.comments || [])
      })
      .catch(() => setPost(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    // SSR already gave us the post; still refresh comments in the background when empty
    if (!props.post) load()
    const rerender = () => tick((n) => n + 1)
    app.on(AppEvent.Login, rerender)
    app.on(AppEvent.Logout, rerender)
    return () => {
      app.off(AppEvent.Login, rerender)
      app.off(AppEvent.Logout, rerender)
    }
  }, [slug])

  const submit = async () => {
    if (!text.trim() || busy || !slug) return
    setBusy(true)
    try {
      const r = await fetch(`/api/posts/${slug}/comments`, fetchOptions(undefined, JSON.stringify({ body: text }))).then((x) => x.json())
      if (r.success) {
        setText('')
        await invalidateUrl(`/api/posts/${slug}.json`, true)
        load()
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    await fetch(`/api/comments/${id}/remove`, fetchOptions(undefined, JSON.stringify({})))
    await invalidateUrl(`/api/posts/${slug}.json`, true)
    load()
  }

  const shareUrl = slug ? postShareUrl(slug) : ''

  const copyLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: select-friendly prompt
      window.prompt('Copy link', shareUrl)
    }
  }

  const back = props.onBack && (
    <p>
      <a
        href="/blog"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          props.onBack!()
        }}
      >
        &lsaquo; back
      </a>
    </p>
  )

  // sidebar embed: skip the full-page prose column so it fits the home aside
  const wrap = props.onBack ? 'sidebar-post' : 'prose'

  if (loading) {
    return (
      <section class={wrap}>
        {back}
        <p>loading...</p>
      </section>
    )
  }

  if (!post) {
    return (
      <section class={wrap}>
        <Head title="blog" />
        <p>not found</p>
        {back}
      </section>
    )
  }

  const html = micromark(post.body)
  const me = (app.state.wallet ?? '').toLowerCase()
  const excerpt = postExcerpt(post.body)
  const tweetUrl = tweetIntentUrl(post.title, shareUrl)

  return (
    <section class={wrap}>
      {!props.onBack && <Head title={post.title} description={excerpt} url={`/blog/${post.slug}`} type="article" />}
      {back || (
        <p>
          <a href="/blog">blog</a>
        </p>
      )}
      <h1>{post.title}</h1>
      <p>
        {authorLabel(post.author)} · {new Date(post.created_at).toLocaleDateString()}
      </p>
      {!props.onBack && (
        <p class="post-share">
          <button type="button" onClick={copyLink}>
            {copied ? 'Copied' : 'Copy link'}
          </button>{' '}
          <a href={tweetUrl} target="_blank" rel="noopener noreferrer">
            Share on X
          </a>
        </p>
      )}
      <div dangerouslySetInnerHTML={{ __html: html }} />

      <h3>comments</h3>
      <ul>
        {comments.map((c) => (
          <li key={c.id}>
            <strong>{authorLabel(c.author)}</strong> · {new Date(c.created_at).toLocaleDateString()}
            <div>{c.body}</div>
            {(authorWallet(c.author) === me || app.isAdmin()) && (
              <button type="button" onClick={() => remove(c.id)}>
                remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {app.signedIn ? (
        <div>
          <h3>add comment</h3>
          <textarea value={text} rows={3} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          <br />
          <button type="button" disabled={busy} onClick={submit}>
            comment
          </button>
        </div>
      ) : (
        <p>
          <a href="/login">sign in</a> to comment
        </p>
      )}
    </section>
  )
}
