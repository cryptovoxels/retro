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
  parcelAddress: string
  orbitCoords: string | null
  featureUuid: string
  href: string
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

function hostLightHref(row: ShowboxRow) {
  return `/golive/broadcast?parcel=${row.parcelId}&show=${row.featureUuid}&host=1&light=1`
}

// same render the token metadata uses; the slab falls back to the parcel initial if it 404s
function mapRenderUrl(row: ShowboxRow) {
  const slug = row.parcelAddress.toLowerCase().replace(/ /g, '-')
  return `https://map.voxels.com/parcel/${row.parcelId}-${slug}.png`
}

// parcel center, same shape the token metadata animation_url uses (e.g. 12E,4N)
function orbitCoordsFromParcel(parcel: any): string | null {
  const { x1, x2, z1, z2, y1 } = parcel ?? {}
  if (![x1, x2, z1, z2].every((n: any) => typeof n === 'number')) return null
  const x = Math.round((x1 + x2) / 2)
  const z = Math.round((z1 + z2) / 2)
  const e = x < 0 ? `${Math.abs(x)}W` : `${x}E`
  const n = z < 0 ? `${Math.abs(z)}S` : `${z}N`
  const u = typeof y1 === 'number' && y1 > 0 ? `${y1}U` : ''
  return [e, n, u].filter(Boolean).join(',')
}

// the opensea preview: the actual parcel in 3d, slowly orbiting. boots the whole engine,
// so it only loads on tap and only one card runs it at a time.
function orbitEmbedUrl(coords: string) {
  return `/play?coords=${encodeURIComponent(coords)}&embedded=true&mode=orbit&isolate=true`
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

function goLiveIntro() {
  return (
    <p>
      Your parcel shows up here once it has a showbox on it. Place one in the{' '}
      <a href="/account/parcels">parcel editor</a>, then come back here to go live.
    </p>
  )
}

export default function GoLive() {
  if (!app.signedIn) {
    return (
      <section>
        <h1>Go live</h1>
        <p>Sign in to start streaming. Use the wallet that owns your parcel or can edit it — you need a showbox on that land.</p>
        <Login hideHeading />
      </section>
    )
  }

  const wallet = app.wallet
  const [rows, setRows] = useState<ShowboxRow[] | null>(null)
  const [parcelCount, setParcelCount] = useState(0)
  const [error, setError] = useState('')
  // which stage is running the live 3d orbit embed - one at a time, it boots the whole engine
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!wallet) return
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
        const byId = new Map<number, SimpleParcelRecord>()
        for (const p of [...owned, ...collab]) {
          if (p?.id != null && !byId.has(p.id)) byId.set(p.id, p)
        }
        const list = [...byId.values()].slice(0, MAX_PARCELS)
        const found: ShowboxRow[] = []

        await Promise.all(
          list.map(async (p) => {
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
                parcelAddress: String(parcel.address ?? '').trim(),
                orbitCoords: orbitCoordsFromParcel(parcel),
                featureUuid: box.uuid,
                href: hostPlayHref(parcel, box),
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
        if (!dead) setError('could not load your parcels')
      }
    }

    run()
    return () => {
      dead = true
    }
  }, [wallet])

  useEffect(() => {
    if (rows?.length === 1) window.location.href = hostGoLiveHref(rows[0])
  }, [rows])

  if (rows === null) {
    return (
      <section>
        <h1>Go live</h1>
        {goLiveIntro()}
        <Spinner size={24} />
      </section>
    )
  }

  if (rows.length === 1) {
    return (
      <section>
        <h1>Go live</h1>
        {goLiveIntro()}
        <Spinner size={24} />
      </section>
    )
  }

  return (
    <section>
      <h1>Go live</h1>
      {goLiveIntro()}
      <p>Go live in your parcel. Light is the mobile-friendly way to go live. Tap a parcel to see it in 3d.</p>
      {error && <p>{error}</p>}
      {rows.length === 0 && !error && (
        <p>
          {parcelCount > 0
            ? `Checked ${parcelCount} parcel${parcelCount === 1 ? '' : 's'} - no showbox found yet. Put a showbox on your parcel and it shows up here.`
            : 'No parcels on this account. Sign in with the wallet that owns or collaborates on the land.'}
        </p>
      )}
      <div class="golive-parcels">
        {rows.map((row) => {
          const key = `${row.parcelId}-${row.featureUuid}`
          const img = mapRenderUrl(row)
          const initial = (row.parcelLabel[0] || '?').toLowerCase()
          const hideOnError = (e: Event) => ((e.currentTarget as HTMLImageElement).style.display = 'none')
          const previewing = preview === key && !!row.orbitCoords
          return (
            <div class="golive-parcel" key={key}>
              <div class="golive-orbit" title={row.orbitCoords ? 'see it in 3d' : undefined} onClick={() => row.orbitCoords && setPreview(previewing ? null : key)}>
                {previewing ? (
                  <iframe class="golive-embed" src={orbitEmbedUrl(row.orbitCoords!)} title={row.parcelLabel} />
                ) : (
                  <>
                    <div class="golive-tilt">
                      <div class="golive-slab">
                        <div class="golive-face golive-front">
                          <span class="golive-initial">{initial}</span>
                          <img src={img} alt="" loading="lazy" onError={hideOnError} />
                        </div>
                        <div class="golive-face golive-back">
                          <span class="golive-initial">{initial}</span>
                          <img src={img} alt="" loading="lazy" onError={hideOnError} />
                        </div>
                        <div class="golive-face golive-edge-l"></div>
                        <div class="golive-face golive-edge-r"></div>
                        <div class="golive-face golive-edge-t"></div>
                        <div class="golive-face golive-edge-b"></div>
                      </div>
                    </div>
                    <div class="golive-shadow"></div>
                  </>
                )}
              </div>
              <div class="golive-name">{row.parcelLabel}</div>
              <div class="golive-meta">
                {previewing && (
                  <a
                    onClick={(e) => {
                      e.preventDefault()
                      setPreview(null)
                    }}
                    href="#"
                  >
                    close 3d
                  </a>
                )}
              </div>
              <div class="golive-actions">
                <a href={hostGoLiveHref(row)}>go live</a>
                <span class="golive-sep">|</span>
                <a href={hostLightHref(row)}>light</a>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
