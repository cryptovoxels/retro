import { useEffect, useState } from 'preact/hooks'
import { format } from 'timeago.js'
import { encodeCoords } from '../../../common/helpers/utils'
import type { Event as EventMessage } from '../../../common/messages/event'
import ParcelEvent from '../../../web/src/helpers/event'
import { fetchOptions } from '../../../web/src/utils'
import { EventRow } from '../../components/explorer/events'
import { BigMap } from '../map-overlay'
import { cameraPosition } from '../../utils/camera'
import type Grid from '../../grid'
import type Parcel from '../../parcel'

// shown in the info pane when you're not standing on a parcel (in the void / between parcels):
// where you are on the island, what's live nearby, and parcels you can jump to.
export default function IslandInfoTab(props: { scene: BABYLON.Scene }) {
  const grid = window.grid as Grid | undefined
  const [, tick] = useState(0)
  const [events, setEvents] = useState<EventMessage[]>([])

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

  if (!grid) return null

  const cam = cameraPosition(props.scene)
  const coords = cam ? encodeCoords({ position: cam }) : ''
  const nearby = grid.getNearest(24)
  const onIsland = island ? nearby.filter((p) => p.island === island) : nearby
  const nearbyIds = new Set(nearby.map((p) => p.id))
  const nearbyEvents = events.filter((e) => nearbyIds.has(e.parcel_id))

  const teleportToParcel = (p: Parcel) => window.persona?.teleport(p.address)
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
          <BigMap scene={props.scene} />
        </div>

        {island && <IslandBoard island={island} />}

        <div className="overlay-parcel-info-content">
          <h4>happening now nearby</h4>
          {nearbyEvents.length ? nearbyEvents.map((e) => <EventRow key={e.id} event={e} onClick={teleportToEvent} />) : <p>nothing live nearby</p>}
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
}

// a shared notice board for the island. anyone can read; owners and collaborators get a post button.
function IslandBoard({ island }: { island: string }) {
  const slug = slugify(island)
  const [posts, setPosts] = useState<BoardPost[]>([])
  const [canPost, setCanPost] = useState(false)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    fetch(`${process.env.API}/islands/${slug}/board.json`, fetchOptions())
      .then((r) => r.json())
      .then((r) => {
        if (r.success) {
          setPosts(r.posts)
          setCanPost(r.can_post)
        }
      })
      .catch(() => {})
  }

  useEffect(load, [slug])

  const submit = async () => {
    const content = draft.trim()
    if (!content || busy) return
    setBusy(true)
    try {
      const r = await fetch(`${process.env.API}/islands/${slug}/board`, fetchOptions(undefined, JSON.stringify({ content }))).then((x) => x.json())
      if (r.success) {
        setDraft('')
        setComposing(false)
        load()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay-parcel-info-content island-board">
      <h4>bulletin board</h4>
      {canPost && !composing && (
        <button type="button" onClick={() => setComposing(true)}>
          post
        </button>
      )}
      {canPost && composing && (
        <div class="f">
          <textarea value={draft} maxLength={500} placeholder="pin a note for landowners" onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)} />
          <button type="button" disabled={busy || !draft.trim()} onClick={submit}>
            post
          </button>
        </div>
      )}
      {posts.length ? (
        <ul className="island-board-posts">
          {posts.map((p) => (
            <li key={p.id}>
              <div className="who">
                {authorName(p.author)} <span>{format(p.created_at)}</span>
              </div>
              <div className="what">{p.content}</div>
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
