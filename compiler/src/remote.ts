import { createHmac } from 'node:crypto'
import { URL_FIELDS, type CompileResult } from '../../common/helpers/parcel-compile'

const endpoint = 'https://faas-sfo3-7872a1dd.doserverless.co/api/v1/web/fn-7f487c48-1176-4b03-82aa-03c5faebe781/parcels/rehost'

export async function remoteCompile(id: number, features: any[], tileset?: string, reprocess = false): Promise<CompileResult> {
  const patch: CompileResult['patch'] = {}
  const missing = new Set<string>()
  let batch: any[] = []
  let bytes = 0
  async function send() {
    if (!process.env.UGC_SECRET) throw new Error('UGC_SECRET missing for parcel rehosting')
    const token = createHmac('sha256', process.env.UGC_SECRET).update('parcels/rehost').digest('hex')
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Require-Whisk-Auth': token },
      body: JSON.stringify({ id, features: batch, tileset, reprocess }),
      signal: AbortSignal.timeout(155000),
    })
    if (!response.ok) throw new Error(`Rehost function returned ${response.status}`)
    const result = (await response.json()) as CompileResult
    if (result.patch.features) Object.assign((patch.features ??= Object.create(null)), result.patch.features)
    if (result.patch.tileset !== undefined) patch.tileset = result.patch.tileset
    for (const url of result.missing) missing.add(url)
    tileset = undefined
    batch = []
    bytes = 0
  }
  // Send asset fields only. Scripts, parcel voxels and unrelated feature data stay local.
  for (const f of features) {
    if (!f?.uuid || !URL_FIELDS.some((field) => f[field])) continue
    const item = { uuid: f.uuid, type: f.type, url: f.url, previewUrl: f.previewUrl, assetUrl: f.assetUrl, draft: f.draft, voxelbr: f.voxelbr }
    const size = Buffer.byteLength(JSON.stringify(item))
    if (size > 400000) throw new Error('Asset fields exceed the rehost function limit')
    if (batch.length && (batch.length >= 8 || bytes + size > 400000)) await send()
    batch.push(item)
    bytes += size
  }
  if (batch.length || tileset) await send()
  return { patch, missing: [...missing] }
}
