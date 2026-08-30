import { execFileSync } from 'node:child_process'
import db from '../server/pg'

const MODEL = 'openai/gpt-oss-20b'

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

async function groq(logs: string): Promise<string> {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            'You write Voxels release notes for players. Zine voice: direct, warm, lowercase subheadings, no marketing, no corporate hedging. First line must be "# <title>". Body is markdown. What changed and why a player cares. Skip chore/deps noise.',
        },
        {
          role: 'user',
          content: `Write release notes from these commits:\n\n${logs}`,
        },
      ],
    }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`groq ${r.status} ${body}`)
  }
  const data = (await r.json()) as any
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.log('release-blog: no GROQ_API_KEY, skip')
    return
  }
  if (!process.env.DATABASE_URL) {
    console.log('release-blog: no DATABASE_URL, skip')
    return
  }

  const head = (process.env.COMMIT_HASH || git(['rev-parse', 'HEAD'])).trim()
  if (!head) {
    console.log('release-blog: no commit hash, skip')
    return
  }

  const last = await db.query('release-blog/last-hash', `select hash from posts where hash is not null order by created_at desc limit 1`, [])
  const prev = (last.rows?.[0] as any)?.hash as string | undefined
  if (prev && prev === head) {
    console.log('release-blog: already posted for', head.slice(0, 7))
    return
  }

  const range = prev ? `${prev}..${head}` : '-50'
  const logs = prev ? git(['log', '--pretty=format:%h %s (%an)', range]) : git(['log', '--pretty=format:%h %s (%an)', range])
  if (!logs) {
    console.log('release-blog: empty git log, skip')
    return
  }

  let md: string
  try {
    md = await groq(logs)
  } catch (e) {
    console.error('release-blog: groq failed', e)
    return
  }

  const lines = md.split('\n')
  const first = lines[0] ?? ''
  const title = first.startsWith('# ') ? first.slice(2).trim() : first.trim() || `release ${head.slice(0, 7)}`
  const body = first.startsWith('# ') ? lines.slice(1).join('\n').trim() : md
  if (!body) {
    console.log('release-blog: empty body, skip')
    return
  }

  const day = new Date().toISOString().slice(0, 10)
  const slug = `${day}-${head.slice(0, 7)}`

  try {
    await db.query(
      'release-blog/insert',
      `insert into posts (slug, title, body, author, hash) values ($1, $2, $3, 'voxels', $4)
       on conflict (hash) do nothing`,
      [slug, title, body, head],
    )
    console.log('release-blog: posted', slug)
  } catch (e) {
    console.error('release-blog: insert failed', e)
  }
}

main()
  .catch((e) => {
    console.error('release-blog:', e)
  })
  .finally(() => process.exit(0))
