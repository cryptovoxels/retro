import { useEffect, useState } from 'preact/hooks'
import { isMobile } from '../../common/helpers/detector'
import ParcelHelper, { showboxHostPlayCoordsFromRecord, showboxHostPlayQuery } from '../../common/helpers/parcel-helper'
import { SimpleParcelRecord } from '../../common/messages/parcel'
import { Login } from '../src/auth/login'
import cachedFetch from '../src/helpers/cached-fetch'
import { Spinner } from '../src/spinner'
import { app, AppEvent } from '../src/state'
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
  return `/play?${showboxHostPlayQuery(coords, feature.uuid, false)}`
}

function hostGoLiveHref(row: ShowboxRow) {
  if (isMobile()) return `/golive/broadcast?parcel=${row.parcelId}&show=${row.featureUuid}&host=1`
  return row.href
}

function parcelLabel(p: SimpleParcelRecord) {
  const h = new ParcelHelper(p)
  return p.name?.trim() || p.address?.trim() || h.ownerName || `parcel #${p.id}`
}

function normalizeFeatures(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    try {
      return normalizeFeatures(JSON.parse(raw))
    } catch {
      return []
    }
  }
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'object') return Object.values(raw).filter(Boolean)
  return []
}

function parcelFeatureList(parcel: any): any[] {
  if (!parcel) return []
  let raw = parcel.features
  if (!raw && parcel.content) {
    const c = parcel.content
    if (typeof c === 'string') {
      try {
        raw = JSON.parse(c)?.features
      } catch {
        return []
      }
    } else {
      raw = c?.features
    }
  }
  return normalizeFeatures(raw)
}

function showboxFeatureId(f: any): string | null {
  const id = f?.uuid
  return typeof id === 'string' && id ? id : null
}

// first non-angle showbox on the parcel is the primary; the rest are mirrors (see showbox.isMirror).
function primaryShowbox(parcel: any): { uuid: string; position?: number[] | null; rotation?: number[] | null } | null {
  for (const f of parcelFeatureList(parcel)) {
    const uuid = showboxFeatureId(f)
    if (!f || f.type !== 'showbox' || f.angleMode || !uuid) continue
    return { uuid, position: f.position, rotation: f.rotation }
  }
  return null
}

export default function GoLive() {
  const [signedIn, setSignedIn] = useState(app.signedIn)
  const [rows, setRows] = useState<ShowboxRow[] | null>(null)
  const [parcelCount, setParcelCount] = useState(0)
  const [error, setError] = useState('')
  const wallet = app.wallet

  useEffect(() => {
    const sync = () => setSignedIn(app.signedIn)
    app.on(AppEvent.Login, sync)
    app.on(AppEvent.Logout, sync)
    return () => {
      app.removeListener(AppEvent.Login, sync)
      app.removeListener(AppEvent.Logout, sync)
    }
  }, [])

  useEffect(() => {
    if (!signedIn || !wallet) return
    let dead = false

    const run = async () => {
      setError('')
      setRows(null)
      try {
        const opts = fetchOptions()
        const w = wallet.toLowerCase()
        const [ownedR, collabR] = await Promise.all([cachedFetch(`/api/wallet/${w}/parcels.json`, opts), cachedFetch(`/api/wallet/${w}/contributing-parcels.json`, opts)])
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
              const box = primaryShowbox(parcel)
              if (!box) return
              found.push({
                parcelId: p.id,
                parcelLabel: parcelLabel(parcel),
                featureUuid: box.uuid,
                href: hostPlayHref(parcel, box),
                via,
              })
            } catch {}
          }),
        )

        found.sort((a, b) => a.parcelLabel.localeCompare(b.parcelLabel) || a.parcelId - b.parcelId)
        if (!dead) {
          setParcelCount(list.length)
          setRows(found)
        }
      } catch {
        if (!dead) setError('Could not load your parcels.')
      }
    }

    run()
    return () => {
      dead = true
    }
  }, [wallet, signedIn])

  useEffect(() => {
    if (rows?.length === 1) window.location.href = hostGoLiveHref(rows[0])
  }, [rows])

  if (!signedIn) {
    return (
      <section>
        <h1>Go live</h1>
        <p>Sign in so you can go live.</p>
        <Login hideHeading />
      </section>
    )
  }

  if (rows === null) {
    return (
      <section>
        <h1>Go live</h1>
        <p>Your parcels with a Showbox</p>
        <Spinner size={24} />
      </section>
    )
  }

  if (rows.length === 1) {
    return (
      <section>
        <h1>Go live</h1>
        <p>Your parcels with a Showbox</p>
        <Spinner size={24} />
      </section>
    )
  }

  return (
    <section>
      <h1>Go live</h1>
      <p>Your parcels with a Showbox</p>
      {error && <p>{error}</p>}
      {rows.length === 0 && !error && <p>{parcelCount > 0 ? `No Showbox found on your ${parcelCount} parcel${parcelCount === 1 ? '' : 's'}.` : 'No parcels found for this wallet.'}</p>}
      {rows.map((row) => (
        <section key={`${row.parcelId}-${row.featureUuid}`}>
          <h2>
            {row.parcelLabel}
            {row.via === 'collab' ? ' (collab)' : ''}
          </h2>
          <p>
            <a class="buttonish primary" href={hostGoLiveHref(row)}>
              Go live
            </a>
          </p>
        </section>
      ))}
    </section>
  )
}
