import { useEffect, useState } from 'preact/hooks'
import { isMobile } from '../../common/helpers/detector'
import ParcelHelper, { showboxHostPlayCoordsFromRecord, showboxHostPlayQuery } from '../../common/helpers/parcel-helper'
import { SimpleParcelRecord } from '../../common/messages/parcel'
import { Login } from '../src/auth/login'
import cachedFetch from '../src/helpers/cached-fetch'
import { Spinner } from '../src/spinner'
import { app } from '../src/state'
import { fetchOptions } from '../src/utils'

type ShowboxRow = {
  parcelId: number
  parcelLabel: string
  featureUuid: string
  href: string
  via: 'yours' | 'collab'
}

const MAX_PARCELS = 40

function hostPlayHref(parcel: SimpleParcelRecord, feature: { uuid: string; position?: number[] | null; rotation?: number[] | null }) {
  const coords = showboxHostPlayCoordsFromRecord(parcel, feature)
  return `/play?${showboxHostPlayQuery(coords, feature.uuid, isMobile())}`
}

function parcelLabel(p: SimpleParcelRecord) {
  const h = new ParcelHelper(p)
  return p.name?.trim() || p.address?.trim() || h.ownerName || `parcel #${p.id}`
}

function showboxesFromParcel(parcel: any): { uuid: string; position?: number[] | null; rotation?: number[] | null }[] {
  const features = parcel?.features
  if (!Array.isArray(features)) return []
  const out: { uuid: string; position?: number[] | null; rotation?: number[] | null }[] = []
  for (const f of features) {
    if (!f || f.type !== 'showbox' || f.angleMode || !f.uuid) continue
    out.push({ uuid: f.uuid, position: f.position, rotation: f.rotation })
  }
  return out
}

export default function GoLive() {
  if (!app.signedIn) return <Login reason="go live" />

  const wallet = app.wallet
  const [rows, setRows] = useState<ShowboxRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!wallet) return
    let dead = false

    const run = async () => {
      setError('')
      setRows(null)
      try {
        const opts = fetchOptions()
        const [ownedR, collabR] = await Promise.all([cachedFetch(`/api/wallet/${wallet}/parcels.json`, opts), cachedFetch(`/api/wallet/${wallet}/contributing-parcels.json`, opts)])
        const owned = ((await ownedR.json()) as any).parcels || []
        const collab = ((await collabR.json()) as any).parcels || []
        const byId = new Map<number, { p: SimpleParcelRecord; via: 'yours' | 'collab' }>()
        for (const p of owned) {
          if (p?.id != null) byId.set(p.id, { p, via: 'yours' })
        }
        for (const p of collab) {
          if (p?.id != null && !byId.has(p.id)) byId.set(p.id, { p, via: 'collab' })
        }
        const list = [...byId.values()].slice(0, MAX_PARCELS)
        const found: ShowboxRow[] = []

        await Promise.all(
          list.map(async ({ p, via }) => {
            try {
              const r = await cachedFetch(`/api/parcels/${p.id}.json`, opts)
              const j = await r.json()
              const parcel = j?.parcel
              if (!parcel) return
              for (const f of showboxesFromParcel(parcel)) {
                found.push({
                  parcelId: p.id,
                  parcelLabel: parcelLabel(parcel),
                  featureUuid: f.uuid,
                  href: hostPlayHref(parcel, f),
                  via,
                })
              }
            } catch {}
          }),
        )

        found.sort((a, b) => a.parcelLabel.localeCompare(b.parcelLabel) || a.parcelId - b.parcelId)
        if (!dead) setRows(found)
      } catch {
        if (!dead) setError('could not load your parcels')
      }
    }

    run()
    return () => {
      dead = true
    }
  }, [wallet])

  if (rows === null) {
    return (
      <section>
        <p>
          <a href="/account">account</a>
        </p>
        <h1>go live</h1>
        <Spinner size={24} />
      </section>
    )
  }

  return (
    <section>
      <p>
        <a href="/account">account</a>
      </p>
      <h1>go live</h1>
      <p>pick a showbox on land you own or collaborate on. opens the world with the broadcast dock.</p>
      {error && <p>{error}</p>}
      {rows.length === 0 && !error && <p>no showboxes found. add a showbox feature on a parcel you can edit, then come back.</p>}
      {rows.length > 0 && (
        <ul>
          {rows.map((row) => (
            <li key={`${row.parcelId}-${row.featureUuid}`}>
              <a href={row.href}>
                {row.parcelLabel}
                {row.via === 'collab' ? ' (collab)' : ''}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
