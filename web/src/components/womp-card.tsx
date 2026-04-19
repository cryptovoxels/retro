import { format, TDate } from 'timeago.js'

export interface Womp {
  id: number
  parcel_id: number | undefined
  space_id: string | undefined
  parcel_name: string
  space_name: string
  parcel_address: string
  author_name: string
  content: string
  author: string
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

  const onClick = (e: Event) => {
    if (!props.onClick) {
      return
    }
    props.onClick.bind(props, props.womp)()
    e.preventDefault()
  }

  const location = props.womp.parcel_id ? (props.womp.parcel_name ?? props.womp.parcel_address) : (props.womp.space_name ?? 'The Void')

  return (
    <div class="womp">
      <a onClick={onClick} href={`/womps/${props.womp.id}`}>
        <img loading="lazy" src={props.womp.image_url} alt={props.womp.content} />
        <p title={location}>{location}</p>
      </a>
    </div>
  )
}

function getAuthorName(womp: Womp) {
  if (typeof womp.author_name === 'string') {
    return womp.author_name
  } else if (typeof womp.author === 'string') {
    return womp.author.slice(0, 10)
  }
}

function stopPropagation(e: MouseEvent) {
  e.stopPropagation()
}
