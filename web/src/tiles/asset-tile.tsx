import { route } from 'preact-router'
import { LibraryAsset_Type } from '../../../src/library-asset'

export function bucketUrl(id: string) {
  return `https://ugc.voxels.com/renders/asset-${id}.png`
}

export function renderUrl(id: string) {
  return `https://render.voxels.com/assets/${id}`
}

export function AssetTile({ asset, onClick }: { asset: LibraryAsset_Type; onClick?: (asset: LibraryAsset_Type) => void }) {
  const href = `/assets/${asset.id}`

  const handle = (e: Event) => {
    e.preventDefault()
    if (onClick) return onClick(asset)
    route(href)
  }

  return (
    <div class="tile asset-tile">
      <a href={href} onClick={handle}>
        <div class="thumb">
          <img loading="lazy" src={bucketUrl(asset.id!)} />
        </div>
        <p title={asset.name}>{asset.name}</p>
      </a>
    </div>
  )
}
