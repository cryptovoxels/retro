import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { MUSIC_URI, tracks } from '../../common/soundtracks'
import { seededShuffle } from '../../common/helpers/utils'
import { Db } from '../pg'

const DAY = 86400
const SPOT_EVERY = 600 // a DJ spot every 10 minutes

const BUCKET = 'voxels-ugc'
const REGION = 'syd1'
const ENDPOINT = 'https://syd1.digitaloceanspaces.com'
const ACCESS_KEY_ID = 'DO801UZARQ8UZC3XFWTT'
const CDN = 'https://ugc.crvox.com'

export type SpotKind = 'event' | 'parcel' | 'vibe'

// Which kind of spot plays at a given index. 1 in 4 is an Arabic "vibe" spot;
// the rest alternate events and popular parcels. Shared so the schedule builder
// and the spot endpoint stay in sync.
export function spotKind(idx: number): SpotKind {
  if (idx % 4 === 0) return 'vibe'
  return idx % 2 === 0 ? 'event' : 'parcel'
}

export interface Segment {
  fileName: string
  fallback?: string
  duration: number
  volume?: number
  startsAt: number
}

export interface Spot {
  id: string
  atOffset: number
  kind: SpotKind
}

export interface Schedule {
  utcDay: number
  daySeconds: number
  musicUri: string
  segments: Segment[]
  spots: Spot[]
}

export function utcDay(): number {
  return Math.floor(Date.now() / 1000 / DAY)
}

// Deterministic per UTC day: same station for everyone, regenerates at midnight.
export function buildSchedule(day: number): Schedule {
  const order = seededShuffle(tracks.slice(), day + 1)

  const segments: Segment[] = []
  let t = 0
  let i = 0
  while (t < DAY) {
    const track = order[i % order.length]
    segments.push({ ...track, startsAt: t })
    t += track.duration
    i++
  }

  const spots: Spot[] = []
  for (let off = SPOT_EVERY; off < DAY; off += SPOT_EVERY) {
    const idx = off / SPOT_EVERY
    spots.push({ id: `${day}-${idx}`, atOffset: off, kind: spotKind(idx) })
  }

  return { utcDay: day, daySeconds: DAY, musicUri: MUSIC_URI, segments, spots }
}

const inflight = new Map<string, Promise<{ url: string; text: string }>>()

export function generateSpot(db: Db, id: string, kind: SpotKind) {
  let job = inflight.get(id)
  if (!job) {
    job = run(db, id, kind).finally(() => inflight.delete(id))
    inflight.set(id, job)
  }
  return job
}

async function run(db: Db, id: string, kind: SpotKind): Promise<{ url: string; text: string }> {
  // already on S3 from an earlier listener? share it.
  const cached = await readCache(id)
  if (cached) return cached

  const text = await script(db, kind)
  const audio = await speak(text, kind)
  const url = await upload(id, audio, text)
  return { url, text }
}

async function readCache(id: string): Promise<{ url: string; text: string } | null> {
  try {
    const r = await fetch(`${CDN}/radio/${id}.json`)
    if (!r.ok) return null
    const meta = await r.json()
    return { url: `${CDN}/radio/${id}.wav`, text: meta.text ?? '' }
  } catch {
    return null
  }
}

async function chat(prompt: string, temperature: number): Promise<string> {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  }).then((r) => r.json())

  const text = r.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('no script')
  return text
}

async function script(db: Db, kind: SpotKind): Promise<string> {
  if (kind === 'vibe') return arabicVibe()

  const data = kind === 'event' ? await eventLines(db) : await parcelLines(db)

  const brief =
    kind === 'event'
      ? `Upcoming events in Voxels:\n${data}`
      : `Parcels buzzing with activity right now in Voxels:\n${data}`

  // Orpheus caps input at 200 chars, so keep the line short.
  const prompt = `You are the hyped late-night DJ on Voxels Radio. In ONE punchy spoken sentence UNDER 180 CHARACTERS, give a quick shout-out based on this. No emojis, no stage directions, just what you'd say on air.\n\n${brief}`

  return chat(prompt, 0.8)
}

// Arabic flavour drop - pure vibes, not info. Spoken by Noura.
async function arabicVibe(): Promise<string> {
  const prompt = `You are a late-night DJ on Voxels Radio, a 3D virtual world. Say ONE short atmospheric hype line in Arabic (Saudi dialect), UNDER 100 CHARACTERS. Pure vibes and mood, NOT informational. Arabic script only, no transliteration, no emojis, no quotes.`
  return chat(prompt, 1.0)
}

async function eventLines(db: Db): Promise<string> {
  const sql = `
    SELECT name, (SELECT name FROM properties WHERE id = parcel_id) AS parcel
    FROM parcel_events
    WHERE expires_at > NOW() AND starts_at > NOW()
    ORDER BY starts_at ASC
    LIMIT 5
  `
  const { rows } = await db.query('sql/radio/events', sql)
  if (!rows.length) return 'Nothing on the calendar - tell them to throw a party.'
  return rows.map((e: any) => `- ${e.name}${e.parcel ? ` at ${e.parcel}` : ''}`).join('\n')
}

async function parcelLines(db: Db): Promise<string> {
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
    SELECT p.name, p.address FROM stats s JOIN properties p ON p.id = s.parcel
    ORDER BY s.actions DESC LIMIT 5
  `
  const { rows } = await db.query('sql/radio/popular', sql)
  if (!rows.length) return 'The streets are quiet - be the first one out there.'
  return rows.map((p: any) => `- ${p.name || p.address}`).join('\n')
}

async function speak(text: string, kind: SpotKind): Promise<Buffer> {
  const arabic = kind === 'vibe'
  // English Orpheus reads [bracketed] words as vocal direction, not speech.
  const input = (arabic ? text : `[casual] [warm] ${text}`).slice(0, 200) // Orpheus hard limit
  const r = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: arabic ? 'canopylabs/orpheus-arabic-saudi' : 'canopylabs/orpheus-v1-english',
      voice: arabic ? 'noura' : 'autumn',
      input,
      response_format: 'wav',
    }),
  })
  if (!r.ok) throw new Error(`tts failed: ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

async function upload(id: string, audio: Buffer, text: string): Promise<string> {
  const secret = process.env.UGC_SECRET
  if (!secret) throw new Error('UGC_SECRET not set')

  const s3 = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: secret },
    forcePathStyle: false,
  })

  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `radio/${id}.wav`, Body: audio, ContentType: 'audio/wav', ACL: 'public-read' }))
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `radio/${id}.json`, Body: JSON.stringify({ text }), ContentType: 'application/json', ACL: 'public-read' }))

  return `${CDN}/radio/${id}.wav`
}
