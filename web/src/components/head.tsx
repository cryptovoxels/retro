import { VNode } from 'preact'
import { ssrFriendlyDocument } from '../../../common/helpers/utils'

type Props = {
  title: string
  description?: string
  url?: string
  imageURL?: string
  /** og:type - article for blog posts */
  type?: 'website' | 'article'
  children?: Element | VNode<Element>
}

function absUrl(url?: string) {
  if (!url) return undefined
  if (url.startsWith('http')) return url
  try {
    const u = new URL(`${process.env.ASSET_PATH}` + `/${url}`)
    return u.toString().replace(/([^:]\/)\/+/g, '$1')
  } catch {
    return undefined
  }
}

function setMeta(attr: 'name' | 'property', key: string, value?: string) {
  if (!value || !ssrFriendlyDocument?.head) return
  let el = ssrFriendlyDocument.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null
  if (!el) {
    el = ssrFriendlyDocument.createElement('meta')
    el.setAttribute(attr, key)
    ssrFriendlyDocument.head.appendChild(el)
  }
  el.setAttribute('content', value)
}

function setLinkCanonical(href?: string) {
  if (!href || !ssrFriendlyDocument?.head) return
  let el = ssrFriendlyDocument.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
  if (!el) {
    el = ssrFriendlyDocument.createElement('link')
    el.rel = 'canonical'
    ssrFriendlyDocument.head.appendChild(el)
  }
  el.href = href
}

export default function Head(props: Props) {
  const img = absUrl(props.imageURL) ?? `${process.env.ASSET_PATH}/images/logo-opengraph-small.png`
  const url = absUrl(props.url)
  const title = props.title.slice(0, 120)
  const description = props.description?.slice(0, 300)
  const type = props.type ?? 'website'
  const fullTitle = title ? `${title} | Voxels` : 'Voxels'

  // browser: keep document head in sync (SPA navigations + crawlers that execute JS)
  if (ssrFriendlyDocument) {
    ssrFriendlyDocument.title = fullTitle
    setMeta('property', 'og:type', type)
    setMeta('property', 'og:title', title)
    if (description) {
      setMeta('name', 'description', description)
      setMeta('property', 'og:description', description)
    }
    if (url) {
      setMeta('property', 'og:url', url)
      setLinkCanonical(url)
    }
    if (img) {
      setMeta('property', 'og:image', img)
      setMeta('name', 'twitter:image', img)
    }
    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:title', title)
    if (description) setMeta('name', 'twitter:description', description)
    return null
  }

  // SSR: render a <head> that renderComponent lifts into the real document head
  return (
    <head>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      <meta property="og:type" content={type} />
      {url && <meta property="og:url" content={url} />}
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      {img && <meta property="og:image" content={img} />}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      {description && <meta name="twitter:description" content={description} />}
      {img && <meta name="twitter:image" content={img} />}
      {url && <link rel="canonical" href={url} />}
      {props.children}
    </head>
  )
}
