import { useEffect, useState } from 'preact/hooks'
import { avatarName, avatarWallet, type AvatarRef } from '../../common/messages/avatar-ref'
import { ChatPanel } from '../../src/ui/interact/chat'
import { sidebarClosed } from '../../src/store'
import { getParcel, summaryReady } from './store/index'
import { AvatarLink } from './components/avatar-link'
import { getCoords } from './helpers/coords-nav'
import { connectShardChat } from './shard-chat'

type PresenceUser = { avatar: AvatarRef | null; parcel: number | null }

function isAnon(avatar: AvatarRef | null): boolean {
  if (!avatar) return true
  const n = avatarName(avatar)
  return n === '...' || n === 'anon'
}

/** Same person across world + chat sockets — wallet, else lowercased name. Anons have no key. */
function personKey(uuid: string, avatar: AvatarRef | null): string | null {
  if (isAnon(avatar)) return null
  const wallet = avatarWallet(avatar)
  if (wallet) return wallet.toLowerCase()
  const n = avatarName(avatar)
  return n.toLowerCase() || uuid
}

function dedupeUsers(users: Map<string, PresenceUser>): PresenceUser[] {
  const named = new Map<string, PresenceUser>()
  const anons: PresenceUser[] = []
  for (const [uuid, u] of users) {
    const key = personKey(uuid, u.avatar)
    if (!key) {
      anons.push(u)
      continue
    }
    const prev = named.get(key)
    if (!prev || (prev.parcel == null && u.parcel != null)) named.set(key, u)
  }
  return [...named.values(), ...anons]
}

type Place = { parcel: number | null; named: AvatarRef[]; anons: number }

function groupByPlace(list: PresenceUser[]): Place[] {
  const map = new Map<number | null, Place>()
  for (const u of list) {
    const key = u.parcel ?? null
    let place = map.get(key)
    if (!place) {
      place = { parcel: key, named: [], anons: 0 }
      map.set(key, place)
    }
    if (isAnon(u.avatar)) place.anons++
    else if (u.avatar) place.named.push(u.avatar)
  }
  // parcels first (by id), then chat (null)
  return [...map.values()].sort((a, b) => {
    if (a.parcel == null) return 1
    if (b.parcel == null) return -1
    return a.parcel - b.parcel
  })
}

function placeLabel(parcel: number | null): string {
  if (parcel == null) return 'chat'
  const info = getParcel(parcel).value
  return info?.name || info?.address || `parcel ${parcel}`
}

const TIMES: { label: string; timeZone?: string }[] = [
  { label: 'Local' },
  { label: 'New york', timeZone: 'America/New_York' },
  { label: 'Los Angeles', timeZone: 'America/Los_Angeles' },
  { label: 'Paris', timeZone: 'Europe/Paris' },
  { label: 'Shenzhen', timeZone: 'Asia/Shanghai' },
]

function formatClock(now: Date, timeZone?: string): string {
  const raw = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  }).format(now)
  return raw.replace(/\s/g, '').toLowerCase()
}

export function ChatPage(_props: { path?: string }) {
  const [users, setUsers] = useState(() => new Map<string, PresenceUser>())
  const [, bump] = useState(0)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    document.body.classList.toggle('chat-route', true)
    if (getCoords()) sidebarClosed.value = false
    if (!(window as any).connector) connectShardChat()
    return () => document.body.classList.remove('chat-route')
  }, [])

  useEffect(() => {
    summaryReady.then(() => bump((n) => n + 1))
    const es = new EventSource('/api/users/live')
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        setUsers((prev) => {
          const next = new Map(prev)
          if (msg.type === 'snapshot') {
            next.clear()
            for (const u of msg.users ?? []) next.set(u.uuid, { avatar: u.avatar, parcel: u.parcel ?? null })
          } else if (msg.type === 'move') {
            next.set(msg.uuid, { avatar: msg.avatar, parcel: msg.parcel ?? null })
          } else if (msg.type === 'leave') {
            next.delete(msg.uuid)
          }
          return next
        })
      } catch {}
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const places = groupByPlace(dedupeUsers(users))

  return (
    <section class="chat-page">
      <h1>chat</h1>
      <ChatPanel cap={1000} variant="page" />

      <ul class="chat-times">
        {TIMES.map(({ label, timeZone }) => (
          <li key={label}>
            {label}: {formatClock(now, timeZone)}
          </li>
        ))}
      </ul>
    </section>
  )
}
