import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import db from './pg'

export async function ingestReleaseNotes() {
  const dir = path.join(process.cwd(), 'release-notes')
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const slug = file.slice(0, -3)
    let text: string
    try {
      text = await readFile(path.join(dir, file), 'utf8')
    } catch {
      continue
    }

    const lines = text.split('\n')
    const first = lines[0] ?? ''
    const title = first.startsWith('# ') ? first.slice(2).trim() : slug
    const body = first.startsWith('# ') ? lines.slice(1).join('\n').trim() : text.trim()
    if (!body) continue

    try {
      // voxels release-notes re-sync on boot so typo fixes in the files land; hand-edited
      // posts (other authors) stay put
      await db.query(
        'embedded/ingest-post',
        `insert into posts (slug, title, body, author) values ($1, $2, $3, 'voxels')
         on conflict (slug) do update set title = excluded.title, body = excluded.body
         where posts.author = 'voxels'`,
        [slug, title, body],
      )
    } catch (e) {
      console.error('blog ingest failed for', file, e)
    }
  }
}
