import { format, TDate } from 'timeago.js'
import { avatarName } from '../../../common/messages/avatar-ref'

export interface Womp {
  id: number
  parcel_id: number | undefined
  space_id: string | undefined
  parcel_name: string
  space_name: string
  parcel_address: string
  content: string
  author: any // AvatarRef
  coords: string
  created_at: string
  updated_at: string
  image_url: string

  // supplied by client
  nearby_count?: number
}

interface CardProps {
  womp: Womp
  className?: string
  nearbyCount?: number
  hoverText?: string
  openInSameWindow?: boolean
  onClick?: (womp: Womp) => boolean | void
  onAvatarClick?: (coords: string) => boolean | void
}

// 12 hours -> 12h
export const timeFormat = (t: TDate) => format(t).replace(/ ([a-z])[a-z]+/, '$1')

export function WompCard(props: CardProps) {
  const nearbyCount = props.nearbyCount ?? props.womp.nearby_count
  const rich = /\b-medium\b/.test(props.className || '')

  const onClick = (e: Event) => {
    if (!props.onClick) {
      return
    }
    props.onClick.bind(props, props.womp)()
    e.preventDefault()
  }

  const location = props.womp.parcel_id ? (props.womp.parcel_name ?? props.womp.parcel_address) : (props.womp.space_name ?? 'The Void')
  const author = avatarName(props.womp.author) || 'anon'
  const when = props.womp.created_at ? timeFormat(props.womp.created_at) : ''
  const caption = props.womp.content ? (props.womp.content.length > 80 ? props.womp.content.slice(0, 76) + '...' : props.womp.content) : ''

  return (
    <div class={`womp ${props.className || ''}`.trim()} title={props.hoverText}>
      <a onClick={onClick} href={`/womps/${props.womp.id}`}>
        <img loading="lazy" src={props.womp.image_url} alt={props.womp.content || location} />
        {rich ? (
          <div class="womp-meta">
            <p class="womp-where" title={location}>
              {location}
            </p>
            <p class="womp-who">
              {author}
              {when ? ` · ${when}` : ''}
              {nearbyCount ? ` · ${nearbyCount} nearby` : ''}
            </p>
            {caption ? <p class="womp-caption">{caption}</p> : null}
          </div>
        ) : (
          <p title={location}>{location}</p>
        )}
      </a>
    </div>
  )
}
