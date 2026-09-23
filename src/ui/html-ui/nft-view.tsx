import { ComponentChildren, render } from 'preact'
import { ProxyAssetOpensea } from '../../../common/messages/api-opensea'
import { openDialog } from '../../../common/helpers/ui-helpers'
import OpenseaAssetHelper from '../gui/opensea-asset-helper'
import { HTMLUi } from './html-ui'
import type NftImage from '../../features/nft-image'
import { useEffect, useRef, useState } from 'preact/hooks'
import { track } from '../../../web/src/helpers/umami'

// accumulated scroll-down (px) in fastview before the dialog is dismissed
const WHEEL_DISMISS = 400

/**
 * Media area shared by the nft / collectible / womp dialogs. Sizing is CSS-driven: the figure gets an
 * `--ar` custom property (from `setAr`) and the stylesheet turns that into a box that hugs the media.
 * In fastview, scrolling down dismisses.
 */
export function NftMediaBox({ dialogEl, aspect, onDismiss, children }: { dialogEl: HTMLElement; aspect: number; onDismiss?: () => void; children: ComponentChildren | ((setAr: (ar: number) => void) => ComponentChildren) }) {
  const [ar, setAr] = useState(aspect || 1)
  const acc = useRef(0)

  useEffect(() => {
    setAr(aspect || 1)
  }, [aspect])

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!dialogEl.classList.contains('fastview')) return
      acc.current = Math.max(0, acc.current + e.deltaY)
      if (acc.current > WHEEL_DISMISS) {
        acc.current = 0
        onDismiss?.()
      }
    }
    document.addEventListener('wheel', onWheel, { capture: true })
    return () => document.removeEventListener('wheel', onWheel, { capture: true })
  }, [dialogEl, onDismiss])

  return (
    <figure class="nft-media" style={{ '--ar': String(ar > 0 ? ar : 1) }}>
      {typeof children === 'function' ? children(setAr) : children}
    </figure>
  )
}

/** onLoad / onLoadedMetadata handler that feeds the media's natural aspect into the box */
export const mediaAspect = (setAr: (ar: number) => void) => (e: Event) => {
  const t = e.currentTarget as HTMLImageElement | HTMLVideoElement
  const w = 'naturalWidth' in t ? t.naturalWidth : t.videoWidth
  const h = 'naturalHeight' in t ? t.naturalHeight : t.videoHeight
  if (w && h) setAr(w / h)
}

type Props = {
  feature: NftImage
  asset: ProxyAssetOpensea
  onClose: () => void
  dialogEl: HTMLElement
}

type NFTType = 'video' | 'image' | 'audio'

function ipfsToHttp(url: string) {
  return url.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + url.split('/').splice(0, 2).join('/') : url
}

// ERC1155 ids are 70+ digits; keep chips readable
function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id
}

export function NftView({ asset, onClose, feature, dialogEl }: Props) {
  const [type, setType] = useState<NFTType>('image')
  const assetHelper = new OpenseaAssetHelper(asset)

  // in-world plane ratio is the best guess until the media reports its own
  const aspect = (feature.scale?.x || 1) / (feature.scale?.y || 1) || 1
  const imageURL = ipfsToHttp(assetHelper.getBiggerImage(1024))

  useEffect(() => {
    if (assetHelper.isAnimated) {
      assetHelper.getTypeOfContent().then(setType)
    }
  }, [asset.animation_url])

  const media = (setAr: (ar: number) => void) => {
    const onLoad = mediaAspect(setAr)
    switch (type) {
      case 'audio':
        return (
          <>
            <img src={imageURL} alt={assetHelper.getName} onLoad={onLoad} />
            <audio controls autoPlay loop src={asset.animation_url!} />
          </>
        )
      case 'video':
        return <video src={asset.animation_url!} controls autoPlay loop playsInline onLoadedMetadata={onLoad} />
      default:
        return <img src={imageURL} alt={assetHelper.getName} onLoad={onLoad} />
    }
  }

  const contract = asset.asset_contract
  const ownerCount = asset.top_ownerships?.length || 0
  const supply = (contract as any)?.total_supply
  const minted = (contract as any)?.created_date
  const tags = [
    contract?.schema_name,
    contract?.chain,
    supply ? `${supply} mints` : null,
    minted ? String(minted).slice(0, 10) : null,
    asset.token_id ? `#${shortId(String(asset.token_id))}` : null,
    ownerCount ? `${ownerCount} owners` : null,
  ].filter(Boolean) as string[]

  return (
    <>
      <button class="close" onClick={onClose} aria-label="Close">
        &times;
      </button>
      <NftMediaBox dialogEl={dialogEl} aspect={aspect} onDismiss={onClose}>
        {media}
      </NftMediaBox>
      <div class="nft-meta">
        <h1>{assetHelper.getName}</h1>
        <div class="nft-collection-row">
          {contract?.name && <span class="nft-collection">{contract.name}</span>}
          {asset.permalink && (
            <a class="nft-open" href={asset.permalink} target="_blank" rel="noopener">
              View on OpenSea
            </a>
          )}
        </div>
        {tags.length > 0 && (
          <ul class="nft-tags">
            {tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
        {assetHelper.description && <p class="nft-description">{assetHelper.description}</p>}
      </div>
    </>
  )
}

let node: any = null

export default function showNftView(feature: NftImage) {
  const asset = feature.asset
  if (!asset) {
    return
  }

  track('view_nft')

  if (node) {
    render(null, node)
    node = null
  }

  const { el, close } = openDialog('pointer-lock-close nft-view', true)
  node = el

  const onClose = () => {
    node = null
    close()
    HTMLUi.close()
  }

  render(<NftView feature={feature} asset={asset} onClose={onClose} dialogEl={el} />, el)
}
