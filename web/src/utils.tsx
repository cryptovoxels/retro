import { similarity } from '../../common/helpers/utils'
import { sum } from './helpers/math'

import { voxMeta } from '../../common/vox/parse'

export type FetchOptions = RequestInit & {
  // fetch priority is supported in Chrome 101 and up. Hasn't been added to ts definitions yet
  priority?: 'low' | 'high' | 'auto'
}

export const fetchOptions = (abortController?: AbortController, body?: string, bypassCache?: boolean): FetchOptions => {
  const obj: FetchOptions = {}

  obj['credentials'] = 'include'

  if (abortController) {
    obj['signal'] = abortController.signal
  }

  if (body !== undefined) {
    obj['body'] = body
    obj['method'] = 'post'
    obj['headers'] = { Accept: 'application/json', 'Content-Type': 'application/json' }
  }
  if (bypassCache) obj.cache = 'no-cache'

  return obj
}

interface ImageInfo {
  aspectRatio: number
  height: number
  width: number
  size: number
  type: string
  hasAlpha: boolean
}

interface VoxInfo {
  sizeX: number
  sizeY: number
  sizeZ: number
  megavox: boolean
}

export const getImageInfo = async (file: File): Promise<ImageInfo> => {
  return new Promise(async (resolve, reject) => {
    if (!file) {
      reject(new Error("Can't load image"))
      return
    }

    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      const image = new Image()

      image.src = reader.result as any
      image.onload = () => {
        const type = file.type.split('/')[1]
        resolve({
          aspectRatio: image.naturalWidth / image.naturalHeight,
          width: image.naturalWidth,
          height: image.naturalHeight,
          hasAlpha: type === 'png' || type === 'gif',
          size: file.size,
          type,
        })
      }
      image.onerror = () => {
        reject(new Error("Can't load image"))
      }
    }
  })
}

export const getURlImageInfo = async (url: string): Promise<ImageInfo> => {
  return new Promise(async (resolve, reject) => {
    let file: Blob
    // We have a URL, fetch the image
    let response
    try {
      response = await fetch(url)
    } catch {}
    if (response) {
      // We didn't get CORS kicked out, grab the response as a blob
      file = await response.blob()
    } else {
      // We got a bad response, so we resolve a default aspectRatio (that's all we need really)
      resolve({
        aspectRatio: 12 / 16,
        width: 12,
        height: 16,
        hasAlpha: false,
        size: 0,
        type: 'png',
      })
      return
    }
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      const image = new Image()

      image.src = reader.result as any
      image.onload = () => {
        const type = file.type.split('/')[1]
        resolve({
          aspectRatio: image.naturalWidth / image.naturalHeight,
          width: image.naturalWidth,
          height: image.naturalHeight,
          hasAlpha: type === 'png' || type === 'gif',
          size: file.size,
          type,
        })
      }
      image.onerror = () => {
        reject(new Error("Can't load image"))
      }
    }
  })
}

export const getVoxInfo = (file: File): Promise<VoxInfo> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsArrayBuffer(file)
    reader.onload = () => {
      try {
        const meta = voxMeta(reader.result as ArrayBuffer)
        resolve(meta)
      } catch (err) {
        reject(err)
      }
    }
  })
}

const base64abc = (() => {
  const abc = [],
    A = 'A'.charCodeAt(0),
    a = 'a'.charCodeAt(0),
    n = '0'.charCodeAt(0)
  for (let i = 0; i < 26; ++i) {
    abc.push(String.fromCharCode(A + i))
  }
  for (let i = 0; i < 26; ++i) {
    abc.push(String.fromCharCode(a + i))
  }
  for (let i = 0; i < 10; ++i) {
    abc.push(String.fromCharCode(n + i))
  }
  abc.push('+')
  abc.push('/')
  return abc
})()

export const bytesToBase64 = (bytes: any) => {
  let result = '',
    i
  const l = bytes.length
  for (i = 2; i < l; i += 3) {
    result += base64abc[bytes[i - 2] >> 2]
    result += base64abc[((bytes[i - 2] & 0x03) << 4) | (bytes[i - 1] >> 4)]
    result += base64abc[((bytes[i - 1] & 0x0f) << 2) | (bytes[i] >> 6)]
    result += base64abc[bytes[i] & 0x3f]
  }
  if (i === l + 1) {
    // 1 octet missing
    result += base64abc[bytes[i - 2] >> 2]
    result += base64abc[(bytes[i - 2] & 0x03) << 4]
    result += '=='
  }
  if (i === l) {
    // 2 octets missing
    result += base64abc[bytes[i - 2] >> 2]
    result += base64abc[((bytes[i - 2] & 0x03) << 4) | (bytes[i - 1] >> 4)]
    result += base64abc[(bytes[i - 1] & 0x0f) << 2]
    result += '='
  }
  return result
}

export const parseDateToYYYMMDD = (date: Date = null!) => {
  const ms = (date ? date : new Date()).getTime()
  const d = new Date(ms || Date.now() - 14 * 24 * 60 * 60 * 1000) // 2 weeks by default
  return d.toISOString().split('T')[0]
}

export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function findMostSimilarsInArray(string1: string, arrayOfStrings: string[]): string[] {
  const splittedString = string1.split(' ')
  let bestCandidates: { str: string; sim: number }[] = []
  for (const word of splittedString) {
    const candidates = arrayOfStrings.map((bigString: string) => {
      const found = bigString.split(' ').map((wordOfBigString) => {
        return similarity(word, wordOfBigString)
      })
      if (!found.length) {
        return { str: bigString, sim: 0 }
      }
      // Get the similarity of words to include
      const sumOfSims = sum(found)

      return { str: bigString, sim: sumOfSims }
    })
    candidates.sort((a, b) => a!.sim - b!.sim)
    bestCandidates = [...bestCandidates, ...candidates]
  }

  bestCandidates.sort((a, b) => a!.sim - b!.sim)
  const bestMatch = bestCandidates
  // only return if simmilarity is above or equal to 1, or if match contains search string
  return bestMatch!.filter((match) => match.sim >= 1 || match.str.match(string1)).map((match) => match.str)
}

export function stringEllipsisInCanvas(str: string, c: any, maxWidth: number) {
  let width = c.measureText(str).width
  const ellipsis = '…'
  const ellipsisWidth = c.measureText(ellipsis).width
  if (width <= maxWidth || width <= ellipsisWidth) {
    return str
  } else {
    let len = str.length
    while (width >= maxWidth - ellipsisWidth && len-- > 0) {
      str = str.substring(0, len)
      width = c.measureText(str).width
    }
    return str + ellipsis
  }
}
