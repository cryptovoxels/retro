import type { DatabaseSync } from 'node:sqlite'

const batch = 50
const wait = 60_000 / (500 / batch)

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

export async function refreshDiscordUrls(db: DatabaseSync): Promise<void> {
  // failed discord assets get another shot with fresh signatures
  db.prepare(`UPDATE assets SET status = 'pending', error = NULL WHERE status = 'failed' AND (raw_url LIKE '%discordapp%' OR url LIKE '%discordapp%')`).run()

  const rows = db.prepare(`SELECT id, raw_url, url FROM assets WHERE status = 'pending'`).all() as { id: number; raw_url: string; url: string }[]
  const urls = [...new Set(rows.map((row) => cleanDiscordUrl(row.raw_url) || cleanDiscordUrl(row.url)).filter((url): url is string => !!url))]
  if (!urls.length) return

  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    console.error(`no DISCORD_BOT_TOKEN, skipping refresh of ${urls.length} Discord URLs (they will 404)`)
    return
  }

  const fresh = new Map<string, string>()
  console.log(`refreshing ${urls.length} Discord URLs in batches of ${batch}`)

  for (let start = 0; start < urls.length; start += batch) {
    const group = urls.slice(start, start + batch)
    const res = await fetch('https://discord.com/api/v10/attachments/refresh-urls', {
      method: 'POST',
      headers: {
        Authorization: token.startsWith('Bot ') ? token : `Bot ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'VoxelsWorldDump/1.0',
      },
      body: JSON.stringify({ attachment_urls: group }),
    })
    if (res.status === 429) {
      const retry = parseFloat(res.headers.get('retry-after') || '5')
      await new Promise((resolve) => setTimeout(resolve, retry * 1000 + 500))
      start -= batch
      continue
    }
    if (!res.ok) {
      // deleted attachments / bad batch: those urls just stay stale and 404 later
      console.error(`discord refresh batch failed: HTTP ${res.status}`)
      continue
    }

    const data = (await res.json()) as { refreshed_urls?: { original: string; refreshed: string }[] }
    for (const item of data.refreshed_urls || []) {
      const original = cleanDiscordUrl(item.original)
      if (original && item.refreshed) fresh.set(original, item.refreshed)
    }
    console.log(`refreshed ${Math.min(start + batch, urls.length)}/${urls.length}`)
    if (start + batch < urls.length) await new Promise((resolve) => setTimeout(resolve, wait))
  }

  console.log(`discord: ${fresh.size}/${urls.length} URLs re-signed`)

  const update = db.prepare(`UPDATE assets SET raw_url = ?, url = ?, updated_at = datetime('now') WHERE id = ?`)
  db.exec('BEGIN')
  try {
    for (const row of rows) {
      const original = cleanDiscordUrl(row.raw_url) || cleanDiscordUrl(row.url)
      const url = original && fresh.get(original)
      if (url) update.run(url, url, row.id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
