import { route } from 'preact-router'
import { naviportHere } from '../helpers/coords-nav'

// Visit the linked destination and enter theatre mode.
export function PlayButton({ url, label = 'Play' }: { url: string; label?: string }) {
  return (
    <a
      class="buttonish"
      href={url}
      onClick={(e) => {
        e.preventDefault()
        if (new URL(url, location.origin).searchParams.get('coords')) void naviportHere(url)
        route(url)
      }}
    >
      {label}
    </a>
  )
}
