import { h } from 'preact'
import { useState } from 'preact/hooks'
import { Spinner } from '../spinner'

interface Props {
  src: string
  altsrc: string
  alt?: string
  class?: string
  type?: string
}

// Convert to datauri
const brokenImage =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<!-- old school pixellated netscape broken image icon -->
<svg
  viewBox="-1 -1 17 17"
  version="1.1"
  xmlns="http://www.w3.org/2000/svg"
  >
  <g id="borders-and-backgrounds">
    <path d="M0,0 L10,0 L10,1 L1,1 L1,15 L2,15 L2,16 L0,16 Z" fill="black"></path>
    <path d="M10,4 l4,0 l0,3 l-1,0 l0,-2 l-3,0 Z" fill="black"></path>
    <path d="M14,16 l0,-6 l-1,0 l0,5 l-5,0 l0,1 Z" fill="black"></path>
    <path d="M12,14 l0,-3 l-1,0 l0,2 l-2,0 l0,1 Z" fill="#bcbcc3"></path>
    <path d="M10,0 l1,0 l0,1 l1,0 l0,1 l1,0 l0,1 l1,0 l0,1 l-1,0 l0,-1 l-1,0 l0,-1 l-1,0 l0,2 l-1,0 Z" fill="#878787"></path>
    <path d="M2,2 l8,0 l0,3 l2,0 l0,2 l-4,0 l0,5 l-2,0 l0,1 l-2,0 l0,1 l-2,0 Z" fill="#bcbcc3"></path>
  </g>
  <g id="lefteye">
    <path d="M5,3 l2,0 l0,3 l-3,0 l0,-2 l1,0 l0,1 l1,0 l0,-1 l-1,0 Z" fill="#00891e"></path>
    <path d="M5,4 l1,0 l0,1 l-1,0 Z" fill="#00f248" ></path>
    <path d="M7,4 l1,0 l0,2 l-1,0 l0,1 l-2,0 l0,-1 l2,0 Z" fill="black" ></path>
  </g>
  <g id="righteye">
    <path d="M8,7 l3,0 l0,2 l-1,0 l0,-1 l-1,0 l0,1 l1,0 l0,1 l-2,0 Z" fill="#0064fb"></path>
      <path d="M9,8 l1,0 l0,1 l-1,0 Z" fill="#00fbfe"></path>
    <path d="M10,9 l1,0 l0,1 l-1,0 Z" fill="#003293"></path>
    <path d="M11,7 l1,0 l0,2 l-1,0 Z" fill="black"></path>
    <path d="M8,10 l2,0 l0,1 l-2,0 Z" fill="black"></path>
  </g>
  <g id="mouth">
    <path d="M3,8 l1,0 l0,1 l1,0 l0,1 l1,0 l0,1 l1,0 l0,1 l-1,0 l0,-1 l-1,0 l0,-1 l-1,0 l0,-1 l-1,0 Z" fill="#ff3900"></path>
    <path d="M3,9 l1,0 l0,1 l1,0 l0,1 l1,0 l0,1 l-3,0 Z" fill="#f73ae1"></path>
    <path d="M3,12 l3,0 l0,1 l-3,0 Z" fill="black"></path>
  </g>
</svg>
`,
  ).toString('base64')

export default function Image({ type, src, altsrc, alt = '', class: className }: Props) {
  const [fallback, setFallback] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  if (type === 'script') {
    return (
      <div title="Script" class="broken-image">
        script
      </div>
    )
  }

  if (failed) {
    return (
      <div class="broken-image">
        <img src={brokenImage} alt={alt} class={className} />
      </div>
    )
  }

  if (loaded) {
    return <img src={src} alt={alt} class={className} />
  }

  if (fallback) {
    return (
      <div class="loading-image">
        <Spinner size={16} />
        <img onError={() => setFailed(true)} onLoad={() => setLoaded(true)} src={altsrc} alt={alt} class={className} />
      </div>
    )
  }

  return <img src={src} onError={() => setFallback(true)} alt={alt} class={className} />
}
