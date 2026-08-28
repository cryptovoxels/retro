import { md5 } from './utils'

export type UploadMediaType = 'parcel-content' | 'womps' | 'assetlibrary' | 'avatar'

export const getFileNameNoExtension = (filenameWithExtension: string) => {
  const a = filenameWithExtension.split('.')
  let name = a.splice(0, a.length - 1).join('.')
  if (!/^[\u0000-\u007f]*$/.test(name)) {
    name = encodeURIComponent(name)
  }
  return name
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

const stableHash = md5

export async function generateFileName(file: File, mediaType: UploadMediaType, wallet: string) {
  const regex = /(?:\.([^.]+))?$/
  const ext = regex.exec(file.name)
  const arrayBufferStr = arrayBufferToBase64(await file.arrayBuffer())
  const hashedContent = stableHash(arrayBufferStr) || String(Date.now())
  const hash = stableHash(wallet.toLowerCase() + '/' + mediaType + '/' + hashedContent)
  if (!ext?.[1]) {
    return getFileNameNoExtension(file.name) + '_' + hash
  }
  return getFileNameNoExtension(file.name) + '_' + hash + '.' + ext[1]
}

export function ugcKey(wallet: string, mediaType: UploadMediaType, fileName: string) {
  const w = wallet.toLowerCase()
  if (mediaType === 'womps') return `${w}/womps/${fileName}`
  if (mediaType === 'assetlibrary') return `${w}/assetlibrary/${fileName}`
  if (mediaType === 'avatar') return `${w}/avatar/${fileName}`
  return `${w}/${fileName}`
}
