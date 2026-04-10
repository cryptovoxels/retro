import { createRef, Fragment, render } from 'preact'
import { ProxyAssetOpensea } from '../../../common/messages/api-opensea'
import { exitPointerLock, requestPointerLockIfNoOverlays } from '../../../common/helpers/ui-helpers'
import OpenseaAssetHelper from '../gui/opensea-asset-helper'
import { HTMLUi } from './html-ui'
import { unmountComponentAtNode } from 'preact/compat'
import type NftImage from '../../features/nft-image'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Spinner } from '../../../web/src/spinner'

function uiClose() {
  const c = document.querySelector('canvas')
  if (c) {
    c.style.opacity = ''
    c.style.filter = ''
  }
  window.ui?.enable()
  requestPointerLockIfNoOverlays()
}

function uiOpen() {
  const c = document.querySelector('canvas')
  if (c) {
    c.style.opacity = '0.5'
    c.style.filter = `
      grayscale(1)
      sepia(1)
      brightness(0.3)
`
  }
  window.ui?.disable()
}

type Props = {
  feature: NftImage
  asset: ProxyAssetOpensea
  onClose: () => void
  className?: string
}

type NFTType = 'video' | 'image' | 'audio'

function guessTypeFromExtension(url: string | undefined | null): NFTType | undefined {
  if (!url) return undefined
  try {
    const ext = new URL(url).pathname.split('.').pop()?.trim()?.toLowerCase() ?? ''
    if (['mp3', 'wav', 'ogg', 'oga'].includes(ext)) return 'audio'
    if (['mp4', 'mv4', 'mov', 'webm'].includes(ext)) return 'video'
  } catch {}
  return undefined
}

type Dimensions = { x: number; y: number }
export function NftImageHTMLUi({ asset, onClose, feature }: Props) {
  const assetHelper = new OpenseaAssetHelper(asset)
  const syncType = assetHelper.isAnimated ? guessTypeFromExtension(asset.animation_url) : undefined
  const [type, setType] = useState<NFTType>(syncType ?? 'image')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const imageURL = () => {
    const url = assetHelper.getBiggerImage(1024)
    return url.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + url.split('/').splice(0, 2).join('/') : url
  }

  const handlePlay = () => {
    const el = videoRef.current || audioRef.current
    if (!el) return
    el.play().catch(() => {})
    setPlaying(true)
  }

  useEffect(() => {
    uiOpen()
    return uiClose
  }, [])

  useEffect(() => {
    addInspectToURL(feature.uuid)
    return removeInspectFromURL
  }, [])

  useEffect(() => {
    if (assetHelper.isAnimated && !syncType) {
      assetHelper.getTypeOfContent().then(setType)
    }
  }, [asset.animation_url])

  const content = () => {
    if (error) {
      return <img src={`${process.env.ASSET_PATH}/images/error-could_not_fetch_nft.png`} alt={error} />
    }

    switch (type) {
      case 'audio':
        return (
          <>
            <img src={imageURL()} alt={assetHelper.getName} onClick={handlePlay} style={!playing ? { cursor: 'pointer' } : undefined} />
            <audio ref={audioRef} controls={playing} loop src={asset.animation_url!} />
          </>
        )
      case 'video':
        return (
          <video
            ref={videoRef}
            src={asset.animation_url!}
            poster={imageURL()}
            controls={playing}
            loop
            playsInline
            preload="metadata"
            onClick={handlePlay}
            style={!playing ? { cursor: 'pointer' } : undefined}
          />
        )
      default:
        return <img src={imageURL()} alt={assetHelper.getName} />
    }
  }

  return (
    <div class="nft-modal">
      <button class="close" onClick={onClose}>
        &times;
      </button>
      <h1>
        <a href={asset.permalink} target="_blank">
          {assetHelper.getName}
        </a>
      </h1>
      <br />

      {content()}
      {(type === 'video' || type === 'audio') && !playing && (
        <button class="iconish play" onClick={handlePlay}>Play</button>
      )}
      <p class="nft-description">{assetHelper.description}</p>
    </div>
  )
}

function addInspectToURL(uuid: string) {
  const queryParams = new URLSearchParams(document.location.search.substring(1))
  queryParams.set('inspect', uuid)
  const url = '/play?' + queryParams.toString().replace('%40', '@').replace(/%2C/g, ',')
  history.replaceState({}, 'Voxels', url)
}

function removeInspectFromURL() {
  const queryParams = new URLSearchParams(document.location.search.substring(1))
  queryParams.delete('inspect')
  const url = '/play?' + queryParams.toString().replace('%40', '@').replace(/%2C/g, ',')
  history.replaceState({}, 'Voxels', url)
}

let node: null | HTMLDivElement = null

export default function showNftImageHTMLUi(feature: NftImage) {
  const asset = feature.asset
  if (!asset) {
    return
  }

  if (node) {
    unmountComponentAtNode(node)
    node = null
  }

  const div = document.createElement('div')
  div.className = 'pointer-lock-close OverlayWindow nft-view'
  document.body.appendChild(div)
  node = div

  const onClose = () => {
    unmountComponentAtNode(div)
    div.remove()
    node = null
    HTMLUi.close()
  }

  render(<NftImageHTMLUi feature={feature} asset={asset} onClose={onClose} />, div)

  exitPointerLock()
}
