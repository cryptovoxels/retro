import { render } from 'preact'
import { unmountComponentAtNode } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'
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

function WompGallery({ womps, start, dialogEl, onClose }: { womps: WompLite[]; start: number; dialogEl: HTMLElement; onClose: () => void }) {
  const [index, setIndex] = useState(start)
  const womp = womps[index]

  const step = (dir: number) => setIndex((i) => (i + dir + womps.length) % womps.length)

  useEffect(() => {
    if (womps.length < 2) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      e.stopPropagation()
      step(e.key === 'ArrowLeft' ? -1 : 1)
    }
    document.addEventListener('keydown', onKey, { capture: true })
    return () => document.removeEventListener('keydown', onKey, { capture: true })
  }, [womps.length])

  // warm neighbors so arrowing feels instant
  useEffect(() => {
    if (womps.length < 2) return
    new Image().src = wompSrc(womps[(index + 1) % womps.length])
    new Image().src = wompSrc(womps[(index - 1 + womps.length) % womps.length])
  }, [index, womps])

  return (
    <>
      <button class="close" onClick={onClose}>
        &times;
      </button>
      <NftMediaBox dialogEl={dialogEl} aspect={1} onDismiss={onClose}>
        {(setAr) => (
          <>
            <a href={`/womps/${womp.id}`} target="_blank" rel="noopener">
              <img
                key={womp.id}
                src={wompSrc(womp)}
                alt="womp"
                onLoad={(e) => {
                  const t = e.currentTarget
                  if (t.naturalWidth && t.naturalHeight) setAr(t.naturalWidth / t.naturalHeight)
                }}
              />
            </a>
            {womps.length > 1 && (
              <>
                <button class="gallery-nav prev" onClick={() => step(-1)}>
                  &lsaquo;
                </button>
                <button class="gallery-nav next" onClick={() => step(1)}>
                  &rsaquo;
                </button>
                <span class="gallery-count">
                  {index + 1} / {womps.length}
                </span>
              </>
            )}
          </>
        )}
      </NftMediaBox>
    </>
  )
}

let node: HTMLElement | null = null

/** Same fastview + blur path as NFT inspect. Pass a gallery to browse with arrow keys. */
export default function showWompView(womp: WompLite, gallery?: WompLite[]) {
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

  const womps = gallery?.length ? gallery : [womp]
  const start = Math.max(
    0,
    womps.findIndex((w) => w.id === womp.id),
  )

  render(<WompGallery womps={womps} start={start} dialogEl={el} onClose={onClose} />, el)
}
