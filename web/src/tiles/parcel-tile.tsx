import { route } from 'preact-router'
import { SimpleParcelRecord } from '../../../common/messages/parcel'

export function parcelThumbUrl(id: number | string) {
  return `https://www.voxels.com/api/parcels/${id}.png`
}

export function ParcelTile({ parcel, onClick }: { parcel: SimpleParcelRecord; onClick?: (parcel: SimpleParcelRecord) => void }) {
  const href = `/parcels/${parcel.id}`
  const label = parcel.name || parcel.address || `#${parcel.id}`

  const handle = (e: Event) => {
    e.preventDefault()
    if (onClick) return onClick(parcel)
    route(href)
  }

  return (
    <div class="tile parcel-tile">
      <a href={href} onClick={handle}>
        <div class="thumb">
          <img loading="lazy" src={parcelThumbUrl(parcel.id)} />
        </div>
        <p title={label}>{label}</p>
        {parcel.island && <small>{parcel.island}</small>}
      </a>
    </div>
  )
}
