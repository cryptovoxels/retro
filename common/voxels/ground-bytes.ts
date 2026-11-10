import { Buffer } from 'buffer'
import { unzlibSync, zlibSync } from 'fflate'

export function packGround(bytes: Uint8Array) {
  return 'z:' + Buffer.from(zlibSync(bytes, { level: 1 })).toString('base64')
}
export function unpackGround(value: string) {
  return value.startsWith('z:') ? unzlibSync(Buffer.from(value.slice(2), 'base64')) : Buffer.from(value, 'base64')
}
