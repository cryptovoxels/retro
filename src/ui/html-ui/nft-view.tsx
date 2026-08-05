import { ComponentChildren, render } from 'preact'
import { ProxyAssetOpensea } from '../../../common/messages/api-opensea'
import { mediaSize, openDialog } from '../../../common/helpers/ui-helpers'
import OpenseaAssetHelper from '../gui/opensea-asset-helper'
import { HTMLUi } from './html-ui'
import { unmountComponentAtNode } from 'preact/compat'
import type NftImage from '../../features/nft-image'
import { useEffect, useRef, useState } from 'preact/hooks'
import { truncate } from '../../../web/src/lib/string-utils'

async function textureToDataUrl(tex: BABYLON.BaseTexture): Promise<string | null> {
  try {
    const size = tex.getSize()
    const w = size.width
    const h = size.height
    if (!w || !h) return null

    const pixels = await tex.readPixels()
    if (!pixels) return null

    const src = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength)
    const dst = new Uint8ClampedArray(w * h * 4)
    // WebGL readPixels is bottom-up; ImageData is top-down
    for (let y = 0; y < h; y++) {
      dst.set(src.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4)
    }

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.putImageData(new ImageData(dst, w, h), 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function aspectFromFeature(feature: { scale: { x: number; y: number }; mesh?: BABYLON.AbstractMesh | null }) {
  const mat = feature.mesh?.material as BABYLON.StandardMaterial | undefined
  const tex = mat?.diffuseTexture
  if (tex) {
    const s = tex.getSize()
    if (s.width && s.height) return s.width / s.height
  }
  const sx = feature.scale?.x || 1
  const sy = feature.scale?.y || 1
  return sx / sy || 1
}

export function NftMediaBox({ dialogEl, aspect, onDismiss, children }: { dialogEl: HTMLElement; aspect: number; onDismiss?: () => void; children: ComponentChildren | ((setAr: (ar: number) => void) => ComponentChildren) }) {
  const [zoom, setZoom] = useState(1)
  const [ar, setAr] = useState(aspect || 1)
  const zoomRef = useRef(1)
  zoomRef.current = zoom

  useEffect(() => {
    setAr(aspect || 1)
  }, [aspect])

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!dialogEl.classList.contains('fastview')) return
      const next = zoomRef.current - e.deltaY * 0.001
      if (next < 0.5) {
        onDismiss?.()
        return
      }
      setZoom(Math.min(2.5, next))
    }
    document.addEventListener('wheel', onWheel, { capture: true })
    return () => document.removeEventListener('wheel', onWheel, { capture: true })
  }, [dialogEl, onDismiss])

  useEffect(() => {
    const { w, h } = mediaSize(ar, zoom)
    dialogEl.style.width = `${w}px`
    dialogEl.style.height = `${h}px`
  }, [ar, zoom, dialogEl])

  return <div class="nft-media">{typeof children === 'function' ? children(setAr) : children}</div>
}

type Props = {
  feature: NftImage
  asset: ProxyAssetOpensea
  onClose: () => void
  dialogEl: HTMLElement
}

type NFTType = 'video' | 'image' | 'audio'

export function NftView({ asset, onClose, feature, dialogEl }: Props) {
  const [type, setType] = useState<NFTType>('image')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const assetHelper = new OpenseaAssetHelper(asset)
  const aspect = aspectFromFeature(feature)

  const imageURL = () => {
    const url = assetHelper.getBiggerImage(1024)
    return url.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + url.split('/').splice(0, 2).join('/') : url
  }

  useEffect(() => {
    const mat = feature.mesh?.material as BABYLON.StandardMaterial | undefined
    const tex = mat?.diffuseTexture
    if (!tex) return
    let cancelled = false
    textureToDataUrl(tex).then((url) => {
      if (!cancelled && url) setPreview(url)
    })
    return () => {
      cancelled = true
    }
  }, [feature])

  useEffect(() => {
    if (assetHelper.isAnimated) {
      assetHelper.getTypeOfContent().then(setType)
    }
  }, [asset.animation_url])

  useEffect(() => {
    setReady(false)
  }, [type])

  const markReady = () => setReady(true)
  // hide real media only while we have a texture preview covering it
  const mediaStyle = !ready && preview ? { display: 'none' as const } : undefined

  const onMediaDims = (setAr: (ar: number) => void) => (e: Event) => {
    const t = e.currentTarget as HTMLImageElement | HTMLVideoElement
    const w = 'naturalWidth' in t ? t.naturalWidth : t.videoWidth
    const h = 'naturalHeight' in t ? t.naturalHeight : t.videoHeight
    if (w && h) setAr(w / h)
    markReady()
  }

  const content = (setAr: (ar: number) => void) => {
    if (error) {
      return <img src={`${process.env.ASSET_PATH}/images/error-could_not_fetch_nft.png`} alt={error} />
    }

    const previewImg = preview && !ready ? <img src={preview} alt={assetHelper.getName} /> : null
    const onLoad = onMediaDims(setAr)

    switch (type) {
      case 'audio':
        return (
          <>
            {previewImg}
            <img src={imageURL()} alt={assetHelper.getName} style={mediaStyle} onLoad={onLoad} onError={markReady} />
            <audio controls autoPlay loop src={asset.animation_url!} />
          </>
        )
      case 'video':
        return (
          <>
            {previewImg}
            <video src={asset.animation_url!} controls autoPlay loop playsInline style={mediaStyle} onLoadedMetadata={onLoad} onError={markReady} />
          </>
        )
      default:
        return (
          <>
            {previewImg}
            <a href={asset.permalink} target="_blank" style={mediaStyle}>
              <img src={imageURL()} alt={assetHelper.getName} onLoad={onLoad} onError={markReady} />
            </a>
          </>
        )
    }
  }

  const contract = asset.asset_contract
  const ownerCount = asset.top_ownerships?.length || 0
  const tags = [contract?.name, contract?.schema_name, contract?.chain, asset.token_id ? `token #${asset.token_id}` : null, ownerCount ? `${ownerCount} owners` : null].filter(Boolean) as string[]

  return (
    <>
      <button class="close" onClick={onClose}>
        &times;
      </button>
      <header class="nft-header">
        <h1>{assetHelper.getName}</h1>
        {contract?.name && (
          <p>
            <a href={asset.permalink} target="_blank">
              {contract?.name}
            </a>
          </p>
        )}
        {tags.length > 0 ? (
          <ul class="nft-tags">
            {tags.map((t) => (
              <li key={t}>{truncate(t, 10)}</li>
            ))}
          </ul>
        ) : null}
      </header>

      <div class="center">
        <NftMediaBox dialogEl={dialogEl} aspect={aspect} onDismiss={onClose}>
          {content}
        </NftMediaBox>
      </div>
      <p class="nft-description">{assetHelper.description}</p>
    </>
  )
}

let node: any = null

export default function showNftView(feature: NftImage) {
  const asset = feature.asset
  if (!asset) {
    return
  }

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

  render(<NftView feature={feature} asset={asset} onClose={onClose} dialogEl={el} />, el)
}
