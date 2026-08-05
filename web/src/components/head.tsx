import { VNode } from 'preact'
import { ssrFriendlyDocument } from '../../../common/helpers/utils'

type Props = {
  title: string
  description?: string
  url?: string
  imageURL?: string
  children?: Element | VNode<Element>
}

export default function Head(props: Props) {
  // we only render the head component for the server that will yank this out and put in the correct place
  if (ssrFriendlyDocument) {
    ssrFriendlyDocument.title = props.title ? `${props.title} | Voxels` : 'Voxels'
    return null
  }

  const img = props.imageURL ?? `${process.env.ASSET_PATH}/images/logo-opengraph-small.png`
  let url = props.url

  if (url && !url.startsWith('http')) {
    try {
      const u = new URL(`${process.env.ASSET_PATH}` + `/${url}`)
      url = u.toString()
    } catch (e: unknown) { }
  }
  // remove double forward slashes
  url = url?.replace(/([^:]\/)\/+/g, '$1')

  const title = props.title.slice(0, 120)
  const description = props.description?.slice(0, 300)
  return (
    <head>
      <title>{title ? `${title} | Voxels` : 'Voxels'}</title>
      {description && <meta name="description" content={description} />}
      <meta property="og:type" content="website" />
      {url && <meta property="og:url" content={url} />}
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      {img && <meta property="og:image" content={img} />}
      {props.children}
    </head>
  )
}
