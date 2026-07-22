import { createRef, Fragment, render } from 'preact'
import { ProxyAssetOpensea } from '../../../common/messages/api-opensea'
import { exitPointerLock, requestPointerLockIfNoOverlays } from '../../../common/helpers/ui-helpers'
import OpenseaAssetHelper from '../gui/opensea-asset-helper'
import { HTMLUi } from './html-ui'
import { unmountComponentAtNode } from 'preact/compat'
import type NftImage from '../../features/nft-image'
import { useEffect, useLayoutEffect, useState } from 'preact/hooks'
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

type Dimensions = { x: number; y: number }
export function NftImageHTMLUi({ asset, onClose, feature }: Props) {
  const [type, setType] = useState<NFTType>('image')
  const [error, setError] = useState('')
  const [showDescription, setShowDescription] = useState(false)
  const assetHelper = new OpenseaAssetHelper(asset)

  const imageURL = () => {
    const url = assetHelper.getBiggerImage(1024)
    return url.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + url.split('/').splice(0, 2).join('/') : url
  }

  useEffect(() => {
    uiOpen()
    return uiClose
  }, [])

  useEffect(() => {
    if (assetHelper.isAnimated) {
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
            <img src={imageURL()} alt={assetHelper.getName} />
            <audio controls autoPlay loop src={asset.animation_url!} />
          </>
        )
      case 'video':
        return <video src={asset.animation_url!} controls autoPlay loop playsInline />
      default:
        return <img src={imageURL()} alt={assetHelper.getName} />
    }
  }

  return (
    <>
      <button class="close" onClick={onClose}>
        &times;
      </button>
      <h1>
        <a href={asset.permalink} target="_blank">
          {assetHelper.getName}
        </a>
      </h1>

      <div class="center">{content()}</div>
      <p class="nft-description">{assetHelper.description}</p>
    </>
  )
}

let node: any = null

export default function showNftImageHTMLUi(feature: NftImage) {
  const asset = feature.asset
  if (!asset) {
    return
  }

  if (node) {
    unmountComponentAtNode(node)
    node = null
  }

  const div = document.createElement('dialog')
  div.className = 'pointer-lock-close nft-view'
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
