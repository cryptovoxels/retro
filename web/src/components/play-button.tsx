import { route } from 'preact-router'

// theatre mode: SPA-route to a /play url, no reload, the persistent canvas just resizes
export function PlayButton({ url, label = 'Play' }: { url: string; label?: string }) {
  return (
    <a
      class="buttonish"
      href={url}
      onClick={(e) => {
        e.preventDefault()
        route(url)
      }}
    >
      {label}
    </a>
  )
}
