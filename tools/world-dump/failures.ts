import fs from 'node:fs'
import path from 'node:path'

export function appendFailure(
  dataDir: string,
  info: {
    parcelId: number
    assetId: number
    kind: string
    field: string
    raw: string
    tried: { url: string; error: string }[]
  },
): void {
  const file = path.join(dataDir, 'failure-summary.txt')
  const lines = [`[${new Date().toISOString()}] FAIL parcel=${info.parcelId} asset=${info.assetId} kind=${info.kind} field=${info.field}`, `  raw: ${info.raw}`, `  tried:`, ...info.tried.map((t) => `    - ${t.url} -> ${t.error}`), '']
  fs.appendFileSync(file, lines.join('\n'))
}
