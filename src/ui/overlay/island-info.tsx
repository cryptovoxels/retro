import { useEffect, useRef, useState } from 'preact/hooks'
import { format } from 'timeago.js'
import { encodeCoords } from '../../../common/helpers/utils'
import type { Event as EventMessage } from '../../../common/messages/event'
import ParcelEvent from '../../../web/src/helpers/event'
import { fetchOptions } from '../../../web/src/utils'
import { EventRow } from '../../components/explorer/events'
import { cameraPosition } from '../../utils/camera'
import { app } from '../../../web/src/state'
import type Grid from '../../grid'
import type Parcel from '../../parcel'
import { SIDEBAR_ORTHO, VoxelsMap } from '../../voxels-map'

// the server resolves a parcel's spawn point: /visit redirects to a /play?coords= url -
// the same lookup the big-map popups use
async function teleportToParcelSpawn(parcelId: number): Promise<boolean> {
  try {
    const r = await fetch(`/parcels/${parcelId}/visit`, { method: 'HEAD' })
    if (r.redirected) {
      window.persona?.teleport(r.url)
      return true
    }
  } catch {}
  return false
}

// in-world babylon map (same as corner minimap / shop) — no leaflet tile server
function IslandMinimap({ scene }: { scene: BABYLON.Scene }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const m = new VoxelsMap(el, { ortho: SIDEBAR_ORTHO, follow: scene, parcels: true })
    void m.load().catch((e) => console.error('island minimap load failed', e))
    return () => m.dispose()
  }, [scene])

  return <canvas class="island-voxels-map" ref={canvas} />
}

// a live showbox stream on the island, from the same redis entries that feed the homepage strip
type LiveShow = {
  room: string
  coord?: string
  viewers?: number
  thumbnail?: string
  parcel?: { id?: number; name?: string; address?: string }
}

// shown in the info pane when you're not standing on a parcel (in the void / between parcels):
// where you are on the island, what's live nearby, and parcels you can jump to.
export default function IslandInfoTab(props: { scene: BABYLON.Scene }) {
  const grid = window.grid as Grid | undefined
  const [, tick] = useState(0)
  const [events, setEvents] = useState<EventMessage[]>([])
  const [liveShows, setLiveShows] = useState<LiveShow[]>([])

  // you're moving through the void; refresh coords while the pane is up
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1500)
    return () => clearInterval(t)
  }, [])

  const island = grid?.currentIsland || ''

  // live events, kept to the parcels loaded around you
  useEffect(() => {
    let live = true
    fetch(`${process.env.API}/events/on.json?live=true`, fetchOptions())
      .then((r) => r.json())
      .then((r) => live && r.events && setEvents(r.events))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [island])

  // live showbox streams anywhere on this island (island-wide, unlike the loaded-parcel events)
  useEffect(() => {
    if (!island) {
      setLiveShows([])
      return
    }
    let dead = false
    const load = () => {
      fetch(`${process.env.API}/islands/${slugify(island)}/live.json`, fetchOptions())
        .then((r) => r.json())
        .then((r) => !dead && r.success && setLiveShows(r.entries ?? []))
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 15000)
    return () => {
      dead = true
      clearInterval(t)
    }
  }, [island])

  if (!grid) return null

  const cam = cameraPosition(props.scene)
  const coords = cam ? encodeCoords({ position: cam }) : ''
  const nearby = grid.getNearest(24)
  const onIsland = island ? nearby.filter((p) => p.island === island) : nearby
  const nearbyIds = new Set(nearby.map((p) => p.id))
  const nearbyEvents = events.filter((e) => nearbyIds.has(e.parcel_id))
  // a parcel that's streaming shows as a stream row, not twice - events fill in the rest
  const liveParcelIds = new Set(liveShows.map((s) => s.parcel?.id).filter(Boolean))
  const liveEvents = nearbyEvents.filter((e) => !liveParcelIds.has(e.parcel_id))

  // teleport(p.address) silently no-oped: an address is not a coords string, so
  // decodeCoordsFromURL rejected it and the click did nothing. use the spawn lookup instead.
  const teleportToParcel = async (p: Parcel) => {
    if (await teleportToParcelSpawn(p.id)) return
    // fallback: drop into the middle of the parcel
    window.persona?.teleport({ position: new BABYLON.Vector3((p.x1 + p.x2) / 2, p.y1 + 2, (p.z1 + p.z2) / 2) })
  }
  const teleportToEvent = async (helper: ParcelEvent) => {
    const t = await helper.getTeleportString()
    if (t) window.persona?.teleport(t)
  }

  return (
    <section className="parcel-information-overlay island-info">
      <header>
        <h2>{island || 'The Void'}</h2>
      </header>
      <div className="scrollContainer">
        <div className="parcels-details">
          <h2>
            you're at <span>{coords || 'the edge of the world'}</span>
          </h2>
        </div>

        <div class="island-minimap">
          <IslandMinimap scene={props.scene} />
        </div>

        {island && <IslandBoard island={island} />}

        <div className="overlay-parcel-info-content">
          <h4>live now</h4>
          {liveShows.map((s) => (
            <a key={s.room} class="island-live-row" title="join the audience" onClick={() => s.coord && window.persona?.teleport(`/play?coords=${encodeURIComponent(s.coord)}`)}>
              {s.thumbnail && <img src={s.thumbnail} alt="" />}
              <span class="island-live-dot">&#9679;</span>
              <span class="island-live-name">{s.parcel?.name || s.parcel?.address || 'live show'}</span>
              <span class="island-live-viewers">{(s.viewers ?? 0) === 1 ? '1 viewer' : `${s.viewers ?? 0} viewers`}</span>
            </a>
          ))}
          {liveEvents.map((e) => (
            <EventRow key={e.id} event={e} onClick={teleportToEvent} />
          ))}
          {!liveShows.length && !liveEvents.length && <p>nothing live on this island</p>}
        </div>

        <div className="overlay-parcel-info-content">
          <h4>parcels nearby</h4>
          {onIsland.length ? (
            <ul className="island-parcels">
              {onIsland.slice(0, 8).map((p) => (
                <li key={p.id}>
                  <a onClick={() => teleportToParcel(p)} title="teleport here">
                    {p.name || p.address}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>no parcels loaded nearby</p>
          )}
        </div>
      </div>
    </section>
  )
}

// same slug the server routes use: lowercase, spaces -> hyphens
const slugify = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-')

interface BoardPost {
  id: number
  author: { name?: string; owner?: string } | string
  content: string
  created_at: string
  parcel_id?: number | null
  parcel_name?: string | null
  hearts?: number
  hearted?: boolean
}

const MAX_NOTE_LENGTH = 240

function authorWallet(author: BoardPost['author']) {
  if (author && typeof author === 'object') return (author.owner ?? '').toLowerCase()
  return String(author ?? '').toLowerCase()
}

// a shared notice board for the island. anyone can read, signed-in visitors can heart, and every
// landowner gets exactly one note: posting again replaces it (and resets its hearts), notes
// expire after 30 days, so the board only ever shows what's current.
function IslandBoard({ island }: { island: string }) {
  const slug = slugify(island)
  const [posts, setPosts] = useState<BoardPost[]>([])
  const [canPost, setCanPost] = useState(false)
  const [myParcels, setMyParcels] = useState<{ id: number; name: string | null; address: string }[]>([])
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [signParcel, setSignParcel] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const myWallet = (app.state.wallet ?? '').toLowerCase()
  const myPost = myWallet ? posts.find((p) => authorWallet(p.author) === myWallet) : undefined

  const load = () => {
    fetch(`${process.env.API}/islands/${slug}/board.json`, fetchOptions())
      .then((r) => r.json())
      .then((r) => {
        if (r.success) {
          setPosts(r.posts)
          setCanPost(r.can_post)
          setMyParcels(r.my_parcels ?? [])
        }
      })
      .catch(() => {})
  }

  useEffect(load, [slug])

  const openComposer = () => {
    setDraft(myPost?.content ?? '')
    setSignParcel(myPost?.parcel_id ? String(myPost.parcel_id) : '')
    setStatus('')
    setComposing(true)
  }

  const submit = async () => {
    const content = draft.trim()
    if (!content || busy) return
    setBusy(true)
    setStatus('')
    try {
      const body = JSON.stringify({ content, parcel_id: signParcel ? parseInt(signParcel, 10) : null })
      const r = await fetch(`${process.env.API}/islands/${slug}/board`, fetchOptions(undefined, body)).then((x) => x.json())
      if (r.success) {
        setDraft('')
        setComposing(false)
        load()
      } else {
        setStatus(r.message || 'could not post')
      }
    } finally {
      setBusy(false)
    }
  }

  const clearMyNote = async () => {
    if (!myPost || busy) return
    setBusy(true)
    try {
      await fetch(`${process.env.API}/islands/${slug}/board/${myPost.id}/remove`, fetchOptions(undefined, '{}')).then((x) => x.json())
      load()
    } finally {
      setBusy(false)
    }
  }

  const toggleHeart = async (post: BoardPost) => {
    if (!app.signedIn) return
    // optimistic flip; reconcile with the server's count
    setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, hearted: !p.hearted, hearts: (p.hearts ?? 0) + (p.hearted ? -1 : 1) } : p)))
    try {
      const r = await fetch(`${process.env.API}/islands/${slug}/board/${post.id}/heart`, fetchOptions(undefined, '{}')).then((x) => x.json())
      if (r.success) setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, hearted: r.hearted, hearts: r.hearts } : p)))
      else load()
    } catch {
      load()
    }
  }

  return (
    <div className="overlay-parcel-info-content island-board">
      <h4>bulletin board</h4>
      {canPost && !composing && (
        <div class="island-board-actions">
          <button type="button" onClick={openComposer}>
            {myPost ? 'edit your note' : 'post'}
          </button>
          {myPost && (
            <button type="button" disabled={busy} onClick={() => void clearMyNote()}>
              clear
            </button>
          )}
        </div>
      )}
      {canPost && composing && (
        <div class="f">
          <textarea value={draft} maxLength={MAX_NOTE_LENGTH} placeholder="pin a note for the island - one per owner" onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)} />
          {myParcels.length > 0 && (
            <select value={signParcel} onChange={(e) => setSignParcel((e.target as HTMLSelectElement).value)}>
              <option value="">no parcel signature</option>
              {myParcels.map((mp) => (
                <option key={mp.id} value={String(mp.id)}>
                  {mp.name?.trim() || mp.address}
                </option>
              ))}
            </select>
          )}
          {myPost && <small>updating replaces your current note and resets its hearts</small>}
          <button type="button" disabled={busy || !draft.trim()} onClick={submit}>
            {myPost ? 'update' : 'post'}
          </button>
          <button type="button" class="island-board-cancel" onClick={() => setComposing(false)}>
            cancel
          </button>
        </div>
      )}
      {status && <p>{status}</p>}
      {posts.length ? (
        <ul className="island-board-posts">
          {posts.map((p) => (
            <li key={p.id}>
              <div className="who">
                {authorName(p.author)} <span>{format(p.created_at)}</span>
              </div>
              <div className="what">{p.content}</div>
              <div className="island-board-meta">
                {p.parcel_id && p.parcel_name && (
                  <a onClick={() => void teleportToParcelSpawn(p.parcel_id!)} title="teleport to this parcel">
                    @ {p.parcel_name}
                  </a>
                )}
                <button
                  type="button"
                  class={`island-board-heart${p.hearted ? ' hearted' : ''}`}
                  title={app.signedIn ? (p.hearted ? 'remove heart' : 'heart this note') : 'sign in to heart'}
                  disabled={!app.signedIn}
                  onClick={() => void toggleHeart(p)}
                >
                  &#9829; {p.hearts ?? 0}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>no posts yet</p>
      )}
    </div>
  )
}

function authorName(author: BoardPost['author']) {
  if (author && typeof author === 'object') return author.name || shortWallet(author.owner)
  return shortWallet(author)
}

function shortWallet(w?: string) {
  return w ? `${w.slice(0, 6)}...${w.slice(-4)}` : 'someone'
}
