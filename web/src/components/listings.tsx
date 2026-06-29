import { useEffect, useState } from 'preact/hooks'

type Props = {
  parcel: number
  name: string
}

export default function Listings({ parcel, name }: Props) {
  const [listing, setListing] = useState<any>(null)

  async function load() {
    try {
      const res = await fetch(`/api/real-estate/listings/${parcel}`)
      if (!res.ok) return
      const data = await res.json()
      if (data.ok) {
        setListing(data.listing)
      }
    } catch {
      return
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (!listing) {
    return <span />
  }

  const url = `https://opensea.io/assets/ethereum/${process.env.CONTRACT_ADDRESS}/${listing.id}`

  return (
    <div class="listing-info">
      <h3>Listing Info</h3>
      <p>{name}</p>

      <p>
        <strong>Price:</strong> {listing.priceEth.toFixed(3)}Ξ Approx ${listing.priceUsd.toFixed(2)}
      </p>

      <p>
        <a href={url} target="_blank" rel="noopener noreferrer">
          More information
        </a>
        <a class="button" href={url} target="_blank" rel="noopener noreferrer">
          Buy
        </a>
      </p>
    </div>
  )
}
