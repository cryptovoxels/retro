import type { DatabaseSync } from 'node:sqlite'
import { Kind, env, Env, ResolveOpts } from './resolve'
import { buildTryUrls } from './try-urls'

/** Patch a parcel field path like content.features[2].url or lightmap_url */
export function patchField(parcel: any, field: string, value: string): void {
  if (field === 'lightmap_url') {
    parcel.lightmap_url = value
    return
  }

  if (field === 'content.tileset') {
    if (!parcel.content) parcel.content = {}
    if (typeof parcel.content === 'string') parcel.content = JSON.parse(parcel.content)
    parcel.content.tileset = value
    return
  }

  const m = field.match(/^content\.features\[(\d+)\]\.(url|previewUrl|assetUrl)$/)
  if (m) {
    if (!parcel.content) parcel.content = {}
    if (typeof parcel.content === 'string') parcel.content = JSON.parse(parcel.content)
    const idx = parseInt(m[1], 10)
    const key = m[2]
    if (!Array.isArray(parcel.content.features)) return
    const f = parcel.content.features[idx]
    if (!f) return
    f[key] = value
    return
  }
}

export function rewriteParcelAsset(db: DatabaseSync, parcelId: number, field: string, hash: string): void {
  const row = db.prepare('SELECT lightmap_url, content FROM parcels WHERE id = ?').get(parcelId) as { lightmap_url: string | null; content: string } | undefined
  if (!row) return

  const parcel: any = {
    lightmap_url: row.lightmap_url,
    content: JSON.parse(row.content),
  }

  const voxelsUrl = `voxels://${hash}`
  patchField(parcel, field, voxelsUrl)

  const contentStr = JSON.stringify(parcel.content)
  const lightmap = field === 'lightmap_url' ? voxelsUrl : parcel.lightmap_url

  db.prepare('UPDATE parcels SET content = ?, lightmap_url = ? WHERE id = ?').run(contentStr, lightmap, parcelId)
}

export function markParcelDoneIfReady(db: DatabaseSync, parcelId: number): void {
  const pending = db.prepare(`SELECT COUNT(*) as c FROM assets WHERE parcel_id = ? AND status NOT IN ('done','failed','skip')`).get(parcelId) as { c: number }
  if (pending.c === 0) {
    db.prepare('UPDATE parcels SET done = 1 WHERE id = ?').run(parcelId)
  }
}

export function buildTryList(kind: Kind, rawUrl: string, primaryUrl: string, e: Env = env(), opts: ResolveOpts = {}): string[] {
  return buildTryUrls(kind, rawUrl || primaryUrl, e, opts)
}
