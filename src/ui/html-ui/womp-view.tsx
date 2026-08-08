import { render } from 'preact'
import { unmountComponentAtNode } from 'preact/compat'
import { openDialog } from '../../../common/helpers/ui-helpers'
import { HTMLUi } from './html-ui'
import { NftMediaBox } from './nft-view'

export type WompLite = {
  id: number
  image_url?: string
  image_supplied?: boolean
}

function wompSrc(w: WompLite): string {
  if (w.image_url) return w.image_url
  const api = process.env.API || '/api'
  return `${api}/womps/${w.id}.jpg`
}

let node: HTMLElement | null = null

/** Same fastview + blur path as NFT inspect. */
export default function showWompView(womp: WompLite) {
  if (!womp?.id) return

  if (node) {
    unmountComponentAtNode(node)
    node = null
  }

  const { el, close } = openDialog('pointer-lock-close nft-view', true)
  node = el

  const onClose = () => {
    node = null
    close()
    HTMLUi.close()
  }

  const src = wompSrc(womp)

  render(
    <>
      <button class="close" onClick={onClose}>
        &times;
      </button>
      <NftMediaBox dialogEl={el} aspect={1} onDismiss={onClose}>
        {(setAr) => (
          <a href={`/womps/${womp.id}`} target="_blank" rel="noopener">
            <img
              src={src}
              alt="womp"
              onLoad={(e) => {
                const t = e.currentTarget
                if (t.naturalWidth && t.naturalHeight) setAr(t.naturalWidth / t.naturalHeight)
              }}
            />
          </a>
        )}
      </NftMediaBox>
    </>,
    el,
  )
}
