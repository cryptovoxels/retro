import type { DatabaseSync } from 'node:sqlite'

const BATCH = 50
const GAP_MS = 6_000 // 50 per 6s = 500 signatures/min max

export function cleanDiscordUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) || !url.pathname.startsWith('/attachments/')) return null
    url.hostname = 'cdn.discordapp.com'
    url.searchParams.delete('ex')
    url.searchParams.delete('is')
    url.searchParams.delete('hm')
    return url.toString()
  } catch {
    return null
  }
}

let db: DatabaseSync
const queue: { url: string; resolve: (signed: string | null) => void }[] = []
let timer: NodeJS.Timeout | null = null
let lastFlush = 0
let warned = false

export function initDiscord(d: DatabaseSync): void {
  db = d
  db.exec(`CREATE TABLE IF NOT EXISTS discord_urls (
    url        TEXT PRIMARY KEY,
    signed_url TEXT,
    signed_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  // failed discord assets get another shot with fresh signatures
  db.prepare(`UPDATE assets SET status = 'pending', error = NULL WHERE status = 'failed' AND (raw_url LIKE '%discordapp%' OR url LIKE '%discordapp%')`).run()
}

/** Fresh signed url for a discord attachment, or null if not signable. Batched + rate limited. */
export function signDiscord(raw: string): Promise<string | null> {
  const clean = cleanDiscordUrl(raw)
  if (!clean) return Promise.resolve(null)

  // signatures last 24h, reuse for 23
  const row = db.prepare(`SELECT signed_url FROM discord_urls WHERE url = ? AND signed_at > datetime('now', '-23 hours')`).get(clean) as { signed_url: string | null } | undefined
  if (row) return Promise.resolve(row.signed_url)

  if (!process.env.DISCORD_BOT_TOKEN) {
    if (!warned) {
      warned = true
      console.error('no DISCORD_BOT_TOKEN, discord urls will 404')
    }
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    queue.push({ url: clean, resolve })
    schedule()
  })
}

function schedule() {
  if (timer || !queue.length) return
  const wait = Math.max(0, lastFlush + GAP_MS - Date.now())
  timer = setTimeout(flush, wait)
}

async function flush() {
  timer = null
  lastFlush = Date.now()
  const group = queue.splice(0, BATCH)
  if (!group.length) return
  schedule()

  const token = process.env.DISCORD_BOT_TOKEN!
  const urls = [...new Set(group.map((g) => g.url))]
  const fresh = new Map<string, string>()

  try {
    const res = await fetch('https://discord.com/api/v10/attachments/refresh-urls', {
      method: 'POST',
      headers: {
        Authorization: token.startsWith('Bot ') ? token : `Bot ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'VoxelsWorldDump/1.0',
      },
      body: JSON.stringify({ attachment_urls: urls }),
    })
    if (res.status === 429) {
      const retry = parseFloat(res.headers.get('retry-after') || '10')
      lastFlush = Date.now() + retry * 1000
      queue.unshift(...group)
      schedule()
      return
    }
    if (res.ok) {
      const data = (await res.json()) as { refreshed_urls?: { original: string; refreshed: string }[] }
      for (const item of data.refreshed_urls || []) {
        const original = cleanDiscordUrl(item.original)
        if (original && item.refreshed) fresh.set(original, item.refreshed)
      }
    } else {
      console.error(`discord refresh: HTTP ${res.status}`)
    }
  } catch (err: any) {
    console.error(`discord refresh: ${err?.message || err}`)
  }

  const put = db.prepare(`INSERT OR REPLACE INTO discord_urls (url, signed_url, signed_at) VALUES (?, ?, datetime('now'))`)
  for (const u of urls) put.run(u, fresh.get(u) || null)
  for (const g of group) g.resolve(fresh.get(g.url) || null)
}
