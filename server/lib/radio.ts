import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { MUSIC_URI, Track, tracks } from '../../common/soundtracks'
import { seededShuffle } from '../../common/helpers/utils'
import { avatarName } from '../../common/messages/avatar-ref'
import { Db } from '../pg'

const DAY = 86400
const MIN_GAP = 180
const MAX_GAP = 540 // avg 360s -> ~10 spots/hour
const WORLD_MIN = 60
const WORLD_MAX = 320
const WORLD_CAP = 40
const WORLD_SAMPLE = 80

const BUCKET = 'voxels-ugc'
const REGION = 'syd1'
const ENDPOINT = 'https://syd1.digitaloceanspaces.com'
const ACCESS_KEY_ID = process.env.UGC_ACCESS || ''
const CDN = 'https://ugc.crvox.com'

export type SpotKind = 'en' | 'ar'
export type RadioChannel = 'soundtrack' | 'world'

export interface Segment {
  fileName: string
  fallback?: string
  duration: number
  volume?: number
  url?: string
  title?: string
  startsAt: number
}

export interface Spot {
  id: string
  atOffset: number
  kind: SpotKind
  url?: string // filled once generated (from redis state)
  summary?: string
  parcelId?: number
}

export interface Schedule {
  utcDay: number
  daySeconds: number
  musicUri: string
  channel: RadioChannel
  segments: Segment[]
  spots: Spot[]
}

export function utcDay(): number {
  return Math.floor(Date.now() / 1000 / DAY)
}

export function parseChannel(v: unknown): RadioChannel {
  return v === 'world' ? 'world' : 'soundtrack'
}

// truncate to ascii-safe summary for the playlist
export function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n).trim() + '...' : t
}

function rng(seed: number) {
  let s = seed || 1
  return () => {
    const x = Math.sin(s++) * 10000
    return x - Math.floor(x)
  }
}

// shared across channels so DJ spots land at the same wall-clock offsets
export function buildSpots(day: number): Spot[] {
  const r = rng(day + 7)
  const spots: Spot[] = []
  let off = MIN_GAP + r() * (MAX_GAP - MIN_GAP)
  let idx = 0
  while (off < DAY) {
    const kind: SpotKind = r() < 0.25 ? 'ar' : 'en'
    spots.push({ id: `${day}-${idx}`, atOffset: Math.round(off), kind })
    off += MIN_GAP + r() * (MAX_GAP - MIN_GAP)
    idx++
  }
  return spots
}

// Deterministic per UTC day: same station for everyone, regenerates at midnight.
export function buildSchedule(day: number, list: Track[] = tracks, channel: RadioChannel = 'soundtrack', musicUri = MUSIC_URI): Schedule {
  const pool = list.length ? list : tracks
  const order = seededShuffle(pool.slice(), day + 1)

  const segments: Segment[] = []
  let t = 0
  let i = 0
  while (t < DAY) {
    const track = order[i % order.length]
    segments.push({ ...track, startsAt: t })
    t += track.duration
    i++
  }

  return { utcDay: day, daySeconds: DAY, musicUri, channel, segments, spots: buildSpots(day) }
}

// generate text + speech, upload wav to S3, return the url + raw text.
// caching/coordination lives in the controller (redis), this is pure work.
export async function generateSpot(db: Db, redis: any, id: string, kind: SpotKind): Promise<{ url: string; text: string; parcelId?: number }> {
  const { text, parcelId } = await script(db, redis, kind)
  const audio = await speak(text)
  const url = await upload(id, audio)
  return { url, text, parcelId }
}

async function chat(prompt: string, temperature: number): Promise<string> {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`chat failed: ${r.status} ${body}`)
  }
  const data = await r.json()
  let text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('no script')
  // models sometimes wrap the line in quotes or echo instructions - peel to the spoken bit
  text =
    text
      .replace(/^["'`]+|["'`]+$/g, '')
      .split('\n')
      .map((l: string) => l.trim())
      .find((l: string) => l && !/^you are |^using the |^output |^say one /i.test(l)) || text
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim()
  return text
}

async function script(db: Db, redis: any, kind: SpotKind): Promise<{ text: string; parcelId?: number }> {
  const [pop, live, blog, chatter] = await Promise.all([popular(db), presence(redis), blogBits(db), chatBits(db)])

  const ids = [...new Set(live.map((u) => u.parcel).filter((p): p is number => !!p))]
  const names = ids.length ? await parcelNames(db, ids) : {}

  // group live users by the parcel they're standing in
  const groups = new Map<number, string[]>()
  for (const u of live) {
    if (!u.parcel) continue
    if (!groups.has(u.parcel)) groups.set(u.parcel, [])
    groups.get(u.parcel)!.push(u.name)
  }
  const here: string[] = []
  for (const [pid, ppl] of groups) {
    const place = names[pid] || `parcel ${pid}`
    const named = ppl.filter((n) => n && n !== 'anon' && n !== '...')
    const anons = ppl.length - named.length
    const who = named.length ? named.slice(0, 3).join(', ') : `${anons} anon${anons === 1 ? '' : 's'}`
    here.push(`${who} at ${place}`)
  }

  const hot = pop.length ? pop.map((p) => `- ${p.name || p.address}`).join('\n') : '- the streets are quiet'
  const onln = here.length
    ? here
        .slice(0, 6)
        .map((h) => `- ${h}`)
        .join('\n')
    : '- nobody around right now'
  const posts = blog.length ? blog.map((b) => `- ${b}`).join('\n') : '- no posts'
  const chats = chatter.length ? chatter.map((c) => `- ${c}`).join('\n') : '- chat is quiet'
  const brief = `Hot parcels right now:\n${hot}\n\nWho's online and where:\n${onln}\n\nRecent blog:\n${posts}\n\nRecent chat:\n${chats}`

  const prompt =
    kind === 'ar'
      ? `Late-night DJ on Voxels Radio. Reply with ONLY the spoken line in Arabic (Saudi dialect), under 120 characters. Name a place or who's around if it fits. Arabic script only. No transliteration, quotes, emojis, or instructions.\n\n${brief}`
      : `Late-night DJ on Voxels Radio. Reply with ONLY the spoken line: one short casual lowercase shout-out under 120 characters. Weird and cool. Name a place and who's there if it fits. Vibe: sit back and relapse at 2 harriot terrace / join pierceone at gallery / anons at flashmint. No quotes, emojis, hashtags, stage directions, or repeating these instructions.\n\n${brief}`

  // link the spot to wherever the brief is mostly about
  let parcelId: number | undefined
  if (groups.size) {
    let best = 0
    let n = 0
    for (const [pid, ppl] of groups) {
      if (ppl.length > n) {
        best = pid
        n = ppl.length
      }
    }
    parcelId = best || undefined
  } else if (pop[0]?.id) {
    parcelId = pop[0].id
  }

  const text = await chat(prompt, kind === 'ar' ? 0.9 : 0.8)
  return { text, parcelId }
}

async function blogBits(db: Db): Promise<string[]> {
  try {
    const { rows } = await db.query('sql/radio/blog', `select title, left(body, 80) as body from posts order by created_at desc limit 5`)
    return (rows as any[]).map((r) => clip(`${r.title}${r.body ? ': ' + r.body : ''}`, 100))
  } catch {
    return []
  }
}

async function chatBits(db: Db): Promise<string[]> {
  try {
    const { rows } = await db.query('sql/radio/chat', `select text from chat_messages where created_at > now() - interval '24 hours' order by created_at desc limit 8`)
    return (rows as any[]).map((r) => clip(String(r.text || ''), 80)).filter(Boolean)
  } catch {
    return []
  }
}

// live users straight from redis (same data /api/users/live streams)
async function presence(redis: any): Promise<{ parcel: number | null; name: string }[]> {
  try {
    if (!redis) return []
    const keys: string[] = []
    let cursor = 0
    do {
      const r = await redis.scan(cursor, { MATCH: 'radar:*', COUNT: 100 })
      cursor = r.cursor
      keys.push(...r.keys)
    } while (cursor !== 0)
    if (!keys.length) return []
    const vals = await redis.mGet(keys)
    const out: { parcel: number | null; name: string }[] = []
    for (const v of vals) {
      try {
        const u = JSON.parse(v ?? 'null')
        if (u) out.push({ parcel: u.parcel ?? null, name: avatarName(u.avatar) })
      } catch {}
    }
    return out
  } catch {
    return []
  }
}

async function parcelNames(db: Db, ids: number[]): Promise<Record<number, string>> {
  const sql = `SELECT id, name, address FROM properties WHERE id = ANY($1)`
  const { rows } = await db.query('sql/radio/parcel-names', sql, [ids])
  const out: Record<number, string> = {}
  for (const r of rows as any[]) out[r.id] = r.name || r.address
  return out
}

async function popular(db: Db): Promise<{ id: number; name: string; address: string }[]> {
  const t = (i: number) => `day_${i.toString().padStart(2, '0')}`
  const today = new Date().getUTCDay()
  const yesterday = (today + 6) % 7
  const sql = `
    WITH umetrics AS (
      SELECT parcel FROM metrics.${t(today)} WHERE created_at > now() - interval '24 hours'
      UNION ALL
      SELECT parcel FROM metrics.${t(yesterday)} WHERE created_at > now() - interval '24 hours'
    ),
    stats AS (
      SELECT parcel, COUNT(*) AS actions FROM umetrics GROUP BY parcel HAVING COUNT(*) > 1
    )
    SELECT p.id, p.name, p.address FROM stats s JOIN properties p ON p.id = s.parcel
    ORDER BY s.actions DESC LIMIT 6
  `
  const { rows } = await db.query('sql/radio/popular', sql)
  return (rows as any[]).map((p) => ({ id: p.id, name: p.name, address: p.address }))
}

async function speak(text: string): Promise<Buffer> {
  // one voice for the whole station - the Saudi Orpheus voice sounds great on english too.
  // strip quotes/whitespace and hard-cap under Orpheus' 200-char limit.
  const input = text.replace(/["'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 170)
  const r = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'canopylabs/orpheus-arabic-saudi',
      voice: 'noura',
      input,
      response_format: 'wav',
    }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`tts failed: ${r.status} ${body}`)
  }
  return Buffer.from(await r.arrayBuffer())
}

async function upload(id: string, audio: Buffer): Promise<string> {
  const secret = process.env.UGC_SECRET
  if (!secret) throw new Error('UGC_SECRET not set')

  const s3 = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: secret },
    forcePathStyle: false,
  })

  // v2 namespace: old cached audio (the dreaded "high alert" spot) lives under radio/<id>.wav
  // and the CDN keeps serving it even after overwrite. New keys = pristine, can never come back.
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `radio/v2/${id}.wav`, Body: audio, ContentType: 'audio/wav', ACL: 'public-read' }))
  return `${CDN}/radio/v2/${id}.wav`
}

function basenameTitle(url: string, place: string): string {
  try {
    const base = decodeURIComponent((url.split('?')[0].split('/').pop() || '').replace(/\.[^.]+$/, ''))
      .replace(/[-_]+/g, ' ')
      .trim()
    if (base && base.length < 60) return base
  } catch {}
  return place || 'world'
}

function playUrl(url: string): string {
  const img = process.env.IMG_URL
  if (!img) return url
  return `${img}/audio?url=${encodeURIComponent(url)}&mode=audio`
}

function wavDuration(buf: Buffer): number | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null
  const channels = buf.readUInt16LE(22)
  const rate = buf.readUInt32LE(24)
  const bits = buf.readUInt16LE(34)
  let i = 12
  while (i + 8 <= buf.length) {
    const id = buf.toString('ascii', i, i + 4)
    const size = buf.readUInt32LE(i + 4)
    if (id === 'data' && channels && rate && bits) {
      const bytesPerSec = rate * channels * (bits / 8)
      if (!bytesPerSec) return null
      return size / bytesPerSec
    }
    i += 8 + size + (size % 2)
  }
  return null
}

function mp3Duration(buf: Buffer): number | null {
  // Xing / Info frame with frame count
  const xing = buf.indexOf('Xing')
  const info = buf.indexOf('Info')
  const at = xing >= 0 ? xing : info
  if (at < 0 || at + 12 > buf.length) return null
  const flags = buf.readUInt32BE(at + 4)
  if (!(flags & 1) || at + 12 > buf.length) return null
  const frames = buf.readUInt32BE(at + 8)
  // find preceding sync to get samples-per-frame (1152 for MPEG1 layer3)
  let sync = -1
  for (let i = Math.max(0, at - 200); i < at; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      sync = i
      break
    }
  }
  if (sync < 0) return null
  const ver = (buf[sync + 1] >> 3) & 3
  const samples = ver === 3 ? 1152 : 576
  const srTable = [
    [44100, 48000, 32000],
    [22050, 24000, 16000],
    [11025, 12000, 8000],
  ]
  const srIdx = (buf[sync + 2] >> 2) & 3
  const verRow = ver === 3 ? 0 : ver === 2 ? 1 : 2
  const rate = srTable[verRow]?.[srIdx]
  if (!rate || !frames) return null
  return (frames * samples) / rate
}

async function probeDuration(url: string): Promise<number | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const r = await fetch(url, { headers: { Range: 'bytes=0-131071' }, signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok && r.status !== 206) return null
    const buf = Buffer.from(await r.arrayBuffer())
    const d = wavDuration(buf) ?? mp3Duration(buf)
    if (d == null || !isFinite(d)) return null
    return d
  } catch {
    return null
  }
}

export async function sampleWorldTracks(db: Db, day: number): Promise<Track[]> {
  let rows: { id: number; url: string; place: string }[] = []
  try {
    const sql = `
      SELECT p.id, f->>'url' AS url, coalesce(nullif(p.name, ''), p.address, 'parcel ' || p.id) AS place
      FROM properties p,
        jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(content::jsonb -> 'features') = 'array' THEN content::jsonb -> 'features'
            ELSE '[]'::jsonb
          END
        ) f
      WHERE f->>'type' = 'audio'
        AND nullif(f->>'url', '') IS NOT NULL
      ORDER BY md5(p.id::text || $1::text)
      LIMIT $2
    `
    const res = await db.query('sql/radio/world-audio', sql, [String(day), WORLD_SAMPLE])
    rows = (res.rows as any[]).map((r) => ({ id: r.id, url: r.url, place: r.place }))
  } catch (e: any) {
    console.error('radio world sample', e?.toString?.() ?? e)
    return []
  }

  const out: Track[] = []
  for (let i = 0; i < rows.length && out.length < WORLD_CAP; i += 8) {
    const batch = rows.slice(i, i + 8)
    const probed = await Promise.all(
      batch.map(async (r) => {
        const duration = await probeDuration(r.url)
        if (duration == null || duration < WORLD_MIN || duration > WORLD_MAX) return null
        const title = basenameTitle(r.url, r.place)
        const fileName = (r.url.split('?')[0].split('/').pop() || `world-${r.id}`).slice(0, 120)
        return { fileName, duration: Math.round(duration), url: playUrl(r.url), title } as Track
      }),
    )
    for (const t of probed) if (t) out.push(t)
  }
  return out
}
