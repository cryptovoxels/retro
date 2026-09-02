import { useEffect, useMemo, useState } from 'preact/hooks'
import ParcelHelper from '../../../common/helpers/parcel-helper'
import { ParcelWithMintednessRecord } from '../../../common/messages/parcel'
import cachedFetch from '../helpers/cached-fetch'
import { mintParcel } from '../helpers/mint-parcel'
import { Fee, listOnOpensea } from '../helpers/list-opensea'
import { app } from '../state'

const TEAM = '0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2'
const CLASSIFIEDS_URL = '/api/classifieds.json'

type Listing = { id: number; price: number; permalink: string }
type Config = { floor: number; volume30d: number; suggested: number; fees: Fee[] }

type Props = {
  parcel: ParcelWithMintednessRecord
  isOwner: boolean
}

export function ParcelShop({ parcel, isOwner }: Props) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const helper = useMemo(() => new ParcelHelper(parcel), [parcel])
  const admin = app.isAdmin()
  const teamOwned = helper.isOwner(TEAM)
  const minted = parcel.minted

  useEffect(() => {
    cachedFetch(CLASSIFIEDS_URL)
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return
        const seen = new Set<number>()
        const items: Listing[] = []
        for (const i of [...(d.fresh || []), ...(d.secondary || [])]) {
          if (seen.has(i.id)) continue
          seen.add(i.id)
          items.push(i)
        }
        setListing(items.find((i) => i.id === parcel.id) || null)
      })
      .catch(() => {})
  }, [parcel.id])

  useEffect(() => {
    if (!admin || !minted || !teamOwned) return
    cachedFetch('/api/admin/opensea/stats')
      .then((r) => r.json())
      .then((d) => d.success && setConfig(d))
      .catch(() => {})
  }, [admin, minted, teamOwned])

  const suggested = config?.suggested || 0
  const show = listing || (admin && !minted) || (admin && minted && teamOwned) || (isOwner && minted && !listing && !(admin && teamOwned))

  if (!show) return null

  async function mint() {
    setBusy(true)
    setMsg('')
    try {
      await mintParcel(parcel)
      await fetch(`/api/parcels/${parcel.id}/query`)
      window.location.reload()
    } catch (e: any) {
      setMsg(e?.shortMessage || e?.toString() || 'mint failed')
      setBusy(false)
    }
  }

  async function list() {
    const value = price || String(suggested || '')
    if (!value || Number(value) <= 0) {
      setMsg('set a price')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      await listOnOpensea(parcel.id, value, config?.fees || [])
      setMsg('listed!')
    } catch (e: any) {
      setMsg(e?.shortMessage || e?.toString() || 'failed')
    } finally {
      setBusy(false)
    }
  }

  const fmt = (n: number) => parseFloat(n.toFixed(3))

  return (
    <div style={{ marginTop: '1rem' }}>
      <h3>shop</h3>
      {listing ? (
        <>
          <p>{fmt(listing.price)} eth</p>
          <a href={listing.permalink} target="_blank" rel="noopener noreferrer">
            view on opensea
          </a>
        </>
      ) : null}
      {admin && !minted ? (
        <button disabled={busy} onClick={mint}>
          {busy ? 'minting...' : 'mint'}
        </button>
      ) : null}
      {admin && minted && teamOwned && !listing ? (
        <div class="f">
          <input type="number" step="0.001" min="0" placeholder={String(suggested)} value={price} onInput={(e: any) => setPrice(e.currentTarget.value)} />
          <button disabled={busy} onClick={list}>
            {busy ? 'listing...' : 'list on opensea'}
          </button>
        </div>
      ) : null}
      {isOwner && minted && !listing && !(admin && teamOwned) ? (
        <a href={helper.openseaUrl} target="_blank" rel="noopener noreferrer">
          sell on opensea
        </a>
      ) : null}
      {msg ? <small>{msg}</small> : null}
    </div>
  )
}
