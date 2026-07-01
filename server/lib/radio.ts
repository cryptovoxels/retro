import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { MUSIC_URI, tracks } from '../../common/soundtracks'
import { seededShuffle } from '../../common/helpers/utils'
import { avatarName } from '../../common/messages/avatar-ref'
import { Db } from '../pg'

const DAY = 86400
const MIN_GAP = 180
const MAX_GAP = 540 // avg 360s -> ~10 spots/hour

const BUCKET = 'voxels-ugc'
const REGION = 'syd1'
const ENDPOINT = 'https://syd1.digitaloceanspaces.com'
const ACCESS_KEY_ID = process.env.UGC_ACCESS || ''
const CDN = 'https://ugc.crvox.com'

export type SpotKind = 'en' | 'ar'

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
  url?: string // filled once generated (from redis state)
  summary?: string
  parcelId?: number
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

  // one rng sequence drives both spacing and language so the schedule is stable
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

  return { utcDay: day, daySeconds: DAY, musicUri: MUSIC_URI, segments, spots }
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
      model: 'llama-3.1-8b-instant',
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`chat failed: ${r.status} ${body}`)
  }
  const data = await r.json()
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('no script')
  return text
}

async function script(db: Db, redis: any, kind: SpotKind): Promise<{ text: string; parcelId?: number }> {
  const [pop, live] = await Promise.all([popular(db), presence(redis)])

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
  const brief = `Hot parcels right now:\n${hot}\n\nWho's online and where:\n${onln}`

  const prompt =
    kind === 'ar'
      ? `You are the late-night DJ on Voxels Radio, a 3D virtual world. Using the data below, say ONE short casual hype line in Arabic (Saudi dialect), UNDER 120 CHARACTERS. You may name a place or who's around. Arabic script only, no transliteration, no emojis, no quotes.\n\n${brief}`
      : `You are the late-night DJ on Voxels Radio, a 3D virtual world. Using the data below, say ONE short, casual, lowercase on-air shout-out, UNDER 120 CHARACTERS. Name a place, and who's there if it fits. Vibe like: "sit back and relapse at 2 harriot terrace", "join pierceone at gallery", "anons at flashmint". No emojis, no quotes, no hashtags, no stage directions.\n\n${brief}`

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
