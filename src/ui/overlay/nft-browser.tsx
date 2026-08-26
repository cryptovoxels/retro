import { useEffect, useState } from 'preact/hooks'
import cachedFetch, { invalidateUrl } from '../../../web/src/helpers/cached-fetch'
import { imageUrlViaProxy } from '../../utils/helpers'
import { requestPointerLock } from '../../../common/helpers/ui-helpers'
import type { OpenSeaNFTV2Extended } from '../../../common/messages/api-opensea'
import { truncate } from '../../../web/src/lib/string-utils'

const URL = `${process.env.API}/externals/opensea/nfts.json`

export function NftBrowser() {
  const [nfts, setNfts] = useState<OpenSeaNFTV2Extended[]>([])
  const [loading, setLoading] = useState(true)

  const load = async (reload = false) => {
    setLoading(true)
    if (reload) invalidateUrl(URL)
    const r = await cachedFetch(URL, { credentials: 'include' }, 300)
      .then((x) => x.json())
      .catch(() => null)
    setNfts(r?.success ? r.nfts : [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const place = (nft: OpenSeaNFTV2Extended) => {
    const ui = window.ui!
    ui.featureTool.setModeAdd({ type: 'nft-image', blendMode: 'Multiply', scale: [1.5, 1.5, 0], url: nft.permalink })
    ui.setTool(ui.featureTool)
    requestPointerLock()
  }

  const drag = (nft: OpenSeaNFTV2Extended) => (e: DragEvent) => {
    e.dataTransfer?.setData('text/plain', JSON.stringify({ type: 'nft-image', content: { url: nft.permalink } }))
  }

  return (
    <div class="nft-browser">
      <button onClick={() => load(true)}>refresh</button>
      <div class="nft-grid wrap-grid">
        {loading
          ? 'loading...'
          : nfts.length === 0
            ? 'no nfts found'
            : nfts
                .filter((n) => n.image_url)
                .map((nft) => (
                  <div>
                    <img key={nft.permalink} draggable onDragStart={drag(nft)} onClick={() => place(nft)} src={imageUrlViaProxy(nft.image_url!, 96)} title={nft.name} alt={nft.name} />
                    <span>{truncate(nft.name, 50)}</span>
                    <cite>{truncate(nft.collection, 50)}</cite>
                  </div>
                ))}
      </div>
    </div>
  )
}
